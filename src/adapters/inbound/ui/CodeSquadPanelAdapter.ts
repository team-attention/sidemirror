import * as vscode from 'vscode';
import * as path from 'path';
import { PanelState, DiffDisplayState, ChunkDisplayInfo, ScopedDiffDisplayState, ScopedChunkDisplay } from '../../../application/ports/outbound/PanelState';
import { IGenerateDiffUseCase } from '../../../application/ports/inbound/IGenerateDiffUseCase';
import { IGenerateScopedDiffUseCase } from '../../../application/ports/inbound/IGenerateScopedDiffUseCase';
import { IAddCommentUseCase } from '../../../application/ports/inbound/IAddCommentUseCase';
import { IEditCommentUseCase } from '../../../application/ports/inbound/IEditCommentUseCase';
import { IDeleteCommentUseCase } from '../../../application/ports/inbound/IDeleteCommentUseCase';
import { IFetchHNStoriesUseCase } from '../../../application/ports/inbound/IFetchHNStoriesUseCase';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';
import { ISymbolPort, ScopeInfo } from '../../../application/ports/outbound/ISymbolPort';
import { DiffResult, DiffChunk, DiffLine } from '../../../domain/entities/Diff';
import { ScopedDiffResult, ScopedChunk } from '../../../domain/entities/ScopedDiff';
import { getWebviewContent } from './webview';

/**
 * Webview Panel Adapter (Inbound Adapter)
 *
 * Handles user interactions from webview and calls UseCases.
 * Receives state updates via callback and renders to webview.
 *
 * Single Panel Architecture:
 * - Only one panel exists at a time (singleton)
 * - Panel switches between sessions via switchToSession()
 * - Each session maintains its own StateManager
 * - Panel connects to the focused session's StateManager
 */
export class CodeSquadPanelAdapter {
    /** Single panel instance (singleton) */
    private static instance: CodeSquadPanelAdapter | undefined;

    /** Current session's terminal ID */
    private currentTerminalId: string | undefined;

    /** Get the singleton panel instance */
    public static get currentPanel(): CodeSquadPanelAdapter | undefined {
        return CodeSquadPanelAdapter.instance;
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private disposables: vscode.Disposable[] = [];
    private onDisposeCallback: (() => void) | undefined;

    // Inbound handlers (webview → application)
    private generateDiffUseCase: IGenerateDiffUseCase | undefined;
    private generateScopedDiffUseCase: IGenerateScopedDiffUseCase | undefined;
    private addCommentUseCase: IAddCommentUseCase | undefined;
    private editCommentUseCase: IEditCommentUseCase | undefined;
    private deleteCommentUseCase: IDeleteCommentUseCase | undefined;
    private fetchHNStoriesUseCase: IFetchHNStoriesUseCase | undefined;
    private onSubmitComments: (() => Promise<void>) | undefined;
    private panelStateManager: IPanelStateManager | undefined;
    private symbolPort: ISymbolPort | undefined;
    private workspaceRoot: string | undefined;

    /**
     * Get or create the singleton panel.
     * If panel already exists, just returns it.
     */
    public static getOrCreate(context: vscode.ExtensionContext): CodeSquadPanelAdapter {
        if (CodeSquadPanelAdapter.instance) {
            return CodeSquadPanelAdapter.instance;
        }

        const panel = vscode.window.createWebviewPanel(
            'codeSquad',
            'Code Squad',
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

        // Set editor layout: Terminal 30%, Code Squad 70%
        vscode.commands.executeCommand('vscode.setEditorLayout', {
            orientation: 0, // horizontal
            groups: [
                { size: 0.3 },
                { size: 0.7 }
            ]
        });

        CodeSquadPanelAdapter.instance = new CodeSquadPanelAdapter(panel, context);
        return CodeSquadPanelAdapter.instance;
    }

    /**
     * Legacy method for backward compatibility.
     * @deprecated Use getOrCreate() instead
     */
    public static createNew(
        context: vscode.ExtensionContext,
        terminalId: string,
        workspaceRoot?: string
    ): CodeSquadPanelAdapter {
        const adapter = CodeSquadPanelAdapter.getOrCreate(context);
        adapter.currentTerminalId = terminalId;
        adapter.workspaceRoot = workspaceRoot;
        return adapter;
    }

    /**
     * Legacy method for backward compatibility.
     * @deprecated Use getOrCreate() instead
     */
    public static create(context: vscode.ExtensionContext): CodeSquadPanelAdapter {
        return CodeSquadPanelAdapter.getOrCreate(context);
    }

    /**
     * Get panel if current session matches.
     * For backward compatibility - always returns the singleton.
     */
    public static getPanel(_terminalId: string): CodeSquadPanelAdapter | undefined {
        return CodeSquadPanelAdapter.instance;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext
    ) {
        this.panel = panel;
        this.context = context;

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
                            const state = this.panelStateManager.getState();
                            const current = state.diffViewMode;
                            const selectedFile = state.selectedFile || '';
                            const isMarkdown = selectedFile.endsWith('.md') ||
                                selectedFile.endsWith('.markdown') ||
                                selectedFile.endsWith('.mdx');

                            if (isMarkdown) {
                                // Markdown: toggle between diff and preview
                                this.panelStateManager.setDiffViewMode(
                                    current === 'preview' ? 'diff' : 'preview'
                                );
                            } else {
                                // Non-markdown: toggle between diff and scope
                                this.panelStateManager.setDiffViewMode(
                                    current === 'scope' ? 'diff' : 'scope'
                                );
                            }
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
                    case 'saveDraftComment':
                        this.panelStateManager?.setDraftComment(message.draft);
                        break;
                    case 'clearDraftComment':
                        this.panelStateManager?.clearDraftComment();
                        break;
                    case 'saveScrollPosition':
                        if (message.file && message.scrollTop !== undefined) {
                            this.panelStateManager?.setFileScrollPosition(message.file, message.scrollTop);
                        }
                        break;
                    case 'refreshHNFeed':
                        await this.handleRefreshHNFeed();
                        break;
                    case 'loadMoreHNFeed':
                        await this.handleLoadMoreHNFeed();
                        break;
                    case 'openHNStory':
                        await this.handleOpenHNStory(message.url);
                        break;
                    case 'openHNStoryInPanel':
                        // Use new content view system instead of separate panel
                        this.panelStateManager?.openContentView(message.url, message.title);
                        break;
                    case 'openContentView':
                        this.panelStateManager?.openContentView(message.url, message.title);
                        break;
                    case 'closeContentView':
                        this.panelStateManager?.closeContentView();
                        break;
                    case 'openContentExternal':
                        if (message.url) {
                            vscode.env.openExternal(vscode.Uri.parse(message.url));
                        }
                        break;
                    case 'openHNComments':
                        await this.handleOpenHNComments(message.storyId);
                        break;
                    case 'toggleFeed':
                        this.panelStateManager?.toggleHNFeed();
                        break;
                    case 'toggleScopeCollapse':
                        this.panelStateManager?.toggleScopeCollapse(message.scopeId);
                        break;
                    case 'expandAllScopes':
                        this.panelStateManager?.expandAllScopes();
                        break;
                    case 'collapseAllScopes':
                        this.panelStateManager?.collapseAllScopes();
                        break;
                    case 'expandScopeForLine':
                        this.handleExpandScopeForLine(message.line);
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
        deleteCommentUseCase?: IDeleteCommentUseCase,
        fetchHNStoriesUseCase?: IFetchHNStoriesUseCase,
        generateScopedDiffUseCase?: IGenerateScopedDiffUseCase
    ): void {
        this.generateDiffUseCase = generateDiffUseCase;
        this.addCommentUseCase = addCommentUseCase;
        this.onSubmitComments = onSubmitComments;
        this.panelStateManager = panelStateManager;
        this.symbolPort = symbolPort;
        this.editCommentUseCase = editCommentUseCase;
        this.deleteCommentUseCase = deleteCommentUseCase;
        this.fetchHNStoriesUseCase = fetchHNStoriesUseCase;
        this.generateScopedDiffUseCase = generateScopedDiffUseCase;
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

        const isMarkdown = file.endsWith('.md') || file.endsWith('.markdown') || file.endsWith('.mdx');

        // Always fetch regular diff first
        const diffResult = await this.generateDiffUseCase.execute(file);

        if (diffResult === null) {
            this.panelStateManager.removeSessionFile(file);
            return;
        }

        // For markdown files, prefetch scopes and content in parallel
        if (isMarkdown) {
            const [scopes, fullContent] = await Promise.all([
                this.prefetchScopes(file, diffResult),
                this.readFullFileContent(file)
            ]);
            const displayState = this.createDiffDisplayState(diffResult, scopes);
            if (fullContent !== null) {
                displayState.newFileContent = fullContent;
                displayState.changedLineNumbers = this.extractChangedLineNumbers(diffResult);
                displayState.deletions = this.extractDeletions(diffResult);
            }
            // Markdown: no scoped diff, just diff/preview toggle
            this.panelStateManager.showDiff(displayState);
            return;
        }

        // For non-markdown files, prefetch scopes and scoped diff in parallel
        const [scopes, scopedResult] = await Promise.all([
            this.prefetchScopes(file, diffResult),
            this.generateScopedDiffUseCase
                ? this.generateScopedDiffUseCase.execute(file).catch(error => {
                    console.warn('[Code Squad] Scoped diff failed:', error);
                    return null;
                })
                : Promise.resolve(null)
        ]);

        const displayState = this.createDiffDisplayState(diffResult, scopes);
        const scopedDisplayState = scopedResult?.hasScopeData
            ? this.createScopedDiffDisplayState(scopedResult)
            : null;

        // Show both diff and scopedDiff (if available)
        this.panelStateManager.showDiff(displayState, scopedDisplayState ?? undefined);
    }

    private async readFullFileContent(relativePath: string): Promise<string | null> {
        try {
            // Use session's workspaceRoot for worktree support, fallback to VSCode workspace
            const effectiveRoot = this.workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!effectiveRoot) return null;

            const absolutePath = path.join(effectiveRoot, relativePath);
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

    // ===== Scoped Diff helpers =====

    private createScopedDiffDisplayState(result: ScopedDiffResult): ScopedDiffDisplayState {
        const scopes = this.convertToDisplayScopes(result.root, 0);

        return {
            file: result.file,
            scopes,
            orphanLines: result.orphanLines,
            stats: result.stats,
            hasScopeData: result.hasScopeData,
        };
    }

    private convertToDisplayScopes(
        chunks: ScopedChunk[],
        depth: number
    ): ScopedChunkDisplay[] {
        return chunks.map((chunk) => {
            const scopeId = `${chunk.scope.fullName}-${chunk.scope.startLine}`;

            return {
                scopeId,
                scopeName: chunk.scope.displayName,
                scopeKind: chunk.scope.kind,
                fullName: chunk.scope.fullName,
                hasChanges: chunk.hasChanges,
                isCollapsed: !chunk.hasChanges, // Default: collapsed if no changes
                lines: chunk.lines,
                stats: chunk.stats,
                children: this.convertToDisplayScopes(chunk.children, depth + 1),
                depth,
            };
        });
    }

    private handleExpandScopeForLine(line: number): void {
        if (!this.panelStateManager?.getState().scopedDiff) return;

        const scopeId = this.findScopeIdForLine(
            line,
            this.panelStateManager.getState().scopedDiff!.scopes
        );

        if (scopeId) {
            this.panelStateManager.expandScopeChain(scopeId);
        }
    }

    private findScopeIdForLine(
        line: number,
        scopes: ScopedChunkDisplay[]
    ): string | null {
        for (const scope of scopes) {
            // Check if line is in this scope's lines
            const hasLine = scope.lines.some((l) => l.lineNumber === line);
            if (hasLine) {
                // Check children first for innermost scope
                const childId = this.findScopeIdForLine(line, scope.children);
                return childId || scope.scopeId;
            }
        }
        return null;
    }

    private async handleAddComment(message: {
        file: string;
        line: number;
        endLine?: number;
        text: string;
        context?: string;
    }): Promise<void> {
        if (!this.addCommentUseCase || !this.panelStateManager) return;

        // Get threadId from panel state for per-thread comment association
        const threadId = this.panelStateManager.getThreadId();

        const comment = await this.addCommentUseCase.execute({
            file: message.file,
            line: message.line,
            endLine: message.endLine,
            text: message.text,
            codeContext: message.context || '',
            threadId,
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

        const basePath = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!basePath) return;

        const absolutePath = path.join(basePath, file);
        const uri = vscode.Uri.file(absolutePath);

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            // Open in the same view column as the sidecar panel
            const viewColumn = this.panel.viewColumn ?? vscode.ViewColumn.One;
            await vscode.window.showTextDocument(document, viewColumn);
        } catch (error) {
            console.error('[Code Squad] Failed to open file:', error);
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

    private async handleRefreshHNFeed(): Promise<void> {
        if (!this.fetchHNStoriesUseCase || !this.panelStateManager) return;

        try {
            this.panelStateManager.setHNFeedLoading();
            const result = await this.fetchHNStoriesUseCase.execute();
            const storyInfos = result.stories.map(story => ({
                id: story.id,
                title: story.title,
                url: story.url,
                score: story.score,
                descendants: story.descendants,
                by: story.by,
                time: story.time,
                domain: story.domain,
                discussionUrl: story.discussionUrl,
                timeAgo: story.timeAgo,
            }));
            this.panelStateManager.setHNStories(storyInfos, result.fetchedAt, result.hasMore);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch stories';
            this.panelStateManager.setHNFeedError(errorMessage);
        }
    }

    private async handleLoadMoreHNFeed(): Promise<void> {
        if (!this.fetchHNStoriesUseCase || !this.panelStateManager) return;

        try {
            this.panelStateManager.setHNLoadingMore(true);
            const result = await this.fetchHNStoriesUseCase.loadMore();
            const storyInfos = result.stories.map(story => ({
                id: story.id,
                title: story.title,
                url: story.url,
                score: story.score,
                descendants: story.descendants,
                by: story.by,
                time: story.time,
                domain: story.domain,
                discussionUrl: story.discussionUrl,
                timeAgo: story.timeAgo,
            }));
            this.panelStateManager.setHNStories(storyInfos, result.fetchedAt, result.hasMore);
        } catch (error) {
            this.panelStateManager.setHNLoadingMore(false);
        }
    }

    private async handleOpenHNStory(url: string): Promise<void> {
        if (!url) return;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }

    private async handleOpenHNComments(storyId: number): Promise<void> {
        if (!storyId) return;
        const hnUrl = `https://news.ycombinator.com/item?id=${storyId}`;
        await vscode.env.openExternal(vscode.Uri.parse(hnUrl));
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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

    public getTerminalId(): string | undefined {
        return this.currentTerminalId;
    }

    /**
     * Switch panel to display a different session's state.
     * Disconnects from previous StateManager and connects to new one.
     */
    public switchToSession(
        terminalId: string,
        workspaceRoot: string | undefined,
        generateDiffUseCase: IGenerateDiffUseCase,
        addCommentUseCase: IAddCommentUseCase,
        onSubmitComments: () => Promise<void>,
        panelStateManager: IPanelStateManager,
        symbolPort?: ISymbolPort,
        editCommentUseCase?: IEditCommentUseCase,
        deleteCommentUseCase?: IDeleteCommentUseCase,
        fetchHNStoriesUseCase?: IFetchHNStoriesUseCase,
        generateScopedDiffUseCase?: IGenerateScopedDiffUseCase
    ): void {
        console.log(`[Code Squad] Switching panel to session: ${terminalId}`);

        this.currentTerminalId = terminalId;
        this.workspaceRoot = workspaceRoot;

        // Update use cases and handlers
        this.generateDiffUseCase = generateDiffUseCase;
        this.addCommentUseCase = addCommentUseCase;
        this.onSubmitComments = onSubmitComments;
        this.panelStateManager = panelStateManager;
        this.symbolPort = symbolPort;
        this.editCommentUseCase = editCommentUseCase;
        this.deleteCommentUseCase = deleteCommentUseCase;
        this.fetchHNStoriesUseCase = fetchHNStoriesUseCase;
        this.generateScopedDiffUseCase = generateScopedDiffUseCase;

        // Update panel title
        this.panel.title = `Code Squad`;

        // Re-render with new session's state
        const state = panelStateManager.getState();
        this.render(state);

        // Auto-select first file if no file is selected but session has files
        // This handles the case where files were added while another session was focused
        if (!state.selectedFile && state.sessionFiles.length > 0) {
            const firstFile = state.sessionFiles[0];
            console.log(`[Code Squad] Auto-selecting first file: ${firstFile.path}`);
            this.handleSelectFile(firstFile.path);
        }
    }

    /** Check if panel is still valid/active */
    private isActive(): boolean {
        try {
            // Accessing panel.visible will throw if panel is disposed
            return this.panel.visible !== undefined;
        } catch {
            return false;
        }
    }

    public dispose(): void {
        console.log(`[Code Squad] Panel dispose START`);

        // Clear singleton reference
        CodeSquadPanelAdapter.instance = undefined;

        // Notify webview to cleanup before destroying
        try {
            this.panel.webview.postMessage({ type: 'dispose' });
        } catch (e) {
            // Panel might already be disposed, ignore
        }

        // Fire callback
        try {
            console.log(`[Code Squad] Calling onDisposeCallback`);
            this.onDisposeCallback?.();
            console.log(`[Code Squad] onDisposeCallback completed`);
        } catch (e) {
            console.error(`[Code Squad] onDisposeCallback error:`, e);
        }

        // Dispose all disposables safely
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                try {
                    x.dispose();
                } catch (e) {
                    // Ignore individual dispose errors
                }
            }
        }

        // Finally dispose the panel
        try {
            this.panel.dispose();
        } catch (e) {
            // Panel might already be disposed, ignore
        }
    }

    private initializeWebview(): void {
        this.panel.webview.html = this.getHtmlForWebview();
    }

    private getHtmlForWebview(): string {
        // Get URI for the bundled webview script (includes all UI logic + Shiki highlighter)
        const bundledScriptPath = vscode.Uri.joinPath(
            this.context.extensionUri,
            'dist',
            'webview.js'
        );
        const bundledScriptUri = this.panel.webview.asWebviewUri(bundledScriptPath);

        return getWebviewContent(bundledScriptUri.toString());
    }
}
