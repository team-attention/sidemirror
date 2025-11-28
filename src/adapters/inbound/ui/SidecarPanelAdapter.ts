import * as vscode from 'vscode';
import { PanelState } from '../../../application/ports/outbound/PanelState';
import { IGenerateDiffUseCase } from '../../../application/ports/inbound/IGenerateDiffUseCase';
import { IAddCommentUseCase } from '../../../application/ports/inbound/IAddCommentUseCase';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';

/**
 * Webview Panel Adapter (Inbound Adapter)
 *
 * Handles user interactions from webview and calls UseCases.
 * Receives state updates via callback and renders to webview.
 */
export class SidecarPanelAdapter {
    public static currentPanel: SidecarPanelAdapter | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private disposables: vscode.Disposable[] = [];
    private onDisposeCallback: (() => void) | undefined;

    // Inbound handlers (webview → application)
    private generateDiffUseCase: IGenerateDiffUseCase | undefined;
    private addCommentUseCase: IAddCommentUseCase | undefined;
    private onSubmitComments: (() => Promise<void>) | undefined;
    private panelStateManager: IPanelStateManager | undefined;

    public static create(context: vscode.ExtensionContext): SidecarPanelAdapter {
        if (SidecarPanelAdapter.currentPanel) {
            SidecarPanelAdapter.currentPanel.panel.reveal(vscode.ViewColumn.Two);
            return SidecarPanelAdapter.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'sidecar',
            'Sidecar',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')]
            }
        );

        SidecarPanelAdapter.currentPanel = new SidecarPanelAdapter(panel, context);
        return SidecarPanelAdapter.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
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
        panelStateManager?: IPanelStateManager
    ): void {
        this.generateDiffUseCase = generateDiffUseCase;
        this.addCommentUseCase = addCommentUseCase;
        this.onSubmitComments = onSubmitComments;
        this.panelStateManager = panelStateManager;
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
            // No diff - remove from session files
            this.panelStateManager.removeSessionFile(file);
        } else {
            // Show diff
            this.panelStateManager.showDiff(diffResult);
        }
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

    public dispose(): void {
        SidecarPanelAdapter.currentPanel = undefined;
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
          background: var(--vscode-gitDecoration-addedResourceForeground, #238636);
          color: var(--vscode-editor-background);
          font-weight: 500;
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
          font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          line-height: 20px;
        }

        .diff-hunk-header {
          background: var(--vscode-diffEditor-unchangedRegionBackground, rgba(56, 139, 253, 0.15));
          color: var(--vscode-descriptionForeground);
          padding: 8px 16px;
          font-size: 12px;
          border-top: 1px solid var(--vscode-panel-border);
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .diff-line {
          border: none;
        }

        .diff-line:hover {
          background: var(--vscode-list-hoverBackground) !important;
        }

        .diff-line-num {
          width: 50px;
          min-width: 50px;
          padding: 0 8px;
          text-align: right;
          color: var(--vscode-editorLineNumber-foreground);
          background: var(--vscode-editorGutter-background);
          user-select: none;
          vertical-align: top;
          border-right: 1px solid var(--vscode-panel-border);
        }

        .diff-line-content {
          padding: 0 16px;
          white-space: pre-wrap;
          word-break: break-all;
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
          background: transparent !important;
        }

        .comment-btn-cell {
          width: 24px;
          min-width: 24px;
          padding: 0;
          vertical-align: middle;
          background: var(--vscode-editorGutter-background);
          border-right: 1px solid var(--vscode-panel-border);
        }

        .line-comment-btn {
          display: none;
          width: 20px;
          height: 20px;
          margin: 0 2px;
          padding: 0;
          border: none;
          border-radius: 4px;
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          font-size: 14px;
          line-height: 20px;
          text-align: center;
          cursor: pointer;
        }

        .line-comment-btn:hover {
          background: var(--vscode-button-hoverBackground);
        }

        .diff-line:hover .line-comment-btn {
          display: inline-block;
        }

        .add-comment-btn {
          display: none !important;
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
          renderFileList(state.sessionFiles, state.uncommittedFiles, state.showUncommitted, state.selectedFile);
          renderComments(state.comments);
          renderAIStatus(state.aiStatus);
          renderDiff(state.diff, state.selectedFile);
        }

        // ===== File List Rendering =====
        function renderFileList(sessionFiles, uncommittedFiles, showUncommitted, selectedFile) {
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
          const allFiles = [...(sessionFiles || [])];
          if (showUncommitted && uncommittedFiles) {
            allFiles.push(...uncommittedFiles.map(f => ({ ...f, isUncommitted: true })));
          }

          if (allFiles.length === 0) {
            list.innerHTML = '<div class="empty-text">Waiting for changes...</div>';
            return;
          }

          list.innerHTML = allFiles.map(file => {
            const isSelected = file.path === selectedFile;
            const statusBadge = file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M';
            const uncommittedClass = file.isUncommitted ? 'uncommitted' : '';
            return \`
              <div class="file-item \${isSelected ? 'selected' : ''} \${uncommittedClass}" data-file="\${file.path}">
                <span class="file-icon">📄</span>
                <span class="file-name" title="\${file.path}">\${file.name}</span>
                <span class="file-badge">\${statusBadge}</span>
              </div>
            \`;
          }).join('');

          // Add click handlers for file items
          list.querySelectorAll('.file-item').forEach(item => {
            item.onclick = () => {
              vscode.postMessage({ type: 'selectFile', file: item.dataset.file });
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
        function renderDiff(diff, selectedFile) {
          const header = document.querySelector('.diff-header-title');
          const stats = document.getElementById('diff-stats');
          const viewer = document.getElementById('diff-viewer');

          if (!diff || !diff.hunks || diff.hunks.length === 0) {
            header.textContent = selectedFile || 'Select a file to review';
            stats.innerHTML = '';
            viewer.innerHTML = \`
              <div class="placeholder">
                <div class="placeholder-icon">\${selectedFile ? '✓' : '📝'}</div>
                <div class="placeholder-text">\${selectedFile ? 'No changes in this file' : 'Select a modified file to view changes'}</div>
              </div>
            \`;
            return;
          }

          header.textContent = diff.file;
          stats.innerHTML = \`
            <span class="stat-added">+\${diff.stats.additions}</span>
            <span class="stat-removed">-\${diff.stats.deletions}</span>
          \`;

          viewer.innerHTML = '<table class="diff-table">' + renderHunksToHtml(diff.hunks) + '</table>';
          setupLineHoverHandlers(diff.file);
        }

        function renderHunksToHtml(hunks) {
          let html = '';
          for (const hunk of hunks) {
            html += \`<tr><td colspan="4" class="diff-hunk-header">\${escapeHtml(hunk.header)}</td></tr>\`;
            for (const line of hunk.lines) {
              const lineClass = line.type;
              const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
              const oldNum = line.oldLineNumber || '';
              const newNum = line.newLineNumber || '';
              const displayLineNum = newNum || oldNum || '';
              const showCommentBtn = line.type === 'addition' || line.type === 'deletion';
              html += \`
                <tr class="diff-line \${lineClass}" data-line="\${displayLineNum}">
                  <td class="comment-btn-cell">\${showCommentBtn ? \`<button class="line-comment-btn" data-line="\${displayLineNum}">+</button>\` : ''}</td>
                  <td class="diff-line-num">\${oldNum}</td>
                  <td class="diff-line-num">\${newNum}</td>
                  <td class="diff-line-content" data-prefix="\${prefix}">\${escapeHtml(line.content)}</td>
                </tr>
              \`;
            }
          }
          return html;
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
            const row = e.target.closest('.diff-line');
            if (!row || e.target.closest('.line-comment-btn') || e.target.closest('.inline-comment-form')) return;
            const lineNum = row.dataset.line;
            if (!lineNum) return;
            isSelecting = true;
            selectionStartLine = parseInt(lineNum);
            selectionEndLine = parseInt(lineNum);
            clearLineSelection();
            row.classList.add('line-selected');
          };

          viewer.onmousemove = (e) => {
            if (!isSelecting) return;
            const row = e.target.closest('.diff-line');
            if (!row) return;
            const lineNum = row.dataset.line;
            if (!lineNum) return;
            selectionEndLine = parseInt(lineNum);
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
                const rows = document.querySelectorAll('.diff-line');
                for (const row of rows) {
                  if (parseInt(row.dataset.line) === endLine) {
                    selectedLineElement = row;
                    break;
                  }
                }
                showInlineCommentForm(currentFile, startLine, endLine);
              }
            }
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
          const selectedRows = [];
          document.querySelectorAll('.diff-line').forEach(row => {
            const lineNum = parseInt(row.dataset.line);
            if (lineNum >= startLine && lineNum <= endLine) {
              row.classList.add('line-selected');
              selectedRows.push({ row, lineNum });
            }
          });
          if (selectedRows.length > 0) {
            selectedRows.sort((a, b) => a.lineNum - b.lineNum);
            selectedRows[0].row.classList.add('selection-start');
            selectedRows[selectedRows.length - 1].row.classList.add('selection-end');
          }
        }

        function showInlineCommentForm(currentFile, startLine, endLine) {
          const existingFormRow = document.querySelector('.comment-form-row');
          if (existingFormRow) existingFormRow.remove();
          if (!selectedLineElement) return;

          const isSingleLine = !endLine || startLine === endLine;
          const lineDisplay = isSingleLine
            ? \`line \${startLine || selectedLineNum}\`
            : \`lines \${startLine}-\${endLine}\`;

          const formRow = document.createElement('tr');
          formRow.className = 'comment-form-row';
          formRow.dataset.currentFile = currentFile;
          formRow.innerHTML = \`
            <td colspan="4" style="padding: 0; border: none;">
              <div class="inline-comment-form active" data-start="\${startLine || selectedLineNum}" data-end="\${endLine || startLine || selectedLineNum}">
                <div class="comment-form-header">Comment on \${lineDisplay}</div>
                <textarea class="comment-textarea" placeholder="Leave a comment..."></textarea>
                <div class="comment-form-actions">
                  <button class="btn-secondary" onclick="cancelCommentForm(this)">Cancel</button>
                  <button onclick="submitInlineComment(this)">Add Comment</button>
                </div>
              </div>
            </td>
          \`;
          selectedLineElement.after(formRow);
          formRow.querySelector('textarea').focus();
        }

        window.cancelCommentForm = function(btn) {
          clearLineSelection();
          const formRow = btn.closest('.comment-form-row');
          if (formRow) formRow.remove();
          selectionStartLine = null;
          selectionEndLine = null;
        };

        window.submitInlineComment = function(btn) {
          const formRow = btn.closest('.comment-form-row');
          const form = btn.closest('.inline-comment-form');
          const text = form.querySelector('textarea').value;
          const startLine = form.dataset.start;
          const endLine = form.dataset.end;
          const currentFile = formRow.dataset.currentFile;

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
