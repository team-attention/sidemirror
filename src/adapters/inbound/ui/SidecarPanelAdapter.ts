import * as vscode from 'vscode';
import * as path from 'path';
import { PanelState, DiffDisplayState, ChunkDisplayInfo } from '../../../application/ports/outbound/PanelState';
import { IGenerateDiffUseCase } from '../../../application/ports/inbound/IGenerateDiffUseCase';
import { IAddCommentUseCase } from '../../../application/ports/inbound/IAddCommentUseCase';
import { IEditCommentUseCase } from '../../../application/ports/inbound/IEditCommentUseCase';
import { IDeleteCommentUseCase } from '../../../application/ports/inbound/IDeleteCommentUseCase';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';
import { ISymbolPort, ScopeInfo } from '../../../application/ports/outbound/ISymbolPort';
import { DiffResult, DiffChunk } from '../../../domain/entities/Diff';
import { getWebviewContent } from './webview';

/**
 * Webview Panel Adapter (Inbound Adapter)
 *
 * Handles user interactions from webview and calls UseCases.
 * Receives state updates via callback and renders to webview.
 */
export class SidecarPanelAdapter {
    /** 활성 패널 추적 (terminalId → adapter) */
    private static activePanels = new Map<string, SidecarPanelAdapter>();

    /** 싱글톤 호환용 - 마지막 활성 패널 (deprecated, 마이그레이션용) */
    public static get currentPanel(): SidecarPanelAdapter | undefined {
        const entries = Array.from(SidecarPanelAdapter.activePanels.values());
        return entries[entries.length - 1];
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private readonly terminalId: string;
    private disposables: vscode.Disposable[] = [];
    private onDisposeCallback: (() => void) | undefined;

    // Inbound handlers (webview → application)
    private generateDiffUseCase: IGenerateDiffUseCase | undefined;
    private addCommentUseCase: IAddCommentUseCase | undefined;
    private editCommentUseCase: IEditCommentUseCase | undefined;
    private deleteCommentUseCase: IDeleteCommentUseCase | undefined;
    private onSubmitComments: (() => Promise<void>) | undefined;
    private panelStateManager: IPanelStateManager | undefined;
    private symbolPort: ISymbolPort | undefined;

    /**
     * 새 패널 생성 (터미널별 독립)
     */
    public static createNew(
        context: vscode.ExtensionContext,
        terminalId: string
    ): SidecarPanelAdapter {
        // 이미 이 터미널에 패널이 있으면 반환
        const existing = SidecarPanelAdapter.activePanels.get(terminalId);
        if (existing) {
            existing.show();
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            'sidecar',
            `Sidecar (${terminalId})`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'out'),
                    vscode.Uri.joinPath(context.extensionUri, 'dist')
                ]
            }
        );

        const adapter = new SidecarPanelAdapter(panel, context, terminalId);
        SidecarPanelAdapter.activePanels.set(terminalId, adapter);
        return adapter;
    }

    /**
     * 기존 create() - deprecated, 호환성 유지용
     * 새 코드는 createNew() 사용
     */
    public static create(context: vscode.ExtensionContext): SidecarPanelAdapter {
        const defaultTerminalId = 'default';
        return SidecarPanelAdapter.createNew(context, defaultTerminalId);
    }

    /** 특정 터미널의 패널 조회 */
    public static getPanel(terminalId: string): SidecarPanelAdapter | undefined {
        return SidecarPanelAdapter.activePanels.get(terminalId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        terminalId: string = 'default'
    ) {
        this.panel = panel;
        this.context = context;
        this.terminalId = terminalId;

        this.initializeWebview();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle inbound messages from webview
        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'submitComments':
                        await this.handleSubmitComments();
                        break;
                    case 'selectFile':
                        await this.handleSelectFile(message.file);
                        break;
                    case 'addComment':
                        await this.handleAddComment(message);
                        break;
                    case 'toggleUncommitted':
                        this.panelStateManager?.toggleShowUncommitted();
                        break;
                    case 'toggleChunkCollapse':
                        this.panelStateManager?.toggleChunkCollapse(message.index);
                        break;
                    case 'toggleAllChunks':
                        if (this.panelStateManager) {
                            const state = this.panelStateManager.getState();
                            const allCollapsed = state.diff?.chunkStates?.every(s => s.isCollapsed) ?? false;
                            if (allCollapsed) {
                                this.panelStateManager.expandAllChunks();
                            } else {
                                this.panelStateManager.collapseAllChunks();
                            }
                        }
                        break;
                    case 'toggleViewMode':
                        if (this.panelStateManager) {
                            const current = this.panelStateManager.getState().isTreeView;
                            this.panelStateManager.setTreeView(!current);
                        }
                        break;
                    case 'toggleDiffViewMode':
                        if (this.panelStateManager) {
                            const current = this.panelStateManager.getState().diffViewMode;
                            this.panelStateManager.setDiffViewMode(current === 'preview' ? 'diff' : 'preview');
                        }
                        break;
                    case 'setSearchQuery':
                        this.panelStateManager?.setSearchQuery(message.query);
                        break;
                    case 'openFile':
                        await this.handleOpenFile(message.file);
                        break;
                    case 'editComment':
                        await this.handleEditComment(message.id, message.text);
                        break;
                    case 'deleteComment':
                        await this.handleDeleteComment(message.id);
                        break;
                    case 'navigateToComment':
                        await this.handleNavigateToComment(message.id);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    /**
     * Set inbound handlers for webview interactions
     */
    setUseCases(
        generateDiffUseCase: IGenerateDiffUseCase,
        addCommentUseCase: IAddCommentUseCase,
        onSubmitComments: () => Promise<void>,
        panelStateManager?: IPanelStateManager,
        symbolPort?: ISymbolPort,
        editCommentUseCase?: IEditCommentUseCase,
        deleteCommentUseCase?: IDeleteCommentUseCase
    ): void {
        this.generateDiffUseCase = generateDiffUseCase;
        this.addCommentUseCase = addCommentUseCase;
        this.onSubmitComments = onSubmitComments;
        this.panelStateManager = panelStateManager;
        this.symbolPort = symbolPort;
        this.editCommentUseCase = editCommentUseCase;
        this.deleteCommentUseCase = deleteCommentUseCase;
    }

    /**
     * Set callback for when panel is disposed
     */
    onDispose(callback: () => void): void {
        this.onDisposeCallback = callback;
    }

    // ===== Inbound message handlers =====

    private async handleSelectFile(file: string): Promise<void> {
        if (!file || !this.generateDiffUseCase || !this.panelStateManager) return;

        const diffResult = await this.generateDiffUseCase.execute(file);

        if (diffResult === null) {
            this.panelStateManager.removeSessionFile(file);
        } else {
            const scopes = await this.prefetchScopes(file, diffResult);
            const displayState = this.createDiffDisplayState(diffResult, scopes);

            // For markdown files, fetch full content for preview
            const isMarkdown = file.endsWith('.md') || file.endsWith('.markdown') || file.endsWith('.mdx');
            if (isMarkdown) {
                const fullContent = await this.readFullFileContent(file);
                if (fullContent !== null) {
                    displayState.newFileContent = fullContent;
                    displayState.changedLineNumbers = this.extractChangedLineNumbers(diffResult);
                    displayState.deletions = this.extractDeletions(diffResult);
                }
            }

            this.panelStateManager.showDiff(displayState);
        }
    }

    private async readFullFileContent(relativePath: string): Promise<string | null> {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) return null;

            const absolutePath = path.join(workspaceRoot, relativePath);
            const uri = vscode.Uri.file(absolutePath);
            const content = await vscode.workspace.fs.readFile(uri);
            return Buffer.from(content).toString('utf8');
        } catch {
            return null;
        }
    }

    private extractChangedLineNumbers(diffResult: DiffResult): number[] {
        const changedLines: number[] = [];
        for (const chunk of diffResult.chunks) {
            for (const line of chunk.lines) {
                if (line.type === 'addition' && line.newLineNumber) {
                    changedLines.push(line.newLineNumber);
                }
            }
        }
        return changedLines;
    }

    private extractDeletions(diffResult: DiffResult): { afterLine: number; content: string[] }[] {
        const deletions: { afterLine: number; content: string[] }[] = [];

        for (const chunk of diffResult.chunks) {
            let currentDeletion: { afterLine: number; content: string[] } | null = null;
            let lastNewLineNum = chunk.newStart - 1; // Track position in new file

            for (const line of chunk.lines) {
                if (line.type === 'deletion') {
                    if (!currentDeletion) {
                        currentDeletion = { afterLine: lastNewLineNum, content: [] };
                    }
                    currentDeletion.content.push(line.content);
                } else {
                    // Flush current deletion group
                    if (currentDeletion) {
                        deletions.push(currentDeletion);
                        currentDeletion = null;
                    }
                    if (line.newLineNumber) {
                        lastNewLineNum = line.newLineNumber;
                    }
                }
            }

            // Flush remaining deletion
            if (currentDeletion) {
                deletions.push(currentDeletion);
            }
        }

        return deletions;
    }

    private async prefetchScopes(file: string, diff: DiffResult): Promise<ScopeInfo[]> {
        if (!this.symbolPort) return [];

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return [];

        const absolutePath = path.join(workspaceRoot, file);

        let minLine = Infinity;
        let maxLine = 0;
        for (const chunk of diff.chunks) {
            minLine = Math.min(minLine, chunk.newStart);
            maxLine = Math.max(maxLine, chunk.newStart + chunk.lines.length);
        }

        if (minLine === Infinity) return [];

        return this.symbolPort.getScopesForRange(absolutePath, minLine, maxLine);
    }

    private createDiffDisplayState(diff: DiffResult, scopes: ScopeInfo[]): DiffDisplayState {
        const chunkStates: ChunkDisplayInfo[] = diff.chunks.map((chunk, index) => {
            const scopeLabel = this.findScopeLabel(chunk, scopes);
            return {
                index,
                isCollapsed: false,
                scopeLabel
            };
        });

        return {
            ...diff,
            chunkStates,
            scopes
        };
    }

    private findScopeLabel(chunk: DiffChunk, scopes: ScopeInfo[]): string | null {
        if (chunk.oldStart === 0) {
            return 'New file';
        }

        // Extract line numbers of actually changed lines (not context)
        const changedLineNumbers: number[] = [];
        let lastNewLineNumber = chunk.newStart;

        for (const line of chunk.lines) {
            if (line.newLineNumber) {
                lastNewLineNumber = line.newLineNumber;
            }

            if (line.type === 'addition' && line.newLineNumber) {
                changedLineNumbers.push(line.newLineNumber);
            } else if (line.type === 'deletion') {
                // For deletions, use the position in the new file (where the deletion occurred)
                changedLineNumbers.push(lastNewLineNumber);
            }
        }

        if (changedLineNumbers.length === 0) {
            return null;
        }

        const chunkStart = Math.min(...changedLineNumbers);
        const chunkEnd = Math.max(...changedLineNumbers);

        // Structural scope kinds (always meaningful)
        const structuralKinds = ['function', 'method', 'class', 'module', 'namespace', 'interface', 'enum'];

        // Find scopes that intersect with the changed lines
        const intersectingScopes: ScopeInfo[] = [];

        for (const scope of scopes) {
            // Include structural kinds
            // Include variable/constant only if top-level (no containerName)
            const isStructural = structuralKinds.includes(scope.kind);
            const isTopLevelDeclaration =
                (scope.kind === 'variable' || scope.kind === 'constant') && !scope.containerName;

            if (!isStructural && !isTopLevelDeclaration) {
                continue;
            }

            // Check if scope intersects with changed lines
            if (scope.startLine <= chunkEnd && scope.endLine >= chunkStart) {
                intersectingScopes.push(scope);
            }
        }

        if (intersectingScopes.length === 0) {
            return null;
        }

        // Filter to most specific scopes (remove parent scopes that contain child scopes)
        const specificScopes = intersectingScopes.filter(scope => {
            return !intersectingScopes.some(other =>
                other !== scope &&
                other.startLine >= scope.startLine &&
                other.endLine <= scope.endLine
            );
        });

        // Format scope names
        const scopeNames = specificScopes.map(scope => {
            const suffix = scope.kind === 'method' || scope.kind === 'function' ? '()' : '';
            return `${scope.name}${suffix}`;
        });

        const uniqueNames = [...new Set(scopeNames)];
        return uniqueNames.join(', ');
    }

    private async handleAddComment(message: {
        file: string;
        line: number;
        endLine?: number;
        text: string;
        context?: string;
    }): Promise<void> {
        if (!this.addCommentUseCase || !this.panelStateManager) return;

        const comment = await this.addCommentUseCase.execute({
            file: message.file,
            line: message.line,
            endLine: message.endLine,
            text: message.text,
            codeContext: message.context || '',
        });

        // Update panel state with new comment
        this.panelStateManager.addComment({
            id: comment.id,
            file: comment.file,
            line: comment.line,
            endLine: comment.endLine,
            text: comment.text,
            isSubmitted: comment.isSubmitted,
            codeContext: comment.codeContext,
            timestamp: comment.timestamp,
        });
    }

    private async handleSubmitComments(): Promise<void> {
        if (!this.onSubmitComments) return;
        await this.onSubmitComments();
    }

    private async handleOpenFile(file: string): Promise<void> {
        if (!file) return;

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) return;

        const absolutePath = path.join(workspaceRoot, file);
        const uri = vscode.Uri.file(absolutePath);

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        } catch (error) {
            console.error('[Sidecar] Failed to open file:', error);
        }
    }

    private async handleEditComment(id: string, text: string): Promise<void> {
        if (!this.editCommentUseCase || !this.panelStateManager) return;

        const updated = await this.editCommentUseCase.execute({ id, text });
        if (updated) {
            this.panelStateManager.updateComment({
                id: updated.id,
                file: updated.file,
                line: updated.line,
                endLine: updated.endLine,
                text: updated.text,
                isSubmitted: updated.isSubmitted,
                codeContext: updated.codeContext,
                timestamp: updated.timestamp,
            });
        }
    }

    private async handleDeleteComment(id: string): Promise<void> {
        if (!this.deleteCommentUseCase || !this.panelStateManager) return;

        const deleted = await this.deleteCommentUseCase.execute({ id });
        if (deleted) {
            this.panelStateManager.removeComment(id);
        }
    }

    private async handleNavigateToComment(id: string): Promise<void> {
        if (!this.panelStateManager) return;

        const comment = this.panelStateManager.findCommentById(id);
        if (!comment) return;

        // Select the file to show its diff
        await this.handleSelectFile(comment.file);

        // Send scroll command to webview
        this.panel.webview.postMessage({
            type: 'scrollToLine',
            line: comment.line,
            endLine: comment.endLine,
            commentId: id,
        });
    }

    // ===== Render method =====

    /**
     * Render the panel with the given state
     * This is the single entry point for UI updates
     */
    render(state: PanelState): void {
        this.panel.webview.postMessage({
            type: 'render',
            state,
        });
    }

    show(): void {
        this.panel.reveal(vscode.ViewColumn.Two);
    }

    // ===== Private methods =====

    public getTerminalId(): string {
        return this.terminalId;
    }

    public dispose(): void {
        SidecarPanelAdapter.activePanels.delete(this.terminalId);
        this.onDisposeCallback?.();
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private initializeWebview(): void {
        this.panel.webview.html = this.getHtmlForWebview();
    }

    private getHtmlForWebview(): string {
        // Get URI for the bundled highlighter script
        const highlighterScriptPath = vscode.Uri.joinPath(
            this.context.extensionUri,
            'dist',
            'webview.js'
        );
        const highlighterScriptUri = this.panel.webview.asWebviewUri(highlighterScriptPath);

        return getWebviewContent(highlighterScriptUri.toString());
    }
}
