import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';
import { IGenerateDiffUseCase } from '../../../application/ports/inbound/IGenerateDiffUseCase';

export class FileWatchController {
    private gitignore: Ignore;
    private includePatterns: Ignore;
    private workspaceRoot: string | undefined;
    private panelStateManager: IPanelStateManager | undefined;
    private generateDiffUseCase: IGenerateDiffUseCase | undefined;

    constructor() {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    setPanelStateManager(panelStateManager: IPanelStateManager): void {
        this.panelStateManager = panelStateManager;
    }

    setGenerateDiffUseCase(generateDiffUseCase: IGenerateDiffUseCase): void {
        this.generateDiffUseCase = generateDiffUseCase;
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
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

        const handleFileChange = async (uri: vscode.Uri) => {
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.Directory) {
                    return;
                }
            } catch {
                return;
            }

            if (!this.shouldTrack(uri)) return;

            if (this.panelStateManager) {
                const relativePath = vscode.workspace.asRelativePath(uri);
                const fileName = path.basename(relativePath);
                const currentState = this.panelStateManager.getState();

                if (this.panelStateManager.isInBaseline(relativePath)) {
                    this.panelStateManager.moveToSession(relativePath);
                } else {
                    const existsInSession = currentState.sessionFiles.some(
                        (f) => f.path === relativePath
                    );
                    if (!existsInSession) {
                        this.panelStateManager.addSessionFile({
                            path: relativePath,
                            name: fileName,
                            status: 'modified',
                        });
                    }
                }

                const isFirstFile =
                    currentState.sessionFiles.length === 0 &&
                    !this.panelStateManager.isInBaseline(relativePath);
                const isSelectedFile = currentState.selectedFile === relativePath;

                if (this.generateDiffUseCase && (isFirstFile || isSelectedFile)) {
                    const diffResult = await this.generateDiffUseCase.execute(relativePath);
                    if (diffResult) {
                        this.panelStateManager.showDiff(diffResult);
                    }
                }
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
    }
}
