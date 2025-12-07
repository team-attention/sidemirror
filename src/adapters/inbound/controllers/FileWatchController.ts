import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { DiffDisplayState, ChunkDisplayInfo, FileInfo } from '../../../application/ports/outbound/PanelState';
import { DiffResult } from '../../../domain/entities/Diff';

/**
 * Fixed-size circular buffer to prevent memory growth.
 * When full, new items overwrite oldest entries.
 */
class CircularBuffer<T> {
    private buffer: (T | undefined)[];
    private head = 0;
    private tail = 0;
    private _size = 0;

    constructor(private capacity: number) {
        this.buffer = new Array(capacity);
    }

    push(item: T): void {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        if (this._size < this.capacity) {
            this._size++;
        } else {
            this.head = (this.head + 1) % this.capacity;
        }
    }

    get size(): number {
        return this._size;
    }

    *[Symbol.iterator](): Iterator<T> {
        for (let i = 0; i < this._size; i++) {
            const index = (this.head + i) % this.capacity;
            yield this.buffer[index] as T;
        }
    }

    countIf(predicate: (item: T) => boolean): number {
        let count = 0;
        for (const item of this) {
            if (predicate(item)) count++;
        }
        return count;
    }

    clear(): void {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.tail = 0;
        this._size = 0;
    }
}

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

    // ===== Debug metrics =====
    private eventCount = 0;
    private eventCountWindow = new CircularBuffer<number>(1000); // timestamps of recent events
    private processedCount = 0;
    private lastStatsLog = Date.now();
    private pendingEvents = 0;
    private maxPendingEvents = 0;

    constructor() {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    private log(message: string): void {
        if (!this.debugChannel) return;
        const timestamp = new Date().toISOString().substring(11, 23);
        this.debugChannel.appendLine(`[Sidecar] [${timestamp}] ${message}`);
    }

    private logStats(): void {
        const now = Date.now();
        // Log stats every 10 seconds
        if (now - this.lastStatsLog < 10000) return;

        // Calculate events per second (last 10 seconds) using circular buffer
        const windowStart = now - 10000;
        const recentCount = this.eventCountWindow.countIf(t => t > windowStart);
        const eventsPerSecond = (recentCount / 10).toFixed(1);

        const memUsage = process.memoryUsage();
        const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
        const rssMB = (memUsage.rss / 1024 / 1024).toFixed(1);

        this.log(`📊 STATS: events/sec=${eventsPerSecond}, pending=${this.pendingEvents}, maxPending=${this.maxPendingEvents}, processed=${this.processedCount}, heap=${heapMB}MB, rss=${rssMB}MB`);

        if (recentCount > 50) {
            this.log(`⚠️ WARNING: High event rate detected! ${recentCount} events in last 10 seconds`);
        }

        this.lastStatsLog = now;
        this.maxPendingEvents = Math.max(this.maxPendingEvents, this.pendingEvents);
    }

    private logError(context: string, error: unknown): void {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        this.log(`❌ ERROR [${context}]: ${errorMsg}`);
        if (stack) {
            this.log(`  Stack: ${stack.split('\n').slice(0, 3).join(' -> ')}`);
        }
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

        // 항상 제외할 패턴
        this.gitignore.add([
            '.git',
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

        const inWhitelist = this.includePatterns.ignores(relativePath);
        const inGitignore = this.gitignore.ignores(relativePath);

        this.log(`  shouldTrack: ${relativePath} (whitelist=${inWhitelist}, gitignore=${inGitignore})`);

        if (inWhitelist) {
            return true;
        }

        if (inGitignore) {
            return false;
        }

        return true;
    }

    activate(context: vscode.ExtensionContext): void {
        this.debugChannel = vscode.window.createOutputChannel('Sidecar FileWatch');
        context.subscriptions.push(this.debugChannel);

        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

        const handleFileChange = async (uri: vscode.Uri) => {
            const startTime = Date.now();
            const relativePath = vscode.workspace.asRelativePath(uri);

            // Track event
            this.eventCount++;
            this.eventCountWindow.push(Date.now());
            this.pendingEvents++;
            this.maxPendingEvents = Math.max(this.maxPendingEvents, this.pendingEvents);

            this.log(`📁 Event #${this.eventCount}: ${relativePath} (pending=${this.pendingEvents})`);
            this.logStats();

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.Directory) {
                    this.log(`  Skip: directory`);
                    this.pendingEvents--;
                    return;
                }
            } catch (error) {
                this.log(`  Skip: stat failed`);
                this.logError('stat', error);
                this.pendingEvents--;
                return;
            }

            if (!this.shouldTrack(uri)) {
                this.log(`  Skip: shouldTrack=false`);
                this.pendingEvents--;
                return;
            }

            // 활성 세션이 없으면 무시
            if (!this.sessions || this.sessions.size === 0) {
                this.log(`  Skip: no sessions (size=${this.sessions?.size ?? 'undefined'})`);
                this.pendingEvents--;
                return;
            }

            const fileName = path.basename(relativePath);
            this.log(`  Processing: ${relativePath} (sessions=${this.sessions.size})`);

            try {
                // Git 상태 조회 (한 번만)
                const gitStart = Date.now();
                let status: 'added' | 'modified' | 'deleted' = 'modified';
                if (this.gitPort && this.workspaceRoot) {
                    status = await this.gitPort.getFileStatus(this.workspaceRoot, relativePath);
                }
                const gitTime = Date.now() - gitStart;
                if (gitTime > 100) {
                    this.log(`  ⚠️ Slow git status: ${gitTime}ms`);
                }

                // 모든 활성 세션에 파일 변경 전파
                for (const [terminalId, sessionContext] of this.sessions) {
                    const notifyStart = Date.now();
                    await this.notifyFileChange(sessionContext, relativePath, fileName, status);
                    const notifyTime = Date.now() - notifyStart;
                    if (notifyTime > 100) {
                        this.log(`  ⚠️ Slow notifyFileChange for ${terminalId}: ${notifyTime}ms`);
                    }
                }

                this.processedCount++;
                const totalTime = Date.now() - startTime;
                if (totalTime > 200) {
                    this.log(`  ⚠️ Slow event processing: ${totalTime}ms total`);
                }
            } catch (error) {
                this.logError('handleFileChange', error);
            } finally {
                this.pendingEvents--;
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
        const chunkStates: ChunkDisplayInfo[] = diff.chunks.map((_, index) => ({
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
