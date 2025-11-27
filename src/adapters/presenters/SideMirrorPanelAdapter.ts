import * as vscode from 'vscode';
import { Comment } from '../../domain/entities/Comment';
import { IPanelPort } from '../../application/ports/IPanelPort';
import { GenerateDiffUseCase } from '../../application/useCases/GenerateDiffUseCase';
import { AddCommentUseCase } from '../../application/useCases/AddCommentUseCase';

export class SideMirrorPanelAdapter implements IPanelPort {
    public static currentPanel: SideMirrorPanelAdapter | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly context: vscode.ExtensionContext;
    private disposables: vscode.Disposable[] = [];

    private generateDiffUseCase: GenerateDiffUseCase | undefined;
    private addCommentUseCase: AddCommentUseCase | undefined;
    private onSubmitComments: (() => void) | undefined;

    public static show(context: vscode.ExtensionContext): SideMirrorPanelAdapter {
        if (SideMirrorPanelAdapter.currentPanel) {
            SideMirrorPanelAdapter.currentPanel.panel.reveal(vscode.ViewColumn.Two);
            return SideMirrorPanelAdapter.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'sidemirror',
            'SideMirror',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')]
            }
        );

        SideMirrorPanelAdapter.currentPanel = new SideMirrorPanelAdapter(panel, context);
        return SideMirrorPanelAdapter.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.context = context;

        this.update();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'submitComments':
                        this.onSubmitComments?.();
                        break;
                    case 'openFile':
                        if (message.file && this.generateDiffUseCase) {
                            await this.generateDiffUseCase.execute(message.file);
                        }
                        break;
                    case 'addComment':
                        if (this.addCommentUseCase) {
                            await this.addCommentUseCase.execute({
                                file: message.file,
                                line: message.line,
                                endLine: message.endLine,
                                text: message.text,
                                codeContext: message.context || '',
                            });
                        }
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    setUseCases(
        generateDiffUseCase: GenerateDiffUseCase,
        addCommentUseCase: AddCommentUseCase,
        onSubmitComments: () => void
    ): void {
        this.generateDiffUseCase = generateDiffUseCase;
        this.addCommentUseCase = addCommentUseCase;
        this.onSubmitComments = onSubmitComments;
    }

    show(): void {
        this.panel.reveal(vscode.ViewColumn.Two);
    }

    updateFileChanged(file: string): void {
        this.panel.webview.postMessage({ type: 'fileChanged', file });
    }

    updateCommentAdded(comment: Comment): void {
        this.panel.webview.postMessage({ type: 'commentAdded', comment: comment.toData() });
    }

    updateAIType(aiType: string): void {
        this.panel.webview.postMessage({ type: 'aiTypeChanged', aiType });
    }

    postDiff(file: string, diff: string): void {
        this.panel.webview.postMessage({
            type: 'displayDiff',
            file,
            diff,
        });
    }

    public dispose(): void {
        SideMirrorPanelAdapter.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private update(): void {
        this.panel.webview.html = this.getHtmlForWebview();
    }

    private getHtmlForWebview(): string {
        return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SideMirror</title>
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
          grid-template-columns: 1fr 320px;
          grid-template-areas: "main sidebar";
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
          grid-template-columns: 1fr 44px;
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
        }

        .comment-meta {
          font-size: 10px;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 4px;
          font-family: monospace;
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
      </style>
    </head>
    <body class="sidebar-collapsed">
      <div class="sidebar collapsed">
        <div class="header">
          <h2>SideMirror</h2>
          <div class="status" id="status-badge">
            <span id="ai-status-dot">●</span>
            <span id="ai-type">Ready</span>
          </div>
        </div>

        <div class="section">
          <h3>Changed Files</h3>
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
        let currentFile = '';
        let selectedLineNum = null;
        let selectedLineElement = null;
        let selectionStartLine = null;
        let selectionEndLine = null;
        let isSelecting = false;

        const bodyEl = document.body;
        const sidebarEl = document.querySelector('.sidebar');
        const toggleButton = document.getElementById('toggle-sidebar');

        function expandSidebar() {
          bodyEl.classList.remove('sidebar-collapsed');
          sidebarEl.classList.remove('collapsed');
          toggleButton.textContent = '>';
          toggleButton.setAttribute('aria-label', 'Collapse file list panel');
        }

        function collapseSidebar() {
          bodyEl.classList.add('sidebar-collapsed');
          sidebarEl.classList.add('collapsed');
          toggleButton.textContent = '<';
          toggleButton.setAttribute('aria-label', 'Expand file list panel');
        }

        toggleButton.addEventListener('click', () => {
          if (bodyEl.classList.contains('sidebar-collapsed')) {
            expandSidebar();
          } else {
            collapseSidebar();
          }
        });

        document.getElementById('submit-comments').addEventListener('click', () => {
          vscode.postMessage({ type: 'submitComments' });
        });

        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'fileChanged':
              addFile(message.file);
              break;
            case 'commentAdded':
              addComment(message.comment);
              break;
            case 'aiTypeChanged':
              updateAIType(message.aiType);
              break;
            case 'displayDiff':
              renderDiff(message.file, message.diff);
              break;
          }
        });

        function addFile(filePath) {
          const list = document.getElementById('files-list');
          if (list.querySelector('.empty-text')) {
            list.innerHTML = '';
          }

          if (Array.from(list.children).find(c => c.dataset.file === filePath)) return;

          const item = document.createElement('div');
          item.className = 'file-item';
          item.dataset.file = filePath;

          const fileName = filePath.split('/').pop();

          item.innerHTML = \`
            <span class="file-icon">📄</span>
            <span class="file-name" title="\${filePath}">\${fileName}</span>
            <span class="file-badge">M</span>
          \`;

          item.onclick = () => {
            document.querySelectorAll('.file-item').forEach(f => f.classList.remove('selected'));
            item.classList.add('selected');
            vscode.postMessage({ type: 'openFile', file: filePath });
          };

          list.appendChild(item);

          // Auto-focus on the new file if no file is currently displayed
          if (!currentFile) {
            expandSidebar();
            item.classList.add('selected');
            vscode.postMessage({ type: 'openFile', file: filePath });
          }
        }

        function renderDiff(file, diffText) {
          currentFile = file;

          document.querySelector('.diff-header-title').textContent = file;

          const viewer = document.getElementById('diff-viewer');

          if (!diffText || diffText.trim() === '') {
            viewer.innerHTML = '<div class="placeholder"><div class="placeholder-icon">✓</div><div class="placeholder-text">No changes in this file</div></div>';
            document.getElementById('diff-stats').innerHTML = '';
            return;
          }

          const { html, additions, deletions } = parseDiff(diffText);

          document.getElementById('diff-stats').innerHTML = \`
            <span class="stat-added">+\${additions}</span>
            <span class="stat-removed">-\${deletions}</span>
          \`;

          viewer.innerHTML = '<table class="diff-table">' + html + '</table>';

          setupLineHoverHandlers();
        }

        function parseDiff(diffText) {
          const lines = diffText.split('\\n');
          let html = '';
          let additions = 0;
          let deletions = 0;
          let oldLineNum = 0;
          let newLineNum = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('diff --git') ||
                line.startsWith('index ') ||
                line.startsWith('---') ||
                line.startsWith('+++') ||
                line.startsWith('\\\\')) {
              continue;
            }

            if (line.startsWith('@@')) {
              const match = line.match(/@@ -(\\d+),?\\d* \\+(\\d+),?\\d* @@(.*)/);
              if (match) {
                oldLineNum = parseInt(match[1], 10);
                newLineNum = parseInt(match[2], 10);
                html += \`<tr><td colspan="4" class="diff-hunk-header">\${escapeHtml(line)}</td></tr>\`;
              }
              continue;
            }

            let lineClass = 'context';
            let prefix = ' ';
            let oldNum = '';
            let newNum = '';
            let content = line;

            if (line.startsWith('+')) {
              lineClass = 'addition';
              prefix = '+';
              content = line.substring(1);
              newNum = newLineNum++;
              additions++;
            } else if (line.startsWith('-')) {
              lineClass = 'deletion';
              prefix = '-';
              content = line.substring(1);
              oldNum = oldLineNum++;
              deletions++;
            } else {
              content = line.startsWith(' ') ? line.substring(1) : line;
              oldNum = oldLineNum++;
              newNum = newLineNum++;
            }

            const displayLineNum = newNum || oldNum || '';
            const showCommentBtn = lineClass === 'addition' || lineClass === 'deletion';

            html += \`
              <tr class="diff-line \${lineClass}" data-line="\${displayLineNum}">
                <td class="comment-btn-cell">\${showCommentBtn ? \`<button class="line-comment-btn" data-line="\${displayLineNum}">+</button>\` : ''}</td>
                <td class="diff-line-num">\${oldNum}</td>
                <td class="diff-line-num">\${newNum}</td>
                <td class="diff-line-content" data-prefix="\${prefix}">\${escapeHtml(content)}</td>
              </tr>
            \`;
          }

          return { html, additions, deletions };
        }

        function escapeHtml(text) {
          const div = document.createElement('div');
          div.textContent = text;
          return div.innerHTML;
        }

        function setupLineHoverHandlers() {
          const viewer = document.getElementById('diff-viewer');

          viewer.addEventListener('click', (e) => {
            const btn = e.target.closest('.line-comment-btn');
            if (btn) {
              const lineNum = btn.dataset.line;
              const row = btn.closest('tr');
              selectedLineNum = lineNum;
              selectedLineElement = row;
              selectionStartLine = null;
              selectionEndLine = null;
              showInlineCommentForm();
            }
          });

          viewer.addEventListener('mousedown', (e) => {
            const row = e.target.closest('.diff-line');
            if (!row || e.target.closest('.line-comment-btn') || e.target.closest('.inline-comment-form')) return;

            const lineNum = row.dataset.line;
            if (!lineNum) return;

            isSelecting = true;
            selectionStartLine = parseInt(lineNum);
            selectionEndLine = parseInt(lineNum);
            clearLineSelection();
            row.classList.add('line-selected');
          });

          viewer.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;

            const row = e.target.closest('.diff-line');
            if (!row) return;

            const lineNum = row.dataset.line;
            if (!lineNum) return;

            selectionEndLine = parseInt(lineNum);
            updateLineSelection();
          });

          document.addEventListener('mouseup', (e) => {
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
                showInlineCommentForm(startLine, endLine);
              }
            }
          });
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

        function showInlineCommentForm(startLine, endLine) {
          const existingFormRow = document.querySelector('.comment-form-row');
          if (existingFormRow) existingFormRow.remove();

          if (!selectedLineElement) return;

          const isSingleLine = !endLine || startLine === endLine;
          const lineDisplay = isSingleLine
            ? \`line \${startLine || selectedLineNum}\`
            : \`lines \${startLine}-\${endLine}\`;

          const formRow = document.createElement('tr');
          formRow.className = 'comment-form-row';
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
          const form = btn.closest('.inline-comment-form');
          const text = form.querySelector('textarea').value;
          const startLine = form.dataset.start;
          const endLine = form.dataset.end;

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
            const formRow = btn.closest('.comment-form-row');
            if (formRow) formRow.remove();
            selectionStartLine = null;
            selectionEndLine = null;
          }
        };

        function addComment(comment) {
          const list = document.getElementById('comments-list');
          if (list.querySelector('.empty-text')) {
            list.innerHTML = '';
          }

          const lineDisplay = comment.endLine
            ? \`\${comment.line}-\${comment.endLine}\`
            : comment.line;

          const item = document.createElement('div');
          item.className = 'comment-item';
          item.innerHTML = \`
            <div class="comment-meta">\${comment.file}:\${lineDisplay}</div>
            <div>\${comment.text}</div>
          \`;
          list.appendChild(item);
        }

        function updateAIType(type) {
          const label = type === 'claude' ? 'Claude' :
                        type === 'codex' ? 'Codex' :
                        type === 'gemini' ? 'Gemini' : type;
          document.getElementById('ai-type').textContent = label;
          document.getElementById('status-badge').classList.add('active');
        }
      </script>
    </body>
    </html>`;
    }
}
