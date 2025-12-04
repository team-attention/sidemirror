import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { DiffDisplayState, ChunkDisplayInfo, FileInfo } from '../../../application/ports/outbound/PanelState';
import { DiffResult } from '../../../domain/entities/Diff';

export class FileWatchController {
    private gitignore: Ignore;
    private includePatterns: Ignore;
    private workspaceRoot: string | undefined;
    private gitPort: IGitPort | undefined;
    private debugChannel: vscode.OutputChannel | undefined;
    private gitHeadWatcher: vscode.FileSystemWatcher | undefined;
    private lastHeadCommit: string | undefined;

    /** 모든 활성 세션 참조 */
    private sessions: Map<string, SessionContext> | undefined;

    constructor() {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    private log(message: string): void {
        if (!this.debugChannel) return;
        const timestamp = new Date().toISOString().substring(11, 23);
        this.debugChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * 세션 맵 참조 설정 (AIDetectionController에서 호출)
     */
    setSessionsRef(sessions: Map<string, SessionContext>): void {
        this.sessions = sessions;
    }

    setGitPort(gitPort: IGitPort): void {
        this.gitPort = gitPort;
    }

    private initialize(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.loadGitignore();
        this.loadIncludePatterns();
    }

    private loadGitignore(): void {
        if (!this.workspaceRoot) return;

        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            const content = fs.readFileSync(gitignorePath, 'utf8');
            this.gitignore.add(content);
        }

        this.gitignore.add([
            '.git',
            'node_modules',
            'sidecar-comments.json'
        ]);
    }

    private loadIncludePatterns(): void {
        const config = vscode.workspace.getConfiguration('sidecar');
        const includeFiles = config.get<string[]>('includeFiles', []);

        if (includeFiles.length > 0) {
            this.includePatterns.add(includeFiles);
        }
    }

    reload(): void {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    shouldTrack(uri: vscode.Uri): boolean {
        if (!this.workspaceRoot) return true;

        const relativePath = vscode.workspace.asRelativePath(uri);

        if (this.includePatterns.ignores(relativePath)) {
            return true;
        }

        if (this.gitignore.ignores(relativePath)) {
            return false;
        }

        return true;
    }

    activate(context: vscode.ExtensionContext): void {
        this.debugChannel = vscode.window.createOutputChannel('Sidecar FileWatch');
        context.subscriptions.push(this.debugChannel);

        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

        const handleFileChange = async (uri: vscode.Uri) => {
            const relativePath = vscode.workspace.asRelativePath(uri);
            this.log(`Event: ${relativePath}`);

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.Directory) {
                    this.log(`  Skip: directory`);
                    return;
                }
            } catch {
                this.log(`  Skip: stat failed`);
                return;
            }

            if (!this.shouldTrack(uri)) {
                this.log(`  Skip: shouldTrack=false`);
                return;
            }

            // 활성 세션이 없으면 무시
            if (!this.sessions || this.sessions.size === 0) {
                this.log(`  Skip: no sessions (size=${this.sessions?.size ?? 'undefined'})`);
                return;
            }

            const fileName = path.basename(relativePath);
            this.log(`  Processing: ${relativePath} (sessions=${this.sessions.size})`);

            // Git 상태 조회 (한 번만)
            let status: 'added' | 'modified' | 'deleted' = 'modified';
            if (this.gitPort && this.workspaceRoot) {
                status = await this.gitPort.getFileStatus(this.workspaceRoot, relativePath);
            }

            // 모든 활성 세션에 파일 변경 전파
            for (const [, sessionContext] of this.sessions) {
                await this.notifyFileChange(sessionContext, relativePath, fileName, status);
            }
        };

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('sidecar.includeFiles')) {
                    this.reload();
                }
            })
        );

        context.subscriptions.push(fileWatcher);
        context.subscriptions.push(fileWatcher.onDidChange(handleFileChange));
        context.subscriptions.push(fileWatcher.onDidCreate(handleFileChange));

        // Watch for git commits by monitoring .git/HEAD changes
        this.setupGitCommitWatcher(context);
    }

    /**
     * Setup watcher for git commits
     * Monitors .git/HEAD and .git/refs to detect commits
     */
    private setupGitCommitWatcher(context: vscode.ExtensionContext): void {
        if (!this.workspaceRoot) return;

        // Initialize last commit hash
        this.updateLastHeadCommit();

        // Watch .git/HEAD and refs for commit changes
        const gitPattern = new vscode.RelativePattern(
            this.workspaceRoot,
            '.git/{HEAD,refs/**,index}'
        );
        this.gitHeadWatcher = vscode.workspace.createFileSystemWatcher(gitPattern);

        const handleGitChange = async () => {
            const currentCommit = await this.getCurrentHeadCommit();
            if (currentCommit && currentCommit !== this.lastHeadCommit) {
                this.log(`Git commit detected: ${this.lastHeadCommit?.slice(0, 7)} -> ${currentCommit.slice(0, 7)}`);
                this.lastHeadCommit = currentCommit;
                await this.handleCommit();
            }
        };

        context.subscriptions.push(this.gitHeadWatcher);
        context.subscriptions.push(this.gitHeadWatcher.onDidChange(handleGitChange));
        context.subscriptions.push(this.gitHeadWatcher.onDidCreate(handleGitChange));
    }

    private async updateLastHeadCommit(): Promise<void> {
        this.lastHeadCommit = await this.getCurrentHeadCommit();
    }

    private getCurrentHeadCommit(): Promise<string | undefined> {
        if (!this.workspaceRoot) return Promise.resolve(undefined);

        return new Promise((resolve) => {
            const { exec } = require('child_process');
            exec(
                `cd "${this.workspaceRoot}" && git rev-parse HEAD`,
                { maxBuffer: 1024 },
                (error: Error | null, stdout: string) => {
                    if (error) {
                        resolve(undefined);
                    } else {
                        resolve(stdout.trim());
                    }
                }
            );
        });
    }

    /**
     * Handle git commit - refresh session files
     * Remove files that are no longer changed after commit
     */
    private async handleCommit(): Promise<void> {
        if (!this.sessions || this.sessions.size === 0) {
            this.log('  Skip commit handling: no active sessions');
            return;
        }

        if (!this.gitPort || !this.workspaceRoot) {
            this.log('  Skip commit handling: no gitPort or workspaceRoot');
            return;
        }

        this.log('Refreshing session files after commit...');

        // Get current uncommitted files from git
        const uncommittedFiles = await this.gitPort.getUncommittedFilesWithStatus(this.workspaceRoot);
        const uncommittedPaths = new Set(uncommittedFiles.map(f => f.path));

        // Update each session
        for (const [terminalId, sessionContext] of this.sessions) {
            const { stateManager } = sessionContext;
            const currentState = stateManager.getState();

            // Find files that were committed (no longer in uncommitted list)
            const committedFiles = currentState.sessionFiles.filter(
                f => !uncommittedPaths.has(f.path)
            );

            // Remove committed files from session
            for (const file of committedFiles) {
                this.log(`  Removing committed file: ${file.path}`);
                stateManager.removeSessionFile(file.path);
            }

            // Update baseline with current uncommitted files
            const baselineFiles: FileInfo[] = uncommittedFiles.map(f => ({
                path: f.path,
                name: path.basename(f.path),
                status: f.status,
            }));
            stateManager.setBaseline(baselineFiles);

            this.log(`  Session ${terminalId}: removed ${committedFiles.length} committed files`);
        }
    }

    /**
     * 특정 세션에 파일 변경 알림
     */
    private async notifyFileChange(
        context: SessionContext,
        relativePath: string,
        fileName: string,
        status: 'added' | 'modified' | 'deleted'
    ): Promise<void> {
        const { stateManager, generateDiffUseCase } = context;
        const currentState = stateManager.getState();

        // Baseline에서 Session으로 이동 또는 새 파일 추가
        if (stateManager.isInBaseline(relativePath)) {
            stateManager.moveToSession(relativePath);
        } else {
            const existsInSession = currentState.sessionFiles.some(
                (f) => f.path === relativePath
            );
            if (!existsInSession) {
                stateManager.addSessionFile({
                    path: relativePath,
                    name: fileName,
                    status,
                });
            }
        }

        // 첫 파일이거나 현재 선택된 파일이면 Diff 갱신
        const isFirstFile =
            currentState.sessionFiles.length === 0 &&
            !stateManager.isInBaseline(relativePath);
        const isSelectedFile = currentState.selectedFile === relativePath;

        if (isFirstFile || isSelectedFile) {
            const diffResult = await generateDiffUseCase.execute(relativePath);
            if (diffResult) {
                const displayState = await this.createDiffDisplayState(diffResult, relativePath);
                stateManager.showDiff(displayState);
            }
        }
    }

    private async createDiffDisplayState(diff: DiffResult, filePath: string): Promise<DiffDisplayState> {
        const chunkStates: ChunkDisplayInfo[] = diff.chunks.map((chunk, index) => ({
            index,
            isCollapsed: false,
            scopeLabel: null,
        }));

        const displayState: DiffDisplayState = {
            ...diff,
            chunkStates,
            scopes: [],
        };

        // For markdown files, add full content and change info for preview
        const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown') || filePath.endsWith('.mdx');
        if (isMarkdown && this.workspaceRoot) {
            const fullContent = await this.readFullFileContent(filePath);
            if (fullContent !== null) {
                displayState.newFileContent = fullContent;
                displayState.changedLineNumbers = this.extractChangedLineNumbers(diff);
                displayState.deletions = this.extractDeletions(diff);
            }
        }

        return displayState;
    }

    private async readFullFileContent(relativePath: string): Promise<string | null> {
        if (!this.workspaceRoot) return null;
        try {
            const absolutePath = path.join(this.workspaceRoot, relativePath);
            const uri = vscode.Uri.file(absolutePath);
            const content = await vscode.workspace.fs.readFile(uri);
            return Buffer.from(content).toString('utf8');
        } catch {
            return null;
        }
    }

    private extractChangedLineNumbers(diff: DiffResult): number[] {
        const changedLines: number[] = [];
        for (const chunk of diff.chunks) {
            for (const line of chunk.lines) {
                if (line.type === 'addition' && line.newLineNumber) {
                    changedLines.push(line.newLineNumber);
                }
            }
        }
        return changedLines;
    }

    private extractDeletions(diff: DiffResult): { afterLine: number; content: string[] }[] {
        const deletions: { afterLine: number; content: string[] }[] = [];

        for (const chunk of diff.chunks) {
            let currentDeletion: { afterLine: number; content: string[] } | null = null;
            let lastNewLineNum = chunk.newStart - 1;

            for (const line of chunk.lines) {
                if (line.type === 'deletion') {
                    if (!currentDeletion) {
                        currentDeletion = { afterLine: lastNewLineNum, content: [] };
                    }
                    currentDeletion.content.push(line.content);
                } else {
                    if (currentDeletion) {
                        deletions.push(currentDeletion);
                        currentDeletion = null;
                    }
                    if (line.newLineNumber) {
                        lastNewLineNum = line.newLineNumber;
                    }
                }
            }

            if (currentDeletion) {
                deletions.push(currentDeletion);
            }
        }

        return deletions;
    }
}
