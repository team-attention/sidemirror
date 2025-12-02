import * as vscode from 'vscode';
import * as path from 'path';
import { PanelState, DiffDisplayState, ChunkDisplayInfo } from '../../../application/ports/outbound/PanelState';
import { IGenerateDiffUseCase } from '../../../application/ports/inbound/IGenerateDiffUseCase';
import { IAddCommentUseCase } from '../../../application/ports/inbound/IAddCommentUseCase';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';
import { ISymbolPort, ScopeInfo } from '../../../application/ports/outbound/ISymbolPort';
import { DiffResult, DiffChunk } from '../../../domain/entities/Diff';

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
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')]
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
        symbolPort?: ISymbolPort
    ): void {
        this.generateDiffUseCase = generateDiffUseCase;
        this.addCommentUseCase = addCommentUseCase;
        this.onSubmitComments = onSubmitComments;
        this.panelStateManager = panelStateManager;
        this.symbolPort = symbolPort;
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
        return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sidecar</title>
      <style>
        * {
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: 1fr 4px 320px;
          grid-template-areas: "main resizer sidebar";
          height: 100vh;
          overflow: hidden;
          transition: grid-template-columns 0.2s ease;
        }

        .sidebar {
          grid-area: sidebar;
          padding: 16px;
          border-left: 1px solid var(--vscode-panel-border);
          overflow-y: auto;
          background-color: var(--vscode-sideBar-background);
          position: relative;
          z-index: 1;
        }

        .main-content {
          grid-area: main;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background-color: var(--vscode-editor-background);
          min-width: 0;
        }

        body.sidebar-collapsed {
          grid-template-columns: 1fr 0 0;
        }

        body.sidebar-collapsed .resizer {
          display: none;
        }

        body.sidebar-collapsed .sidebar {
          display: none;
        }

        .resizer {
          grid-area: resizer;
          background: var(--vscode-panel-border);
          cursor: col-resize;
          transition: background 0.2s;
        }

        .resizer:hover,
        .resizer.dragging {
          background: var(--vscode-focusBorder, #007acc);
        }

        body.resizing {
          cursor: col-resize;
          user-select: none;
        }

        .sidebar.collapsed {
          padding: 12px 8px;
          overflow: visible;
        }

        .sidebar.collapsed .header,
        .sidebar.collapsed .section {
          display: none;
        }

        .sidebar-toggle {
          width: 24px;
          height: 24px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          cursor: pointer;
          flex-shrink: 0;
        }

        .sidebar-toggle:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        .header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
        }

        .status {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }

        .status.active {
          background: var(--vscode-testing-iconPassed, #238636);
          color: var(--vscode-button-foreground, white);
        }

        .section {
          margin-bottom: 20px;
        }

        h3 {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--vscode-descriptionForeground);
          margin: 0 0 8px 0;
          font-weight: 600;
        }

        .file-item {
          padding: 6px 10px;
          margin: 2px 0;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.1s;
        }

        .file-item:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .file-item.selected {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }

        .file-icon {
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
        }

        .file-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-badge {
          font-size: 10px;
          padding: 1px 6px;
          border-radius: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .file-badge.added {
          background: var(--vscode-gitDecoration-addedResourceForeground, #238636);
          color: var(--vscode-editor-background, white);
        }

        .file-badge.modified {
          background: var(--vscode-gitDecoration-modifiedResourceForeground, #d29922);
          color: var(--vscode-editor-background, black);
        }

        .file-badge.deleted {
          background: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
          color: var(--vscode-editor-background, white);
        }

        .file-tree {
          font-size: 12px;
        }

        .tree-node {
          user-select: none;
        }

        .tree-folder {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 0;
          cursor: pointer;
        }

        .tree-folder:hover {
          background: var(--vscode-list-hoverBackground);
          border-radius: 4px;
        }

        .tree-toggle {
          width: 16px;
          text-align: center;
          font-size: 10px;
          transition: transform 0.15s;
        }

        .tree-toggle.collapsed {
          transform: rotate(-90deg);
        }

        .tree-folder-name {
          color: var(--vscode-foreground);
        }

        .tree-folder-count {
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
          margin-left: 4px;
        }

        .tree-children {
          margin-left: 16px;
          overflow: hidden;
        }

        .tree-children.collapsed {
          display: none;
        }

        .tree-file {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          margin: 2px 0;
          border-radius: 4px;
          cursor: pointer;
        }

        .tree-file:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .tree-file.selected {
          background: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground);
        }

        .toggle-btn {
          width: auto;
          padding: 2px 8px;
          font-size: 10px;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border-radius: 4px;
          cursor: pointer;
        }

        .toggle-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }

        .view-mode-toggle {
          margin-left: auto;
        }

        .markdown-preview {
          padding: 32px 40px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-size: 15px;
          line-height: 1.7;
          color: var(--vscode-foreground);
          overflow: auto;
          height: 100%;
          width: 100%;
        }

        .markdown-preview h1 {
          font-size: 28px;
          font-weight: 600;
          margin: 0 0 20px 0;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--vscode-panel-border);
          line-height: 1.3;
        }

        .markdown-preview h2 {
          font-size: 22px;
          font-weight: 600;
          margin: 32px 0 16px 0;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
          line-height: 1.3;
        }

        .markdown-preview h3 {
          font-size: 18px;
          font-weight: 600;
          margin: 24px 0 12px 0;
          line-height: 1.4;
        }

        .markdown-preview h4 {
          font-size: 16px;
          font-weight: 600;
          margin: 20px 0 10px 0;
        }

        .markdown-preview p {
          margin: 0 0 16px 0;
        }

        .markdown-preview ul, .markdown-preview ol {
          margin: 0 0 16px 0;
          padding-left: 28px;
        }

        .markdown-preview li {
          margin: 6px 0;
          line-height: 1.6;
        }

        .markdown-preview li > ul,
        .markdown-preview li > ol {
          margin: 6px 0 6px 0;
        }

        .markdown-preview code {
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'Courier New', monospace;
          font-size: 0.9em;
          background: var(--vscode-textCodeBlock-background, rgba(110, 118, 129, 0.25));
          padding: 3px 7px;
          border-radius: 6px;
          word-break: break-word;
        }

        .markdown-preview pre {
          background: var(--vscode-textCodeBlock-background, rgba(110, 118, 129, 0.15));
          padding: 16px 20px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 0 0 16px 0;
          border: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.1));
        }

        .markdown-preview pre code {
          background: none;
          padding: 0;
          font-size: 13px;
          line-height: 1.5;
          border-radius: 0;
        }

        .markdown-preview a {
          color: var(--vscode-textLink-foreground, #58a6ff);
          text-decoration: none;
        }

        .markdown-preview a:hover {
          text-decoration: underline;
        }

        .markdown-preview strong {
          font-weight: 600;
        }

        .markdown-preview em {
          font-style: italic;
        }

        .markdown-preview hr {
          border: none;
          border-top: 1px solid var(--vscode-panel-border);
          margin: 24px 0;
        }

        .markdown-preview blockquote {
          margin: 0 0 16px 0;
          padding: 12px 20px;
          border-left: 4px solid var(--vscode-textLink-foreground, #58a6ff);
          background: var(--vscode-textCodeBlock-background, rgba(110, 118, 129, 0.1));
          border-radius: 0 6px 6px 0;
        }

        .markdown-preview blockquote p {
          margin: 0;
        }

        .markdown-preview .diff-addition {
          border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
          padding-left: 8px;
          margin-left: -11px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .markdown-preview .diff-addition:hover {
          background: var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.15));
        }

        .markdown-preview .diff-addition.preview-selected {
          background: var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.25));
        }

        .markdown-preview .diff-normal {
          cursor: pointer;
        }

        .markdown-preview .diff-normal:hover {
          background: var(--vscode-editor-hoverHighlightBackground, rgba(173, 214, 255, 0.15));
        }

        .markdown-preview .diff-normal.preview-selected {
          background: var(--vscode-editor-selectionBackground, rgba(173, 214, 255, 0.3));
        }

        .markdown-preview .diff-deletion {
          background: var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.15));
          border-left: 3px solid var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
          padding-left: 8px;
          margin-left: -11px;
          text-decoration: line-through;
          opacity: 0.7;
        }

        /* Table styles */
        .markdown-preview table {
          border-collapse: collapse;
          width: 100%;
          margin: 16px 0;
          font-size: 14px;
        }

        .markdown-preview table th,
        .markdown-preview table td {
          border: 1px solid var(--vscode-panel-border, rgba(255, 255, 255, 0.2));
          padding: 10px 14px;
          text-align: left;
        }

        .markdown-preview table th {
          background: var(--vscode-editor-selectionBackground, rgba(173, 214, 255, 0.15));
          font-weight: 600;
        }

        .markdown-preview table tr:nth-child(even) {
          background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.04));
        }

        /* Checkbox styles */
        .markdown-preview .task-list-item {
          list-style: none;
          margin-left: -20px;
        }

        .markdown-preview .task-list-item input[type="checkbox"] {
          margin-right: 8px;
          pointer-events: none;
        }

        /* Syntax highlighting */
        .markdown-preview pre code .hljs-keyword {
          color: var(--vscode-debugTokenExpression-name, #c586c0);
        }

        .markdown-preview pre code .hljs-string {
          color: var(--vscode-debugTokenExpression-string, #ce9178);
        }

        .markdown-preview pre code .hljs-number {
          color: var(--vscode-debugTokenExpression-number, #b5cea8);
        }

        .markdown-preview pre code .hljs-comment {
          color: var(--vscode-descriptionForeground, #6a9955);
          font-style: italic;
        }

        .markdown-preview pre code .hljs-function {
          color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
        }

        .markdown-preview pre code .hljs-class {
          color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
        }

        .markdown-preview pre code .hljs-variable {
          color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
        }

        .markdown-preview pre code .hljs-operator {
          color: var(--vscode-foreground, #d4d4d4);
        }

        .markdown-preview pre code .hljs-punctuation {
          color: var(--vscode-foreground, #d4d4d4);
        }

        .markdown-preview pre code .hljs-property {
          color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
        }

        .markdown-preview pre code .hljs-tag {
          color: var(--vscode-debugTokenExpression-name, #569cd6);
        }

        .markdown-preview pre code .hljs-attr {
          color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
        }

        .markdown-preview pre code .hljs-builtin {
          color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
        }

        .markdown-preview .preview-comment-form {
          margin: 12px 0;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .markdown-preview .preview-comment-form .comment-form-header {
          padding: 8px 12px;
          background: var(--vscode-titleBar-activeBackground);
          border-bottom: 1px solid var(--vscode-panel-border);
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }

        .markdown-preview .preview-comment-form textarea {
          width: 100%;
          min-height: 80px;
          padding: 12px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: none;
          resize: vertical;
          font-family: inherit;
          font-size: 13px;
          box-sizing: border-box;
        }

        .markdown-preview .preview-comment-form textarea:focus {
          outline: none;
        }

        .markdown-preview .preview-comment-form .comment-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 8px 12px;
          background: var(--vscode-titleBar-activeBackground);
          border-top: 1px solid var(--vscode-panel-border);
        }

        .markdown-preview .preview-comment-form .comment-form-actions button {
          width: auto;
          padding: 6px 12px;
        }

        .markdown-preview pre.diff-addition,
        .markdown-preview pre.diff-deletion {
          margin-left: 0;
          padding-left: 16px;
        }

        .markdown-preview-container {
          position: relative;
          height: 100%;
          width: 100%;
          display: flex;
        }

        .markdown-preview-container .markdown-preview {
          flex: 1;
          overflow: auto;
        }

        .overview-ruler {
          position: absolute;
          right: 0;
          top: 0;
          bottom: 0;
          width: 14px;
          background: var(--vscode-editorOverviewRuler-background, transparent);
          border-left: 1px solid var(--vscode-panel-border);
          pointer-events: none;
          z-index: 10;
        }

        .overview-marker {
          position: absolute;
          right: 2px;
          width: 10px;
          height: 4px;
          border-radius: 1px;
        }

        .overview-marker.addition {
          background: var(--vscode-editorOverviewRuler-addedForeground, #3fb950);
        }

        .overview-marker.deletion {
          background: var(--vscode-editorOverviewRuler-deletedForeground, #f85149);
        }

        .comment-item {
          padding: 10px;
          margin: 6px 0;
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-left: 3px solid var(--vscode-textLink-foreground, #58a6ff);
          border-radius: 0 6px 6px 0;
          font-size: 12px;
          position: relative;
        }

        .comment-item.submitted {
          opacity: 0.7;
          border-left-color: var(--vscode-descriptionForeground, #888);
          background: var(--vscode-editor-inactiveSelectionBackground);
        }

        .comment-item.submitted .comment-status {
          color: var(--vscode-testing-iconPassed, #238636);
          font-size: 10px;
          margin-left: auto;
        }


        .comment-tooltip {
          display: none;
          position: absolute;
          background: var(--vscode-editorWidget-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 11px;
          max-width: 300px;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          left: 0;
          top: 100%;
          margin-top: 4px;
        }

        .comment-item:hover .comment-tooltip {
          display: block;
        }

        .tooltip-code {
          font-family: monospace;
          background: var(--vscode-textCodeBlock-background);
          padding: 4px 6px;
          border-radius: 3px;
          margin: 4px 0;
          white-space: pre-wrap;
          max-height: 100px;
          overflow: auto;
        }

        .tooltip-time {
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
        }

        .comment-meta {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 4px;
          font-family: monospace;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        button {
          width: 100%;
          padding: 8px 12px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background 0.1s;
        }

        button:hover {
          background: var(--vscode-button-hoverBackground);
        }

        .diff-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--vscode-panel-border);
          background: var(--vscode-editor-background);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .diff-header-icon {
          font-size: 16px;
        }

        .diff-header-title {
          font-size: 13px;
          font-weight: 600;
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .diff-stats {
          margin-left: auto;
          display: flex;
          gap: 8px;
          font-size: 12px;
          font-weight: 500;
        }

        .stat-added {
          color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
        }

        .stat-removed {
          color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
        }

        .diff-container {
          flex: 1;
          overflow: auto;
          background: var(--vscode-editor-background);
        }

        .diff-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          line-height: 20px;
        }

        .col-line-num {
          width: 40px;
        }

        .col-content {
          width: auto;
        }

        .chunk-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 8px;
          background: var(--vscode-diffEditor-unchangedRegionBackground, rgba(56, 139, 253, 0.15));
          border-top: 1px solid var(--vscode-panel-border);
          border-bottom: 1px solid var(--vscode-panel-border);
          cursor: pointer;
          user-select: none;
          flex-wrap: nowrap;
          white-space: nowrap;
        }

        .chunk-header:hover {
          background: var(--vscode-list-hoverBackground);
        }

        .chunk-toggle {
          font-size: 10px;
          flex-shrink: 0;
        }

        .chunk-scope {
          font-family: monospace;
          font-size: 12px;
          color: var(--vscode-textLink-foreground);
          flex-shrink: 0;
        }

        .chunk-stats {
          margin-left: auto;
          font-size: 11px;
          font-weight: 500;
          flex-shrink: 0;
        }

        .chunk-stats .added {
          color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
        }

        .chunk-stats .removed {
          color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
        }

        .chunk-lines {
          display: table-row-group;
        }

        .chunk-lines.collapsed {
          display: none;
        }

        .diff-line {
          border: none;
        }

        .diff-line:hover {
          background: var(--vscode-list-hoverBackground) !important;
        }

        .diff-line-num {
          width: 4ch;
          padding: 0 4px;
          text-align: right;
          color: var(--vscode-editorLineNumber-foreground);
          user-select: none;
          vertical-align: top;
        }

        .diff-line-content {
          padding: 0 8px;
          white-space: pre-wrap;
          word-break: break-all;
          width: 100%;
        }

        .diff-line-content::before {
          content: attr(data-prefix);
          display: inline-block;
          width: 16px;
          margin-right: 8px;
          color: inherit;
        }

        .diff-line.addition {
          background: var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.15));
        }

        .diff-line.addition .diff-line-num {
          background: var(--vscode-diffEditorGutter-insertedLineBackground, rgba(46, 160, 67, 0.2));
          color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
        }

        .diff-line.addition .diff-line-content {
          color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .diff-line.deletion {
          background: var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.15));
        }

        .diff-line.deletion .diff-line-num {
          background: var(--vscode-diffEditorGutter-removedLineBackground, rgba(248, 81, 73, 0.2));
          color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
        }

        .diff-line.deletion .diff-line-content {
          color: var(--vscode-gitDecoration-deletedResourceForeground);
        }

        .diff-line.context {
          background: transparent;
        }

        .diff-line.line-selected {
          background: var(--vscode-editor-selectionBackground, rgba(0, 122, 204, 0.2)) !important;
        }

        .diff-line.line-selected .diff-line-num {
          background: var(--vscode-editor-selectionBackground, rgba(0, 122, 204, 0.3)) !important;
        }

        .diff-line.line-selected.selection-start {
          border-top: 1px solid var(--vscode-focusBorder, #007acc);
        }

        .diff-line.line-selected.selection-end {
          border-bottom: 1px solid var(--vscode-focusBorder, #007acc);
        }

        .comment-form-row {
          background: transparent;
        }

        .comment-form-row td {
          padding: 0 !important;
          border: none !important;
        }

        .inline-comment-form {
          display: none;
          background: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          margin: 8px 16px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .inline-comment-form.active {
          display: block;
        }

        .comment-form-header {
          padding: 8px 12px;
          background: var(--vscode-titleBar-activeBackground);
          border-bottom: 1px solid var(--vscode-panel-border);
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          font-family: monospace;
        }

        .comment-textarea {
          width: 100%;
          min-height: 80px;
          padding: 12px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: none;
          resize: vertical;
          font-family: inherit;
          font-size: 13px;
        }

        .comment-textarea:focus {
          outline: none;
        }

        .comment-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 8px 12px;
          background: var(--vscode-titleBar-activeBackground);
          border-top: 1px solid var(--vscode-panel-border);
        }

        .comment-form-actions button {
          width: auto;
          padding: 6px 12px;
        }

        .btn-secondary {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }

        .placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--vscode-descriptionForeground);
          gap: 12px;
        }

        .placeholder-icon {
          font-size: 48px;
          opacity: 0.5;
        }

        .placeholder-text {
          font-size: 14px;
        }

        .empty-text {
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          font-size: 12px;
          padding: 8px 0;
        }

        .file-item {
          position: relative;
        }

        .file-item.uncommitted {
          background: var(--vscode-list-inactiveSelectionBackground, rgba(255, 255, 255, 0.04));
          opacity: 0.7;
        }

        .file-item.uncommitted::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--vscode-gitDecoration-untrackedResourceForeground, #73c991);
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .section-header h3 {
          margin: 0;
        }

        .toggle-row {
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          opacity: 0.7;
        }

        .toggle-row:hover {
          opacity: 1;
        }

        .toggle-checkbox {
          width: 12px;
          height: 12px;
          border: 1px solid var(--vscode-checkbox-border, var(--vscode-input-border));
          border-radius: 2px;
          background: var(--vscode-checkbox-background, var(--vscode-input-background));
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          color: var(--vscode-checkbox-foreground, var(--vscode-foreground));
        }

        .toggle-checkbox.checked {
          background: var(--vscode-checkbox-selectBackground, var(--vscode-button-background));
          border-color: var(--vscode-checkbox-selectBorder, var(--vscode-button-background));
        }

        .toggle-label {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
        }

        .files-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .files-toolbar .toggle-btn {
          flex-shrink: 0;
        }

        .search-container {
          position: relative;
          flex: 1;
        }

        .search-input {
          width: 100%;
          padding: 6px 28px 6px 8px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border, transparent);
          border-radius: 4px;
          font-size: 12px;
          outline: none;
        }

        .search-input:focus {
          border-color: var(--vscode-focusBorder);
        }

        .search-input::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }

        .search-clear {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          padding: 0;
          background: transparent;
          border: none;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .search-clear:hover {
          color: var(--vscode-foreground);
        }

        .search-results {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 4px;
          padding: 0 4px;
        }

        .search-highlight {
          background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
          border-radius: 2px;
        }

        .file-item.content-match::after {
          content: '≡';
          margin-left: 4px;
          color: var(--vscode-descriptionForeground);
          font-size: 10px;
        }

        .diff-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: var(--vscode-editorWidget-background);
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .diff-search-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .diff-search-input {
          flex: 1;
          padding: 4px 8px;
          background: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border, transparent);
          border-radius: 3px;
          font-size: 12px;
          outline: none;
        }

        .diff-search-input:focus {
          border-color: var(--vscode-focusBorder);
        }

        .diff-search-count {
          font-size: 11px;
          color: var(--vscode-descriptionForeground);
          min-width: 50px;
          text-align: center;
          flex-shrink: 0;
        }

        .diff-search-nav {
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          color: var(--vscode-foreground);
          cursor: pointer;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }

        .diff-search-nav:hover {
          background: var(--vscode-toolbar-hoverBackground);
        }

        .diff-search-nav:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .diff-search-match {
          background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
          border-radius: 2px;
        }

        .diff-search-match.current {
          background: var(--vscode-editor-findMatchBackground, rgba(255, 150, 50, 0.6));
          outline: 1px solid var(--vscode-editor-findMatchBorder, #ff9632);
        }
      </style>
    </head>
    <body class="sidebar-collapsed">
      <div class="sidebar collapsed">
        <div class="header">
          <h2>Sidecar</h2>
          <div class="status" id="status-badge">
            <span id="ai-status-dot">●</span>
            <span id="ai-type">Ready</span>
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <h3>Changed Files</h3>
            <div class="toggle-row" id="toggle-row" style="display: none;">
              <span class="toggle-label">+<span id="uncommitted-count">0</span> prior changes</span>
              <div class="toggle-checkbox" id="uncommitted-toggle"></div>
            </div>
          </div>
          <div class="files-toolbar">
            <button class="toggle-btn" id="view-mode-toggle">List</button>
            <div class="search-container">
              <input type="text"
                     id="file-search"
                     class="search-input"
                     placeholder="Search files..."
                     autocomplete="off">
              <button class="search-clear" id="search-clear" style="display: none;">×</button>
            </div>
          </div>
          <div id="search-results" class="search-results" style="display: none;"></div>
          <div id="files-list">
            <div class="empty-text">Waiting for changes...</div>
          </div>
        </div>

        <div class="section">
          <h3>Comments</h3>
          <div id="comments-list">
            <div class="empty-text">No comments yet</div>
          </div>
          <button id="submit-comments" style="margin-top: 12px;">Ask AI</button>
        </div>
      </div>

      <div class="resizer" id="panel-resizer"></div>

      <div class="main-content">
        <div class="diff-header" id="viewer-header">
          <span class="diff-header-icon">📄</span>
          <span class="diff-header-title">Select a file to review</span>
          <div class="diff-stats" id="diff-stats"></div>
          <button class="sidebar-toggle" id="toggle-sidebar" aria-label="Expand file list panel">&lt;</button>
        </div>

        <div class="diff-toolbar" id="diff-toolbar" style="display: none;">
          <button class="toggle-btn" id="diff-collapse-all">Collapse</button>
          <div class="diff-search-wrapper">
            <input type="text"
                   id="diff-search-input"
                   class="diff-search-input"
                   placeholder="Find in diff..."
                   autocomplete="off">
            <span class="diff-search-count" id="diff-search-count"></span>
            <button class="diff-search-nav" id="diff-search-prev" title="Previous (Shift+Enter)">↑</button>
            <button class="diff-search-nav" id="diff-search-next" title="Next (Enter)">↓</button>
          </div>
        </div>

        <div class="diff-container" id="diff-viewer">
          <div class="placeholder">
            <div class="placeholder-icon">📝</div>
            <div class="placeholder-text">Select a modified file to view changes</div>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        // ===== Local UI state (not from application) =====
        let selectedLineNum = null;
        let selectedLineElement = null;
        let selectionStartLine = null;
        let selectionEndLine = null;
        let selectionStartRow = null;
        let selectionEndRow = null;
        let isSelecting = false;
        let isResizing = false;
        let sidebarWidth = 320;

        // ===== DOM references =====
        const bodyEl = document.body;
        const sidebarEl = document.querySelector('.sidebar');
        const toggleButton = document.getElementById('toggle-sidebar');
        const resizer = document.getElementById('panel-resizer');

        // ===== Sidebar toggle =====
        function expandSidebar() {
          bodyEl.classList.remove('sidebar-collapsed');
          sidebarEl.classList.remove('collapsed');
          bodyEl.style.gridTemplateColumns = \`1fr 4px \${sidebarWidth}px\`;
          toggleButton.textContent = '>';
          toggleButton.setAttribute('aria-label', 'Collapse file list panel');
        }

        function collapseSidebar() {
          bodyEl.classList.add('sidebar-collapsed');
          sidebarEl.classList.add('collapsed');
          bodyEl.style.gridTemplateColumns = '';
          toggleButton.textContent = '<';
          toggleButton.setAttribute('aria-label', 'Expand file list panel');
        }

        toggleButton.addEventListener('click', () => {
          bodyEl.classList.contains('sidebar-collapsed') ? expandSidebar() : collapseSidebar();
        });

        // ===== Resizer =====
        resizer.addEventListener('mousedown', (e) => {
          if (bodyEl.classList.contains('sidebar-collapsed')) return;
          isResizing = true;
          bodyEl.classList.add('resizing');
          resizer.classList.add('dragging');
          bodyEl.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
          if (!isResizing) return;
          const clampedWidth = Math.max(150, Math.min(600, window.innerWidth - e.clientX));
          sidebarWidth = clampedWidth;
          bodyEl.style.gridTemplateColumns = \`1fr 4px \${clampedWidth}px\`;
        });

        document.addEventListener('mouseup', () => {
          if (!isResizing) return;
          isResizing = false;
          bodyEl.classList.remove('resizing');
          resizer.classList.remove('dragging');
          bodyEl.style.transition = '';
        });

        // ===== Submit button =====
        document.getElementById('submit-comments').addEventListener('click', () => {
          vscode.postMessage({ type: 'submitComments' });
        });

        // ===== Toggle uncommitted files =====
        document.getElementById('toggle-row').addEventListener('click', () => {
          vscode.postMessage({ type: 'toggleUncommitted' });
        });

        // ===== File Search =====
        const searchInput = document.getElementById('file-search');
        const searchClear = document.getElementById('search-clear');
        const searchResults = document.getElementById('search-results');
        let searchDebounceTimer = null;
        let currentSearchQuery = '';

        searchInput.addEventListener('input', (e) => {
          const query = e.target.value;
          searchClear.style.display = query ? 'flex' : 'none';

          // Debounce search
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = setTimeout(() => {
            currentSearchQuery = query;
            vscode.postMessage({ type: 'setSearchQuery', query });
          }, 200);
        });

        searchClear.addEventListener('click', () => {
          searchInput.value = '';
          searchClear.style.display = 'none';
          currentSearchQuery = '';
          vscode.postMessage({ type: 'setSearchQuery', query: '' });
        });

        // ===== View Mode Toggle (List/Tree) =====
        const viewModeToggle = document.getElementById('view-mode-toggle');
        viewModeToggle.addEventListener('click', () => {
          vscode.postMessage({ type: 'toggleViewMode' });
        });

        // ===== Diff Toolbar (Collapse + Search) =====
        const diffToolbar = document.getElementById('diff-toolbar');
        const diffCollapseAll = document.getElementById('diff-collapse-all');
        const diffSearchInput = document.getElementById('diff-search-input');
        const diffSearchCount = document.getElementById('diff-search-count');
        const diffSearchPrev = document.getElementById('diff-search-prev');
        const diffSearchNext = document.getElementById('diff-search-next');

        let diffSearchQuery = '';
        let diffSearchMatches = [];
        let diffSearchCurrentIndex = -1;

        // Collapse all button
        diffCollapseAll.addEventListener('click', () => {
          vscode.postMessage({ type: 'toggleAllChunks' });
        });

        // Focus search with Ctrl+F / Cmd+F
        document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            diffSearchInput.focus();
            diffSearchInput.select();
          }
        });

        function closeDiffSearch() {
          diffSearchQuery = '';
          diffSearchInput.value = '';
          diffSearchMatches = [];
          diffSearchCurrentIndex = -1;
          clearDiffHighlights();
          diffSearchCount.textContent = '';
        }

        diffSearchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            closeDiffSearch();
            diffSearchInput.blur();
          } else if (e.key === 'Enter') {
            if (e.shiftKey) {
              navigateDiffSearch(-1);
            } else {
              navigateDiffSearch(1);
            }
          }
        });

        diffSearchInput.addEventListener('input', (e) => {
          diffSearchQuery = e.target.value;
          performDiffSearch();
        });

        diffSearchPrev.addEventListener('click', () => navigateDiffSearch(-1));
        diffSearchNext.addEventListener('click', () => navigateDiffSearch(1));

        function performDiffSearch() {
          clearDiffHighlights();
          diffSearchMatches = [];
          diffSearchCurrentIndex = -1;

          if (!diffSearchQuery) {
            diffSearchCount.textContent = '';
            updateNavButtons();
            return;
          }

          const query = diffSearchQuery.toLowerCase();
          const viewer = document.getElementById('diff-viewer');
          const contentCells = viewer.querySelectorAll('.diff-line-content');

          contentCells.forEach((cell, cellIndex) => {
            const text = cell.textContent;
            const lowerText = text.toLowerCase();
            let startIndex = 0;
            let matchIndex;

            while ((matchIndex = lowerText.indexOf(query, startIndex)) !== -1) {
              diffSearchMatches.push({
                cell,
                cellIndex,
                start: matchIndex,
                end: matchIndex + query.length,
                text: text.substring(matchIndex, matchIndex + query.length)
              });
              startIndex = matchIndex + 1;
            }
          });

          // Highlight all matches
          highlightDiffMatches();

          // Update count
          if (diffSearchMatches.length > 0) {
            diffSearchCurrentIndex = 0;
            updateCurrentMatch();
            diffSearchCount.textContent = \`1 of \${diffSearchMatches.length}\`;
          } else {
            diffSearchCount.textContent = 'No results';
          }

          updateNavButtons();
        }

        function highlightDiffMatches() {
          // Group matches by cell
          const matchesByCell = new Map();
          diffSearchMatches.forEach((match, index) => {
            if (!matchesByCell.has(match.cell)) {
              matchesByCell.set(match.cell, []);
            }
            matchesByCell.get(match.cell).push({ ...match, index });
          });

          // Apply highlights
          matchesByCell.forEach((matches, cell) => {
            const text = cell.textContent;
            const prefix = cell.dataset.prefix || '';

            // Sort matches by position (reverse order for replacement)
            matches.sort((a, b) => b.start - a.start);

            let html = escapeHtml(text);

            // Replace from end to start to preserve positions
            matches.forEach(match => {
              const before = html.substring(0, match.start);
              const matchText = html.substring(match.start, match.end);
              const after = html.substring(match.end);
              html = before + \`<span class="diff-search-match" data-match-index="\${match.index}">\${matchText}</span>\` + after;
            });

            cell.innerHTML = html;
            cell.dataset.prefix = prefix;
          });
        }

        function clearDiffHighlights() {
          const viewer = document.getElementById('diff-viewer');
          const highlights = viewer.querySelectorAll('.diff-search-match');
          highlights.forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
          });
        }

        function updateCurrentMatch() {
          // Remove current class from all
          document.querySelectorAll('.diff-search-match.current').forEach(el => {
            el.classList.remove('current');
          });

          if (diffSearchCurrentIndex >= 0 && diffSearchCurrentIndex < diffSearchMatches.length) {
            const matchEl = document.querySelector(\`.diff-search-match[data-match-index="\${diffSearchCurrentIndex}"]\`);
            if (matchEl) {
              matchEl.classList.add('current');
              matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }

        function navigateDiffSearch(direction) {
          if (diffSearchMatches.length === 0) return;

          diffSearchCurrentIndex += direction;

          if (diffSearchCurrentIndex >= diffSearchMatches.length) {
            diffSearchCurrentIndex = 0;
          } else if (diffSearchCurrentIndex < 0) {
            diffSearchCurrentIndex = diffSearchMatches.length - 1;
          }

          updateCurrentMatch();
          diffSearchCount.textContent = \`\${diffSearchCurrentIndex + 1} of \${diffSearchMatches.length}\`;
        }

        function updateNavButtons() {
          const hasMatches = diffSearchMatches.length > 0;
          diffSearchPrev.disabled = !hasMatches;
          diffSearchNext.disabled = !hasMatches;
        }

        // Re-run search when file changes
        function onFileChange() {
          if (diffSearchQuery) {
            performDiffSearch();  // Re-search in new content
          }
        }

        // ===== Single message handler - state-based rendering =====
        window.addEventListener('message', event => {
          const { type, state } = event.data;
          if (type === 'render' && state) {
            renderState(state);
          }
        });

        /**
         * Main render function - renders entire UI from state
         */
        function renderState(state) {
          renderFileList(state.sessionFiles, state.uncommittedFiles, state.showUncommitted, state.selectedFile, state.isTreeView, state.searchQuery, state.diff);
          renderComments(state.comments);
          renderAIStatus(state.aiStatus);
          renderDiff(state.diff, state.selectedFile, state.diffViewMode);
        }

        // ===== File List Rendering =====
        function renderFileList(sessionFiles, uncommittedFiles, showUncommitted, selectedFile, isTreeView, searchQuery, diff) {
          const list = document.getElementById('files-list');
          const toggleRow = document.getElementById('toggle-row');
          const toggleSwitch = document.getElementById('uncommitted-toggle');
          const countBadge = document.getElementById('uncommitted-count');

          // Show toggle only if there are uncommitted files
          if (uncommittedFiles && uncommittedFiles.length > 0) {
            toggleRow.style.display = 'flex';
            countBadge.textContent = uncommittedFiles.length;
            toggleSwitch.classList.toggle('checked', showUncommitted);
            toggleSwitch.textContent = showUncommitted ? '✓' : '';
          } else {
            toggleRow.style.display = 'none';
          }

          // Combine files for display
          let allFiles = [...(sessionFiles || [])];
          if (showUncommitted && uncommittedFiles) {
            allFiles.push(...uncommittedFiles.map(f => ({ ...f, isUncommitted: true })));
          }

          // Apply search filter
          let filteredFiles = allFiles;
          const searchActive = searchQuery && searchQuery.trim().length > 0;

          if (searchActive) {
            const query = searchQuery.toLowerCase();
            filteredFiles = allFiles.filter(file => {
              // Path match
              const pathMatch = file.path.toLowerCase().includes(query);
              if (pathMatch) {
                file.matchType = 'path';
                return true;
              }

              // Content match (check diff if available and file matches)
              if (diff && diff.file === file.path) {
                for (const chunk of diff.chunks) {
                  for (const line of chunk.lines) {
                    if (line.type === 'addition' && line.content.toLowerCase().includes(query)) {
                      file.matchType = 'content';
                      return true;
                    }
                  }
                }
              }

              return false;
            });

            // Show results count
            searchResults.style.display = 'block';
            searchResults.textContent = \`\${filteredFiles.length} result\${filteredFiles.length !== 1 ? 's' : ''}\`;
          } else {
            searchResults.style.display = 'none';
          }

          if (filteredFiles.length === 0) {
            list.innerHTML = searchActive
              ? '<div class="empty-text">No matching files</div>'
              : '<div class="empty-text">Waiting for changes...</div>';
            return;
          }

          // Update view mode toggle button text
          viewModeToggle.textContent = isTreeView ? 'List' : 'Tree';

          let html = '';

          if (isTreeView) {
            const tree = buildFileTree(filteredFiles);
            html += '<div class="file-tree">';
            html += renderTreeNode(tree, selectedFile, 0);
            html += '</div>';
          } else {
            html += filteredFiles.map(file => {
              const isSelected = file.path === selectedFile;

              let badgeText = 'M';
              let badgeClass = 'modified';
              if (file.status === 'added') {
                badgeText = 'A';
                badgeClass = 'added';
              } else if (file.status === 'deleted') {
                badgeText = 'D';
                badgeClass = 'deleted';
              }

              const uncommittedClass = file.isUncommitted ? 'uncommitted' : '';
              const contentMatchClass = file.matchType === 'content' ? 'content-match' : '';
              return \`
                <div class="file-item \${isSelected ? 'selected' : ''} \${uncommittedClass} \${contentMatchClass}" data-file="\${file.path}">
                  <span class="file-icon">📄</span>
                  <span class="file-name" title="\${file.path}">\${file.name}</span>
                  <span class="file-badge \${badgeClass}">\${badgeText}</span>
                </div>
              \`;
            }).join('');
          }

          list.innerHTML = html;

          // Add click handlers
          if (isTreeView) {
            setupTreeHandlers();
          } else {
            list.querySelectorAll('.file-item').forEach(item => {
              item.onclick = () => {
                vscode.postMessage({ type: 'selectFile', file: item.dataset.file });
              };
            });
          }
        }

        // ===== Tree View Functions =====
        function buildFileTree(files) {
          const root = {
            name: '',
            path: '',
            type: 'folder',
            children: [],
            isExpanded: true
          };

          for (const file of files) {
            const parts = file.path.split('/');
            let current = root;

            for (let i = 0; i < parts.length; i++) {
              const part = parts[i];
              const isFile = i === parts.length - 1;
              const currentPath = parts.slice(0, i + 1).join('/');

              if (isFile) {
                current.children.push({
                  name: part,
                  path: file.path,
                  type: 'file',
                  status: file.status,
                  isUncommitted: file.isUncommitted
                });
              } else {
                let folder = current.children.find(
                  c => c.type === 'folder' && c.name === part
                );
                if (!folder) {
                  folder = {
                    name: part,
                    path: currentPath,
                    type: 'folder',
                    children: [],
                    isExpanded: true
                  };
                  current.children.push(folder);
                }
                current = folder;
              }
            }
          }

          sortTreeNode(root);
          return root;
        }

        function sortTreeNode(node) {
          if (!node.children) return;

          node.children.sort((a, b) => {
            if (a.type !== b.type) {
              return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });

          for (const child of node.children) {
            if (child.type === 'folder') {
              sortTreeNode(child);
            }
          }
        }

        function renderTreeNode(node, selectedFile, depth) {
          if (node.type === 'file') {
            const isSelected = node.path === selectedFile;
            let badgeClass = 'modified';
            let badgeText = 'M';
            if (node.status === 'added') {
              badgeClass = 'added';
              badgeText = 'A';
            } else if (node.status === 'deleted') {
              badgeClass = 'deleted';
              badgeText = 'D';
            }
            const uncommittedClass = node.isUncommitted ? 'uncommitted' : '';

            return \`
              <div class="tree-file \${isSelected ? 'selected' : ''} \${uncommittedClass}"
                   data-file="\${node.path}">
                <span class="file-icon">📄</span>
                <span class="file-name">\${escapeHtml(node.name)}</span>
                <span class="file-badge \${badgeClass}">\${badgeText}</span>
              </div>
            \`;
          }

          // Folder
          if (!node.children || node.children.length === 0) return '';

          // Skip root node rendering
          if (depth === 0) {
            return node.children.map(child => renderTreeNode(child, selectedFile, depth + 1)).join('');
          }

          const fileCount = countFiles(node);
          const isExpanded = node.isExpanded !== false;
          const toggleClass = isExpanded ? '' : 'collapsed';
          const childrenClass = isExpanded ? '' : 'collapsed';

          return \`
            <div class="tree-node" data-path="\${node.path}">
              <div class="tree-folder" data-folder="\${node.path}">
                <span class="tree-toggle \${toggleClass}">▼</span>
                <span class="file-icon">📁</span>
                <span class="tree-folder-name">\${escapeHtml(node.name)}/</span>
                <span class="tree-folder-count">(\${fileCount})</span>
              </div>
              <div class="tree-children \${childrenClass}">
                \${node.children.map(child => renderTreeNode(child, selectedFile, depth + 1)).join('')}
              </div>
            </div>
          \`;
        }

        function countFiles(node) {
          if (node.type === 'file') return 1;
          if (!node.children) return 0;
          return node.children.reduce((sum, child) => sum + countFiles(child), 0);
        }

        function setupTreeHandlers() {
          // Folder toggle
          document.querySelectorAll('.tree-folder').forEach(folder => {
            folder.onclick = (e) => {
              e.stopPropagation();
              const toggle = folder.querySelector('.tree-toggle');
              const children = folder.nextElementSibling;
              toggle.classList.toggle('collapsed');
              children.classList.toggle('collapsed');
            };
          });

          // File select
          document.querySelectorAll('.tree-file').forEach(file => {
            file.onclick = () => {
              vscode.postMessage({ type: 'selectFile', file: file.dataset.file });
            };
          });
        }

        // ===== Comments Rendering =====
        function renderComments(comments) {
          const list = document.getElementById('comments-list');

          if (!comments || comments.length === 0) {
            list.innerHTML = '<div class="empty-text">No comments yet</div>';
            return;
          }

          // Reverse order so recent comments appear at the top
          const sortedComments = [...comments].reverse();

          list.innerHTML = sortedComments.map(comment => {
            const lineDisplay = comment.endLine
              ? \`\${comment.line}-\${comment.endLine}\`
              : comment.line;
            const submittedClass = comment.isSubmitted ? 'submitted' : '';
            const icon = comment.isSubmitted ? '✓' : '📝';
            const statusLabel = comment.isSubmitted ? '<span class="comment-status">(submitted)</span>' : '';

            // Format timestamp
            const timeStr = comment.timestamp
              ? new Date(comment.timestamp).toLocaleString()
              : '';

            // Tooltip for submitted comments
            const tooltip = comment.isSubmitted && comment.codeContext
              ? \`<div class="comment-tooltip">
                  <div class="tooltip-code">\${escapeHtml(comment.codeContext)}</div>
                  <div class="tooltip-time">\${timeStr}</div>
                </div>\`
              : '';

            return \`
              <div class="comment-item \${submittedClass}" data-id="\${comment.id}">
                <div class="comment-meta">
                  <span>\${icon} \${comment.file}:\${lineDisplay}</span>
                  \${statusLabel}
                </div>
                <div>\${escapeHtml(comment.text)}</div>
                \${tooltip}
              </div>
            \`;
          }).join('');
        }

        // ===== AI Status Rendering =====
        function renderAIStatus(aiStatus) {
          const badge = document.getElementById('status-badge');
          const typeEl = document.getElementById('ai-type');

          if (aiStatus.active && aiStatus.type) {
            const label = aiStatus.type === 'claude' ? 'Claude' :
                          aiStatus.type === 'codex' ? 'Codex' :
                          aiStatus.type === 'gemini' ? 'Gemini' : aiStatus.type;
            typeEl.textContent = label;
            badge.classList.add('active');
          } else {
            typeEl.textContent = 'Ready';
            badge.classList.remove('active');
          }
        }

        // ===== Diff Rendering =====
        function renderDiff(diff, selectedFile, viewMode) {
          const header = document.querySelector('.diff-header-title');
          const stats = document.getElementById('diff-stats');
          const viewer = document.getElementById('diff-viewer');

          if (!diff || !diff.chunks || diff.chunks.length === 0) {
            header.textContent = selectedFile || 'Select a file to review';
            stats.innerHTML = '';
            diffToolbar.style.display = 'none';
            viewer.innerHTML = \`
              <div class="placeholder">
                <div class="placeholder-icon">\${selectedFile ? '✓' : '📝'}</div>
                <div class="placeholder-text">\${selectedFile ? 'No changes in this file' : 'Select a modified file to view changes'}</div>
              </div>
            \`;
            return;
          }

          // Show toolbar when diff is available
          diffToolbar.style.display = 'flex';

          header.textContent = diff.file;

          // Check if markdown file
          const isMarkdown = selectedFile && (
            selectedFile.endsWith('.md') ||
            selectedFile.endsWith('.markdown') ||
            selectedFile.endsWith('.mdx')
          );

          // Add view mode toggle for markdown files (single toggle, default preview)
          if (isMarkdown) {
            stats.innerHTML = \`
              <span class="stat-added">+\${diff.stats.additions}</span>
              <span class="stat-removed">-\${diff.stats.deletions}</span>
              <div class="view-mode-toggle">
                <button class="toggle-btn" onclick="toggleDiffViewMode()">\${viewMode === 'preview' ? 'Diff' : 'Preview'}</button>
              </div>
            \`;

            if (viewMode === 'preview') {
              renderMarkdownPreview(diff, viewer);
              setupPreviewCommentHandlers(diff.file);
              return;
            }
          } else {
            stats.innerHTML = \`
              <span class="stat-added">+\${diff.stats.additions}</span>
              <span class="stat-removed">-\${diff.stats.deletions}</span>
            \`;
          }

          // Check if all chunks are collapsed and update button text
          const chunkStates = diff.chunkStates || [];
          const allCollapsed = chunkStates.length > 0 && chunkStates.every(s => s.isCollapsed);
          diffCollapseAll.textContent = allCollapsed ? 'Expand' : 'Collapse';

          let html = \`
            <table class="diff-table">
              <colgroup>
                <col class="col-line-num">
                <col class="col-content">
              </colgroup>
          \`;
          html += renderChunksToHtml(diff.chunks, chunkStates);
          html += '</table>';

          viewer.innerHTML = html;
          setupLineHoverHandlers(diff.file);
          setupChunkToggleHandlers();

          // Re-trigger search if active
          onFileChange();
        }

        // ===== Markdown Rendering =====
        function highlightCode(code, lang) {
          // Simple syntax highlighting for common languages
          const keywords = {
            js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined'],
            ts: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 'interface', 'type', 'enum', 'implements', 'private', 'public', 'protected', 'readonly', 'as', 'is'],
            javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined'],
            typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 'interface', 'type', 'enum', 'implements', 'private', 'public', 'protected', 'readonly', 'as', 'is'],
            python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'try', 'except', 'raise', 'with', 'lambda', 'yield', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'pass', 'break', 'continue', 'global', 'nonlocal', 'async', 'await'],
            py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'try', 'except', 'raise', 'with', 'lambda', 'yield', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'pass', 'break', 'continue', 'global', 'nonlocal', 'async', 'await'],
            java: ['class', 'public', 'private', 'protected', 'static', 'final', 'void', 'int', 'String', 'boolean', 'return', 'if', 'else', 'for', 'while', 'new', 'this', 'super', 'extends', 'implements', 'interface', 'try', 'catch', 'throw', 'throws', 'import', 'package', 'true', 'false', 'null'],
            go: ['func', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'package', 'import', 'defer', 'go', 'chan', 'select', 'case', 'default', 'break', 'continue', 'map', 'make', 'new', 'nil', 'true', 'false'],
            rust: ['fn', 'let', 'mut', 'const', 'if', 'else', 'for', 'while', 'loop', 'match', 'return', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'self', 'Self', 'super', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'async', 'await', 'move', 'ref', 'where'],
            css: ['@import', '@media', '@keyframes', '@font-face', 'important'],
            sql: ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'TABLE', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'NULL', 'NOT', 'IN', 'LIKE', 'BETWEEN'],
            bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'export', 'local', 'readonly', 'shift', 'true', 'false'],
            sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'export', 'local', 'readonly', 'shift', 'true', 'false'],
            json: [],
            html: [],
            xml: [],
            yaml: ['true', 'false', 'null', 'yes', 'no'],
            yml: ['true', 'false', 'null', 'yes', 'no'],
            markdown: [],
            md: []
          };

          const builtins = {
            js: ['console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Map', 'Set', 'Error', 'RegExp', 'setTimeout', 'setInterval', 'fetch', 'document', 'window'],
            ts: ['console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Map', 'Set', 'Error', 'RegExp', 'setTimeout', 'setInterval', 'fetch', 'document', 'window', 'Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit', 'Exclude', 'Extract', 'ReturnType'],
            javascript: ['console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Map', 'Set', 'Error', 'RegExp', 'setTimeout', 'setInterval', 'fetch', 'document', 'window'],
            typescript: ['console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise', 'Map', 'Set', 'Error', 'RegExp', 'setTimeout', 'setInterval', 'fetch', 'document', 'window', 'Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit', 'Exclude', 'Extract', 'ReturnType'],
            python: ['print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'open', 'input', 'sorted', 'map', 'filter', 'zip', 'enumerate', 'sum', 'min', 'max', 'abs', 'round'],
            py: ['print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'open', 'input', 'sorted', 'map', 'filter', 'zip', 'enumerate', 'sum', 'min', 'max', 'abs', 'round']
          };

          let escaped = escapeHtml(code);
          const langKeywords = keywords[lang] || keywords['js'] || [];
          const langBuiltins = builtins[lang] || [];

          // Highlight comments (must be first to avoid conflicts)
          // Single-line comments
          escaped = escaped.replace(/(\\/{2}.*)$/gm, '<span class="hljs-comment">$1</span>');
          // Python/bash comments
          if (['python', 'py', 'bash', 'sh', 'yaml', 'yml'].includes(lang)) {
            escaped = escaped.replace(/(#.*)$/gm, '<span class="hljs-comment">$1</span>');
          }
          // Multi-line comments
          escaped = escaped.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g, '<span class="hljs-comment">$1</span>');
          // HTML comments
          escaped = escaped.replace(/(&lt;!--[\\s\\S]*?--&gt;)/g, '<span class="hljs-comment">$1</span>');

          // Highlight strings (double quotes, single quotes, template literals)
          escaped = escaped.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, '<span class="hljs-string">$1</span>');
          escaped = escaped.replace(/(&#39;(?:[^&]|&(?!#39;))*?&#39;)/g, '<span class="hljs-string">$1</span>');
          escaped = escaped.replace(/(\`[^\`]*\`)/g, '<span class="hljs-string">$1</span>');

          // Highlight numbers
          escaped = escaped.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class="hljs-number">$1</span>');

          // Highlight keywords (word boundaries to avoid partial matches)
          for (const kw of langKeywords) {
            const regex = new RegExp('\\\\b(' + kw + ')\\\\b', 'g');
            escaped = escaped.replace(regex, '<span class="hljs-keyword">$1</span>');
          }

          // Highlight builtins
          for (const bi of langBuiltins) {
            const regex = new RegExp('\\\\b(' + bi + ')\\\\b', 'g');
            escaped = escaped.replace(regex, '<span class="hljs-builtin">$1</span>');
          }

          // Highlight function calls (word followed by parenthesis)
          escaped = escaped.replace(/\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(/g, '<span class="hljs-function">$1</span>(');

          // Highlight HTML/XML tags
          if (['html', 'xml', 'jsx', 'tsx'].includes(lang)) {
            escaped = escaped.replace(/(&lt;\\/?)([a-zA-Z][a-zA-Z0-9]*)/g, '$1<span class="hljs-tag">$2</span>');
            escaped = escaped.replace(/\\s([a-zA-Z-]+)=/g, ' <span class="hljs-attr">$1</span>=');
          }

          return escaped;
        }

        function renderTable(rows) {
          if (rows.length === 0) return '';

          // Parse cells from each row
          const parseRow = (row) => {
            return row.slice(1, -1).split('|').map(cell => cell.trim());
          };

          // Check if second row is separator (alignment row)
          const hasSeparator = rows.length > 1 && rows[1].match(/^\\|[\\s:-]+\\|$/);
          const headerRow = parseRow(rows[0]);
          let alignments = [];

          let dataStartIndex = 1;
          if (hasSeparator) {
            const separatorCells = parseRow(rows[1]);
            alignments = separatorCells.map(cell => {
              if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
              if (cell.endsWith(':')) return 'right';
              return 'left';
            });
            dataStartIndex = 2;
          }

          let tableHtml = '<table>';

          // Header
          tableHtml += '<thead><tr>';
          headerRow.forEach((cell, i) => {
            const align = alignments[i] ? ' style="text-align: ' + alignments[i] + '"' : '';
            tableHtml += '<th' + align + '>' + processInline(cell) + '</th>';
          });
          tableHtml += '</tr></thead>';

          // Body
          if (rows.length > dataStartIndex) {
            tableHtml += '<tbody>';
            for (let i = dataStartIndex; i < rows.length; i++) {
              const cells = parseRow(rows[i]);
              tableHtml += '<tr>';
              cells.forEach((cell, j) => {
                const align = alignments[j] ? ' style="text-align: ' + alignments[j] + '"' : '';
                tableHtml += '<td' + align + '>' + processInline(cell) + '</td>';
              });
              tableHtml += '</tr>';
            }
            tableHtml += '</tbody>';
          }

          tableHtml += '</table>';
          return tableHtml;
        }

        function renderMarkdown(text) {
          // Store code blocks first to protect them from processing
          const codeBlocks = [];
          // Match fenced code blocks with optional language
          let html = text.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
            const index = codeBlocks.length;
            const highlighted = highlightCode(code.trim(), lang);
            codeBlocks.push('<pre><code class="language-' + (lang || '') + '">' + highlighted + '</code></pre>');
            return '\\n{{CODE_BLOCK_' + index + '}}\\n';
          });

          // Store inline code (single backticks)
          const inlineCode = [];
          html = html.replace(/\`([^\`\\n]+)\`/g, (match, code) => {
            const index = inlineCode.length;
            inlineCode.push('<code>' + escapeHtml(code) + '</code>');
            return '{{INLINE_CODE_' + index + '}}';
          });

          // Split into lines for processing
          const lines = html.split('\\n');
          const processedLines = [];
          let inList = false;
          let listType = null;
          let inTable = false;
          let tableRows = [];

          for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Check for code block placeholder
            if (line.trim().match(/^\\{\\{CODE_BLOCK_\\d+\\}\\}$/)) {
              if (inList) {
                processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                inList = false;
                listType = null;
              }
              if (inTable) {
                processedLines.push(renderTable(tableRows));
                tableRows = [];
                inTable = false;
              }
              processedLines.push(line.trim());
              continue;
            }

            // Table row detection
            if (line.trim().match(/^\\|.*\\|$/)) {
              if (inList) {
                processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                inList = false;
                listType = null;
              }
              inTable = true;
              tableRows.push(line.trim());
              continue;
            } else if (inTable) {
              // End of table
              processedLines.push(renderTable(tableRows));
              tableRows = [];
              inTable = false;
            }

            // Horizontal rule
            if (line.trim().match(/^(-{3,}|\\*{3,}|_{3,})$/)) {
              if (inList) {
                processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                inList = false;
                listType = null;
              }
              processedLines.push('<hr>');
              continue;
            }

            // Blockquote
            if (line.match(/^>\\s?/)) {
              if (inList) {
                processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                inList = false;
                listType = null;
              }
              const content = line.replace(/^>\\s?/, '');
              processedLines.push('<blockquote><p>' + processInline(content) + '</p></blockquote>');
              continue;
            }

            // Headers
            if (line.match(/^#{1,6} /)) {
              if (inList) {
                processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                inList = false;
                listType = null;
              }
              const level = line.match(/^(#+)/)[1].length;
              const content = line.replace(/^#+\\s*/, '');
              processedLines.push('<h' + level + '>' + escapeHtml(content) + '</h' + level + '>');
              continue;
            }

            // Unordered list (including task lists with checkboxes)
            if (line.match(/^\\s*[-*+]\\s+/)) {
              let content = line.replace(/^\\s*[-*+]\\s+/, '');
              if (!inList || listType !== 'ul') {
                if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                processedLines.push('<ul>');
                inList = true;
                listType = 'ul';
              }
              // Check for task list item (checkbox)
              const checkboxMatch = content.match(/^\\[([xX\\s])\\]\\s+(.*)$/);
              if (checkboxMatch) {
                const isChecked = checkboxMatch[1].toLowerCase() === 'x';
                const taskContent = checkboxMatch[2];
                const checkbox = '<input type="checkbox"' + (isChecked ? ' checked' : '') + ' disabled>';
                processedLines.push('<li class="task-list-item">' + checkbox + processInline(taskContent) + '</li>');
              } else {
                processedLines.push('<li>' + processInline(content) + '</li>');
              }
              continue;
            }

            // Ordered list
            if (line.match(/^\\s*\\d+\\.\\s+/)) {
              const content = line.replace(/^\\s*\\d+\\.\\s+/, '');
              if (!inList || listType !== 'ol') {
                if (inList) processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                processedLines.push('<ol>');
                inList = true;
                listType = 'ol';
              }
              processedLines.push('<li>' + processInline(content) + '</li>');
              continue;
            }

            // Empty line - close list if open
            if (line.trim() === '') {
              if (inList) {
                processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
                inList = false;
                listType = null;
              }
              processedLines.push('');
              continue;
            }

            // Regular paragraph text
            if (inList) {
              processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
              inList = false;
              listType = null;
            }
            processedLines.push(processInline(line));
          }

          // Close any open list
          if (inList) {
            processedLines.push(listType === 'ul' ? '</ul>' : '</ol>');
          }

          // Close any open table
          if (inTable && tableRows.length > 0) {
            processedLines.push(renderTable(tableRows));
          }

          // Join and wrap in paragraphs
          html = processedLines.join('\\n');

          // Restore code blocks and inline code
          codeBlocks.forEach((block, i) => {
            html = html.replace('{{CODE_BLOCK_' + i + '}}', block);
          });
          inlineCode.forEach((code, i) => {
            html = html.replace('{{INLINE_CODE_' + i + '}}', code);
          });

          // Wrap loose text in paragraphs (text not in block elements)
          const blockTags = ['<h1', '<h2', '<h3', '<h4', '<h5', '<h6', '<ul', '<ol', '<li', '<pre', '<hr', '<blockquote', '</ul', '</ol', '</li', '</blockquote', '<table', '</table'];
          const finalLines = html.split('\\n');
          let result = '';
          let paragraphBuffer = [];

          for (const line of finalLines) {
            const trimmed = line.trim();
            if (trimmed === '') {
              if (paragraphBuffer.length > 0) {
                result += '<p>' + paragraphBuffer.join('<br>') + '</p>\\n';
                paragraphBuffer = [];
              }
            } else if (blockTags.some(tag => trimmed.startsWith(tag))) {
              if (paragraphBuffer.length > 0) {
                result += '<p>' + paragraphBuffer.join('<br>') + '</p>\\n';
                paragraphBuffer = [];
              }
              result += trimmed + '\\n';
            } else {
              paragraphBuffer.push(trimmed);
            }
          }
          if (paragraphBuffer.length > 0) {
            result += '<p>' + paragraphBuffer.join('<br>') + '</p>';
          }

          return result;
        }

        function processInline(text) {
          // Temporarily replace inline code placeholders to protect them from all processing
          const placeholders = [];
          let result = text.replace(/\\{\\{INLINE_CODE_(\\d+)\\}\\}/g, (match) => {
            const index = placeholders.length;
            placeholders.push(match);
            return '\\x00PLACEHOLDER' + index + '\\x00';
          });

          result = escapeHtml(result);

          // Bold (must come before italic)
          result = result.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
          result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

          // Italic
          result = result.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
          result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

          // Links
          result = result.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

          // Restore inline code placeholders AFTER all formatting
          placeholders.forEach((placeholder, i) => {
            result = result.replace('\\x00PLACEHOLDER' + i + '\\x00', placeholder);
          });

          return result;
        }

        function renderMarkdownPreview(diff, container) {
          // If we have full file content, use it with line-based highlighting
          if (diff.newFileContent) {
            renderFullMarkdownWithHighlights(diff.newFileContent, diff.changedLineNumbers, container, diff.deletions);
            return;
          }

          // Fallback: use diff chunks only (old behavior)
          const groups = [];
          let currentGroup = null;

          for (const chunk of diff.chunks) {
            for (const line of chunk.lines) {
              if (line.type === 'deletion') continue;
              const isAddition = line.type === 'addition';
              if (!currentGroup || currentGroup.isAddition !== isAddition) {
                if (currentGroup) groups.push(currentGroup);
                currentGroup = { isAddition, lines: [] };
              }
              currentGroup.lines.push(line.content);
            }
          }
          if (currentGroup) groups.push(currentGroup);

          let html = '<div class="markdown-preview">';
          for (const group of groups) {
            const content = group.lines.join('\\n');
            const rendered = renderMarkdown(content);
            if (group.isAddition) {
              html += '<div class="diff-addition">' + rendered + '</div>';
            } else {
              html += rendered;
            }
          }
          html += '</div>';
          container.innerHTML = html;
        }

        function renderFullMarkdownWithHighlights(content, changedLineNumbers, container, deletions) {
          const lines = content.split('\\n');
          const totalLines = lines.length;
          const changedSet = new Set(changedLineNumbers || []);

          // Build deletion map: afterLine -> deletion content
          const deletionMap = new Map();
          if (deletions) {
            for (const del of deletions) {
              deletionMap.set(del.afterLine, del.content);
            }
          }

          // Group consecutive lines by type: 'normal', 'addition', or insert deletions
          // IMPORTANT: Never split inside code blocks to preserve markdown structure
          const groups = [];
          let currentGroup = null;
          let inCodeBlock = false;

          // Check for deletions before first line
          if (deletionMap.has(0)) {
            groups.push({ type: 'deletion', lines: deletionMap.get(0), startLine: 0 });
          }

          for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1; // 1-indexed
            const line = lines[i];
            const isChanged = changedSet.has(lineNum);
            const groupType = isChanged ? 'addition' : 'normal';

            // Track code block state (fenced code blocks start with triple backticks)
            const trimmedLine = line.trim();
            const isCodeFence = trimmedLine.startsWith(String.fromCharCode(96, 96, 96));
            if (isCodeFence) {
              inCodeBlock = !inCodeBlock;
            }

            // Split on blank lines or markdown headers to enable granular commenting
            // BUT never split inside code blocks
            const isBlankLine = line.trim() === '';
            const isHeader = line.match(/^#{1,6}\\s/);
            const shouldSplit = !inCodeBlock && currentGroup && currentGroup.type === groupType && (isBlankLine || isHeader);

            // Don't change group type inside code blocks
            const effectiveTypeChange = !inCodeBlock && currentGroup && currentGroup.type !== groupType;

            if (!currentGroup || effectiveTypeChange || shouldSplit) {
              if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup);
              currentGroup = { type: groupType, lines: [], startLine: lineNum };
            }
            currentGroup.lines.push(line);

            // Check for deletions after this line (but not inside code blocks)
            if (deletionMap.has(lineNum) && !inCodeBlock) {
              if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup);
              groups.push({ type: 'deletion', lines: deletionMap.get(lineNum), startLine: lineNum });
              currentGroup = null;
            }
          }
          if (currentGroup) groups.push(currentGroup);

          // Render each group with appropriate highlighting
          let markdownHtml = '';

          for (const group of groups) {
            const groupContent = group.lines.join('\\n');
            const rendered = renderMarkdown(groupContent);
            const endLine = group.startLine + group.lines.length - 1;

            if (group.type === 'addition') {
              markdownHtml += '<div class="diff-block diff-addition" data-start-line="' + group.startLine + '" data-end-line="' + endLine + '">' + rendered + '</div>';
            } else if (group.type === 'deletion') {
              markdownHtml += '<div class="diff-block diff-deletion" data-after-line="' + group.startLine + '">' + rendered + '</div>';
            } else {
              markdownHtml += '<div class="diff-block diff-normal" data-start-line="' + group.startLine + '" data-end-line="' + endLine + '">' + rendered + '</div>';
            }
          }

          // Build overview ruler markers
          let markersHtml = '';
          const additionLines = changedLineNumbers || [];
          const deletionPositions = deletions ? deletions.map(d => d.afterLine) : [];

          for (const lineNum of additionLines) {
            const topPercent = ((lineNum - 1) / totalLines) * 100;
            markersHtml += '<div class="overview-marker addition" style="top: ' + topPercent.toFixed(2) + '%;"></div>';
          }

          for (const afterLine of deletionPositions) {
            const topPercent = (afterLine / totalLines) * 100;
            markersHtml += '<div class="overview-marker deletion" style="top: ' + topPercent.toFixed(2) + '%;"></div>';
          }

          // Final HTML with container, markdown preview, and overview ruler
          container.innerHTML =
            '<div class="markdown-preview-container">' +
              '<div class="markdown-preview">' + markdownHtml + '</div>' +
              '<div class="overview-ruler">' + markersHtml + '</div>' +
            '</div>';
        }

        window.toggleDiffViewMode = function() {
          vscode.postMessage({ type: 'toggleDiffViewMode' });
        };

        // ===== Preview Comment Handlers =====
        let previewCurrentFile = null;
        let previewDragStartBlock = null;
        let previewDragEndBlock = null;
        let previewIsDragging = false;

        function setupPreviewCommentHandlers(file) {
          previewCurrentFile = file;
          const preview = document.querySelector('.markdown-preview');
          if (!preview) return;

          // Remove previous handlers
          preview.onmousedown = null;
          preview.onmousemove = null;
          document.removeEventListener('mouseup', handlePreviewMouseUp);

          // Setup drag selection handlers
          preview.onmousedown = handlePreviewMouseDown;
          preview.onmousemove = handlePreviewMouseMove;
          document.addEventListener('mouseup', handlePreviewMouseUp);
        }

        function handlePreviewMouseDown(e) {
          // Ignore if clicking form elements
          if (e.target.closest('.preview-comment-form')) return;
          if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;

          // Allow selection on addition and normal blocks (not deletion)
          let block = e.target.closest('.diff-addition, .diff-normal');

          // If clicking deletion block, find the next selectable block
          if (!block) {
            const deletionBlock = e.target.closest('.diff-deletion');
            if (deletionBlock) {
              // Find next sibling that is selectable
              let nextBlock = deletionBlock.nextElementSibling;
              while (nextBlock && !nextBlock.matches('.diff-addition, .diff-normal')) {
                nextBlock = nextBlock.nextElementSibling;
              }
              if (nextBlock) {
                block = nextBlock;
              }
            }
          }

          if (!block) return;

          // Clear existing selection and form
          clearPreviewSelection();
          const existingForm = document.querySelector('.preview-comment-form');
          if (existingForm) existingForm.remove();

          previewDragStartBlock = block;
          previewDragEndBlock = block;
          previewIsDragging = true;
          block.classList.add('preview-selected');
          e.preventDefault();
        }

        function handlePreviewMouseMove(e) {
          if (!previewIsDragging || !previewDragStartBlock) return;

          const block = e.target.closest('.diff-addition, .diff-normal');
          if (!block || block === previewDragEndBlock) return;

          previewDragEndBlock = block;
          updatePreviewSelection();
        }

        function handlePreviewMouseUp(e) {
          if (!previewIsDragging || !previewDragStartBlock) {
            previewIsDragging = false;
            return;
          }

          previewIsDragging = false;

          // Get all selected blocks and calculate line range
          const selectedBlocks = document.querySelectorAll('.diff-block.preview-selected');
          if (selectedBlocks.length === 0) return;

          let minLine = Infinity;
          let maxLine = -Infinity;

          selectedBlocks.forEach(block => {
            const start = parseInt(block.dataset.startLine || '0', 10);
            const end = parseInt(block.dataset.endLine || start, 10);
            if (start < minLine) minLine = start;
            if (end > maxLine) maxLine = end;
          });

          // Show comment form at the last selected block
          const lastBlock = selectedBlocks[selectedBlocks.length - 1];
          showPreviewCommentForm(lastBlock, minLine, maxLine);
        }

        function updatePreviewSelection() {
          if (!previewDragStartBlock || !previewDragEndBlock) return;

          const preview = document.querySelector('.markdown-preview');
          if (!preview) return;

          // Get selectable blocks (addition and normal, not deletion)
          const selectableBlocks = Array.from(preview.querySelectorAll('.diff-addition, .diff-normal'));

          const startIdx = selectableBlocks.indexOf(previewDragStartBlock);
          const endIdx = selectableBlocks.indexOf(previewDragEndBlock);

          if (startIdx === -1 || endIdx === -1) return;

          const minIdx = Math.min(startIdx, endIdx);
          const maxIdx = Math.max(startIdx, endIdx);

          // Clear previous selection
          selectableBlocks.forEach(b => b.classList.remove('preview-selected'));

          // Select all blocks in range
          for (let i = minIdx; i <= maxIdx; i++) {
            selectableBlocks[i].classList.add('preview-selected');
          }
        }

        function clearPreviewSelection() {
          document.querySelectorAll('.diff-block.preview-selected, .diff-block.preview-in-range').forEach(b => {
            b.classList.remove('preview-selected', 'preview-in-range');
          });
          previewDragStartBlock = null;
          previewDragEndBlock = null;
        }

        function showPreviewCommentForm(block, startLine, endLine) {
          const lineDisplay = startLine === endLine
            ? 'line ' + startLine
            : 'lines ' + startLine + '-' + endLine;

          const form = document.createElement('div');
          form.className = 'preview-comment-form';
          form.innerHTML = \`
            <div class="comment-form-header">Comment on \${lineDisplay}</div>
            <textarea placeholder="Leave a comment..."></textarea>
            <div class="comment-form-actions">
              <button class="btn-secondary" onclick="closePreviewCommentForm()">Cancel</button>
              <button onclick="submitPreviewComment(\${startLine}, \${endLine})">Add Comment</button>
            </div>
          \`;

          block.appendChild(form);
          form.querySelector('textarea').focus();
        }

        window.closePreviewCommentForm = function() {
          const form = document.querySelector('.preview-comment-form');
          if (form) form.remove();
          clearPreviewSelection();
        };

        window.submitPreviewComment = function(startLine, endLine) {
          const form = document.querySelector('.preview-comment-form');
          if (!form || !previewCurrentFile) return;

          const text = form.querySelector('textarea').value;
          if (!text.trim()) return;

          vscode.postMessage({
            type: 'addComment',
            file: previewCurrentFile,
            line: startLine,
            endLine: startLine !== endLine ? endLine : undefined,
            text: text,
            context: ''
          });

          form.remove();
          clearPreviewSelection();
        };

        function renderChunksToHtml(chunks, chunkStates) {
          let html = '';
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const state = chunkStates[i] || { isCollapsed: false, scopeLabel: null };
            // Determine scope label with fallback
            let scopeLabel = state.scopeLabel;
            if (!scopeLabel) {
              if (chunk.oldStart === 0) {
                scopeLabel = 'New file';
              } else {
                scopeLabel = \`Lines \${chunk.oldStart}-\${chunk.oldStart + chunk.lines.length}\`;
              }
            }

            // Chunk header (clickable) - stays same regardless of collapse state
            html += \`
              <tr class="chunk-header-row" data-chunk-index="\${i}">
                <td colspan="2" class="chunk-header">
                  <span class="chunk-toggle">▼</span>
                  <span class="chunk-scope">\${escapeHtml(scopeLabel)}</span>
                  <span class="chunk-stats">
                    <span class="added">+\${chunk.stats?.additions || 0}</span>
                    <span class="removed">-\${chunk.stats?.deletions || 0}</span>
                  </span>
                </td>
              </tr>
            \`;

            // Chunk lines (collapsible) - just show/hide
            const linesClass = state.isCollapsed ? 'collapsed' : '';
            html += \`<tbody class="chunk-lines \${linesClass}" data-chunk-index="\${i}">\`;

            for (const line of chunk.lines) {
              const lineClass = line.type;
              const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
              const lineNum = line.newLineNumber || line.oldLineNumber || '';
              html += \`
                <tr class="diff-line \${lineClass}" data-line="\${lineNum}">
                  <td class="diff-line-num">\${lineNum}</td>
                  <td class="diff-line-content" data-prefix="\${prefix}">\${escapeHtml(line.content)}</td>
                </tr>
              \`;
            }

            html += '</tbody>';
          }
          return html;
        }

        function setupChunkToggleHandlers() {
          document.querySelectorAll('.chunk-header-row').forEach(row => {
            row.onclick = () => {
              const index = parseInt(row.dataset.chunkIndex);
              vscode.postMessage({ type: 'toggleChunkCollapse', index });
            };
          });
        }

        // ===== Line Selection & Comment Form =====
        function setupLineHoverHandlers(currentFile) {
          const viewer = document.getElementById('diff-viewer');

          viewer.onclick = (e) => {
            const btn = e.target.closest('.line-comment-btn');
            if (btn) {
              selectedLineNum = btn.dataset.line;
              selectedLineElement = btn.closest('tr');
              selectionStartLine = null;
              selectionEndLine = null;
              showInlineCommentForm(currentFile);
            }
          };

          viewer.onmousedown = (e) => {
            let row = e.target.closest('.diff-line');
            if (!row || e.target.closest('.line-comment-btn') || e.target.closest('.inline-comment-form')) return;
            // If clicking deletion line, try to find addition line with same line number
            if (row.classList.contains('deletion')) {
              const lineNum = row.dataset.line;
              if (!lineNum) return;
              // Find addition or context row with same line number
              const alternateRow = viewer.querySelector('.diff-line.addition[data-line="' + lineNum + '"], .diff-line.context[data-line="' + lineNum + '"]');
              if (alternateRow) {
                row = alternateRow;
              } else {
                return;
              }
            }
            const lineNum = row.dataset.line;
            if (!lineNum) return;
            isSelecting = true;
            selectionStartLine = parseInt(lineNum);
            selectionEndLine = parseInt(lineNum);
            selectionStartRow = row;
            clearLineSelection();
            row.classList.add('line-selected', 'selection-start', 'selection-end');
          };

          viewer.onmousemove = (e) => {
            if (!isSelecting) return;
            const row = e.target.closest('.diff-line');
            if (!row) return;
            const lineNum = row.dataset.line;
            if (!lineNum) return;
            selectionEndLine = parseInt(lineNum);
            selectionEndRow = row;
            updateLineSelection();
          };

          document.onmouseup = (e) => {
            if (!isSelecting) return;
            isSelecting = false;
            if (selectionStartLine !== null && selectionEndLine !== null) {
              const startLine = Math.min(selectionStartLine, selectionEndLine);
              const endLine = Math.max(selectionStartLine, selectionEndLine);
              if (startLine !== endLine || e.target.closest('.diff-line-content')) {
                selectedLineNum = startLine;
                // Find the last selected row (the one with selection-end class)
                const lastSelectedRow = document.querySelector('.diff-line.selection-end');
                if (lastSelectedRow) {
                  selectedLineElement = lastSelectedRow;
                }
                showInlineCommentForm(currentFile, startLine, endLine);
              }
            }
            selectionStartRow = null;
            selectionEndRow = null;
          };
        }

        function clearLineSelection() {
          document.querySelectorAll('.diff-line.line-selected').forEach(el => {
            el.classList.remove('line-selected', 'selection-start', 'selection-end');
          });
        }

        function updateLineSelection() {
          clearLineSelection();
          if (selectionStartLine === null || selectionEndLine === null) return;
          const startLine = Math.min(selectionStartLine, selectionEndLine);
          const endLine = Math.max(selectionStartLine, selectionEndLine);

          // Get types of starting and ending rows
          const getRowType = (row) => {
            if (!row) return null;
            return row.classList.contains('addition') ? 'addition' :
                   row.classList.contains('deletion') ? 'deletion' : 'context';
          };
          const startRowType = getRowType(selectionStartRow);
          const endRowType = getRowType(selectionEndRow);

          // If start and end types differ, select both types
          const selectBothTypes = startRowType && endRowType && startRowType !== endRowType;

          // Group rows by line number to detect duplicates
          const rowsByLineNum = new Map();
          document.querySelectorAll('.diff-line').forEach(row => {
            const lineNum = parseInt(row.dataset.line);
            if (lineNum >= startLine && lineNum <= endLine) {
              if (!rowsByLineNum.has(lineNum)) {
                rowsByLineNum.set(lineNum, []);
              }
              rowsByLineNum.get(lineNum).push(row);
            }
          });

          const selectedRows = [];
          rowsByLineNum.forEach((rows, lineNum) => {
            for (const row of rows) {
              const rowType = getRowType(row);
              // Skip deletion lines - can't comment on deleted content
              if (rowType === 'deletion') continue;
              row.classList.add('line-selected');
              selectedRows.push({ row, lineNum });
            }
          });

          if (selectedRows.length > 0) {
            selectedRows[0].row.classList.add('selection-start');
            selectedRows[selectedRows.length - 1].row.classList.add('selection-end');
          }
        }

        function showInlineCommentForm(currentFile, startLine, endLine) {
          const existingForm = document.querySelector('.comment-form-row');
          if (existingForm) existingForm.remove();
          if (!selectedLineElement) return;

          const isSingleLine = !endLine || startLine === endLine;
          const lineDisplay = isSingleLine
            ? \`line \${startLine || selectedLineNum}\`
            : \`lines \${startLine}-\${endLine}\`;

          const formRow = document.createElement('tr');
          formRow.className = 'comment-form-row';
          formRow.dataset.file = currentFile;
          formRow.dataset.start = startLine || selectedLineNum;
          formRow.dataset.end = endLine || startLine || selectedLineNum;
          formRow.innerHTML = \`
            <td colspan="2">
              <div class="inline-comment-form active">
                <div class="comment-form-header">Comment on \${lineDisplay}</div>
                <textarea class="comment-textarea" placeholder="Leave a comment..."></textarea>
                <div class="comment-form-actions">
                  <button class="btn-secondary" onclick="cancelCommentForm()">Cancel</button>
                  <button onclick="submitInlineComment()">Add Comment</button>
                </div>
              </div>
            </td>
          \`;
          selectedLineElement.after(formRow);
          formRow.querySelector('textarea').focus();
        }

        window.cancelCommentForm = function() {
          clearLineSelection();
          const formRow = document.querySelector('.comment-form-row');
          if (formRow) formRow.remove();
          selectionStartLine = null;
          selectionEndLine = null;
        };

        window.submitInlineComment = function() {
          const formRow = document.querySelector('.comment-form-row');
          if (!formRow) return;

          const text = formRow.querySelector('textarea').value;
          const startLine = formRow.dataset.start;
          const endLine = formRow.dataset.end;
          const currentFile = formRow.dataset.file;

          if (text && currentFile) {
            vscode.postMessage({
              type: 'addComment',
              file: currentFile,
              line: parseInt(startLine),
              endLine: startLine !== endLine ? parseInt(endLine) : undefined,
              text: text,
              context: ''
            });
            clearLineSelection();
            formRow.remove();
            selectionStartLine = null;
            selectionEndLine = null;
          }
        };

        // ===== Utility =====
        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }
      </script>
    </body>
    </html>`;
    }
}
