export const webviewStyles = `
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
  position: relative;
}

.file-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.file-item.selected {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
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

.file-item.content-match::after {
  content: '≡';
  margin-left: 4px;
  color: var(--vscode-descriptionForeground);
  font-size: 10px;
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
  white-space: pre;
}

.markdown-preview pre code {
  background: none;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
  border-radius: 0;
  white-space: pre;
  display: block;
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

/* Highlight target animation for preview blocks */
.markdown-preview .diff-block.highlight-target {
  animation: highlight-flash 2s ease-out;
  background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33)) !important;
}

.preview-comment-box.highlight-target {
  animation: highlight-flash 2s ease-out;
  box-shadow: 0 0 0 2px var(--vscode-focusBorder, #007fd4);
}

/* Comment range indicator - shows which blocks have comments */
.markdown-preview .diff-block.has-comment {
  position: relative;
}

.comment-gutter-indicators {
  position: absolute;
  left: -16px;
  top: 0;
  bottom: 0;
  display: flex;
  gap: 2px;
}

.comment-gutter-bar {
  width: 3px;
  height: 100%;
  border-radius: 2px;
}

.comment-gutter-bar.color-0 { background: #58a6ff; }
.comment-gutter-bar.color-1 { background: #f78166; }
.comment-gutter-bar.color-2 { background: #7ee787; }
.comment-gutter-bar.color-3 { background: #d2a8ff; }
.comment-gutter-bar.color-4 { background: #ffa657; }
.comment-gutter-bar.color-5 { background: #ff7b72; }

.markdown-preview .diff-deletion {
  background: var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.15));
  border-left: 3px solid var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
  padding-left: 8px;
  margin-left: -11px;
  text-decoration: line-through;
  opacity: 0.7;
}

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

.markdown-preview .task-list-item {
  list-style: none;
  margin-left: -20px;
}

.markdown-preview .task-list-item input[type="checkbox"] {
  margin-right: 8px;
  pointer-events: none;
}

.markdown-preview pre code .hljs-keyword { color: var(--vscode-debugTokenExpression-name, #c586c0); }
.markdown-preview pre code .hljs-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.markdown-preview pre code .hljs-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
.markdown-preview pre code .hljs-comment { color: var(--vscode-descriptionForeground, #6a9955); font-style: italic; }
.markdown-preview pre code .hljs-function { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
.markdown-preview pre code .hljs-class { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
.markdown-preview pre code .hljs-variable { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
.markdown-preview pre code .hljs-operator { color: var(--vscode-foreground, #d4d4d4); }
.markdown-preview pre code .hljs-punctuation { color: var(--vscode-foreground, #d4d4d4); }
.markdown-preview pre code .hljs-property { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); }
.markdown-preview pre code .hljs-tag { color: var(--vscode-debugTokenExpression-name, #569cd6); }
.markdown-preview pre code .hljs-attr { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); }
.markdown-preview pre code .hljs-builtin { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
.markdown-preview pre code .hljs-type { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }

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

.overview-marker.comment {
  background: var(--vscode-textLink-foreground, #58a6ff);
}

/* Preview inline comments */
.preview-inline-comments {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.4;
}

.preview-comment-box {
  background: var(--vscode-editor-inactiveSelectionBackground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  margin-bottom: 6px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.4;
}

.preview-comment-box.color-0 { border-left: 3px solid #58a6ff; }
.preview-comment-box.color-1 { border-left: 3px solid #f78166; }
.preview-comment-box.color-2 { border-left: 3px solid #7ee787; }
.preview-comment-box.color-3 { border-left: 3px solid #d2a8ff; }
.preview-comment-box.color-4 { border-left: 3px solid #ffa657; }
.preview-comment-box.color-5 { border-left: 3px solid #ff7b72; }

.preview-comment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--vscode-titleBar-activeBackground, rgba(255, 255, 255, 0.05));
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 11px !important;
  line-height: 1.4 !important;
  margin: 0;
}

.preview-comment-header .comment-location {
  color: var(--vscode-descriptionForeground);
  font-weight: 600;
}

.preview-comment-body {
  padding: 12px;
  font-size: 12px !important;
  line-height: normal !important;
  white-space: pre-line;
  word-break: break-word;
  text-align: left;
  margin: 0;
  display: block;
}

.preview-comment-edit {
  padding: 12px;
  background: var(--vscode-input-background);
}

.preview-comment-edit textarea {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  resize: vertical;
  font-family: inherit;
  font-size: 12px;
  box-sizing: border-box;
}

.preview-comment-edit textarea:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

.preview-comment-box.submitted {
  opacity: 0.7;
}

.preview-comment-box.submitted .preview-comment-header {
  background: var(--vscode-editor-background);
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

.comment-item.color-0 { border-left-color: #58a6ff; }
.comment-item.color-1 { border-left-color: #f78166; }
.comment-item.color-2 { border-left-color: #7ee787; }
.comment-item.color-3 { border-left-color: #d2a8ff; }
.comment-item.color-4 { border-left-color: #ffa657; }
.comment-item.color-5 { border-left-color: #ff7b72; }

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

/* Comment header with actions */
.comment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.comment-location {
  cursor: pointer;
  color: var(--vscode-textLink-foreground);
  font-size: 10px;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.comment-location:hover {
  text-decoration: underline;
}

.comment-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-icon {
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 12px;
  width: auto;
}

.btn-icon:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.btn-icon.btn-danger:hover {
  color: var(--vscode-errorForeground, #f85149);
}

/* Comment text */
.comment-text {
  word-wrap: break-word;
}

/* Comment edit form */
.comment-edit-form {
  margin-top: 8px;
}

.comment-edit-form textarea {
  width: 100%;
  min-height: 60px;
  margin-bottom: 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: 12px;
  box-sizing: border-box;
}

.comment-edit-form textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

/* Submitted section */
.submitted-section {
  margin-top: 16px;
  border-top: 1px solid var(--vscode-panel-border);
  padding-top: 8px;
}

.submitted-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  padding: 4px 0;
}

.submitted-header:hover {
  color: var(--vscode-foreground);
}

.submitted-toggle {
  font-size: 10px;
}

.submitted-list {
  margin-top: 8px;
}

.submitted-badge {
  font-size: 10px;
  color: var(--vscode-testing-iconPassed, #238636);
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

/* Addition line prefix color - content uses syntax highlighting */
.diff-line.addition .diff-line-content::before {
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
}

.diff-line.deletion {
  background: var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.15));
}

.diff-line.deletion .diff-line-num {
  background: var(--vscode-diffEditorGutter-removedLineBackground, rgba(248, 81, 73, 0.2));
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
}

/* Deletion line prefix color - content uses syntax highlighting */
.diff-line.deletion .diff-line-content::before {
  color: var(--vscode-gitDecoration-deletedResourceForeground, #f85149);
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

/* Line highlight animation for navigation */
@keyframes highlight-flash {
  0% {
    background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
  }
  50% {
    background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
  }
  100% {
    background-color: transparent;
  }
}

.diff-line.highlight-target {
  animation: highlight-flash 2s ease-out;
}

.diff-line.highlight-target td {
  background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33)) !important;
  transition: background-color 0.5s ease-out;
}

/* Gutter column */
.col-gutter {
  width: 20px;
}

.diff-gutter {
  width: 20px;
  min-width: 20px;
  text-align: center;
  cursor: default;
  user-select: none;
  border-right: 1px solid var(--vscode-panel-border);
  vertical-align: middle;
}

.diff-gutter.has-comment {
  cursor: pointer;
}

.diff-gutter.has-comment:hover {
  background: var(--vscode-list-hoverBackground);
}

/* Comment range indicator */
.diff-gutter.has-comment {
  position: relative;
}

.range-line {
  position: absolute;
  width: 2px;
  border-radius: 1px;
}

.range-line.range-single {
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  border-radius: 2px;
}

.range-line.range-start {
  top: 50%;
  bottom: 0;
}

.range-line.range-middle {
  top: 0;
  bottom: 0;
}

.range-line.range-end {
  top: 0;
  bottom: 50%;
}

/* End dot marker */
.end-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 8px;
  line-height: 1;
}

/* Color palette for comments */
.range-line.color-0, .end-dot.color-0 { background: #58a6ff; color: #58a6ff; }
.range-line.color-1, .end-dot.color-1 { background: #f78166; color: #f78166; }
.range-line.color-2, .end-dot.color-2 { background: #7ee787; color: #7ee787; }
.range-line.color-3, .end-dot.color-3 { background: #d2a8ff; color: #d2a8ff; }
.range-line.color-4, .end-dot.color-4 { background: #ffa657; color: #ffa657; }
.range-line.color-5, .end-dot.color-5 { background: #ff7b72; color: #ff7b72; }

/* Comment box colors */
.inline-comment-box.color-0 { border-left: 3px solid #58a6ff; }
.inline-comment-box.color-1 { border-left: 3px solid #f78166; }
.inline-comment-box.color-2 { border-left: 3px solid #7ee787; }
.inline-comment-box.color-3 { border-left: 3px solid #d2a8ff; }
.inline-comment-box.color-4 { border-left: 3px solid #ffa657; }
.inline-comment-box.color-5 { border-left: 3px solid #ff7b72; }

/* Inline comment row */
.inline-comment-row {
  background: var(--vscode-editor-background);
}

.inline-comment-row td {
  text-align: left;
  padding: 0;
}

.inline-comment-row.collapsed {
  display: none;
}

.inline-comments {
  padding: 8px;
  border-left: 3px solid var(--vscode-textLink-foreground);
  margin: 4px 0;
}

.inline-comment-box {
  background: var(--vscode-editor-inactiveSelectionBackground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  margin-bottom: 8px;
  overflow: hidden;
}

.inline-comment-box:last-child {
  margin-bottom: 0;
}

.inline-comment-box.submitted {
  opacity: 0.8;
}

/* Comment header */
.inline-comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--vscode-titleBar-inactiveBackground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.comment-author {
  flex: 1;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.inline-comment-actions {
  display: flex;
  gap: 4px;
}

.submitted-label {
  font-size: 10px;
  color: var(--vscode-testing-iconPassed, #238636);
}

/* Comment body */
.inline-comment-body {
  padding: 8px;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  text-align: left;
}


/* Edit form */
.inline-comment-edit {
  padding: 8px;
}

.inline-comment-edit textarea {
  width: 100%;
  min-height: 60px;
  margin-bottom: 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 4px;
  padding: 8px;
  resize: vertical;
  font-family: inherit;
  font-size: 12px;
  box-sizing: border-box;
}

.inline-comment-edit textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

/* ===== Syntax Highlighting Styles ===== */
/*
 * Shiki uses inline styles for syntax highlighting (style="color:#...").
 * We only need to ensure backgrounds are transparent and deleted lines are dimmed.
 */

/* Ensure Shiki's wrapper elements don't add backgrounds */
.diff-line-content .line {
  display: inline;
}

/* Slightly dim syntax colors for deleted lines */
.diff-line.deletion .diff-line-content span[style] {
  opacity: 0.85;
}

/* Markdown preview code block syntax highlighting */
.markdown-preview pre code {
  background: transparent !important;
}

/* ===== Hacker News Feed Styles ===== */
.hn-feed {
  padding: 20px;
  height: 100%;
  overflow-y: auto;
  background: var(--vscode-editor-background);
}

.hn-feed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.hn-feed-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.hn-feed-title .hn-icon { color: #ff6600; }

.hn-refresh-btn {
  width: auto;
  padding: 4px 10px;
  font-size: 11px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.hn-refresh-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.hn-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.hn-refresh-btn.loading { pointer-events: none; }
.hn-refresh-btn.loading .refresh-icon {
  animation: spin 1s linear infinite;
}

@keyframes hn-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.hn-story-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hn-load-more {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.hn-load-more-btn {
  padding: 8px 24px;
  background: var(--vscode-button-secondaryBackground);
  border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
  color: var(--vscode-button-secondaryForeground);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s;
}

.hn-load-more-btn:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground);
}

.hn-load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hn-loading-spinner-small {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--vscode-foreground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: hn-spin 1s linear infinite;
}

.hn-end-of-list {
  text-align: center;
  padding: 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.hn-story {
  padding: 10px 12px;
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 6px;
  transition: background 0.15s;
}

.hn-story:hover { background: var(--vscode-list-hoverBackground); }

.hn-story-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
  cursor: pointer;
  line-height: 1.4;
  margin-bottom: 6px;
  display: block;
}

.hn-story-title:hover {
  color: var(--vscode-textLink-foreground);
  text-decoration: underline;
}

.hn-story-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.hn-story-score {
  color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950);
  font-weight: 500;
}

.hn-story-comments { cursor: pointer; display: flex; align-items: center; gap: 4px; }
.hn-story-comments:hover {
  color: var(--vscode-textLink-foreground);
  text-decoration: underline;
}

.hn-story-domain { color: var(--vscode-textLink-foreground); opacity: 0.8; }
.hn-story-time { margin-left: auto; }

/* External link indicator for iframe-blocked domains */
.hn-external-indicator {
  margin-left: 4px;
  font-size: 10px;
  opacity: 0.9;
}

.hn-story-external .hn-story-title::after {
  content: ' ↗';
  font-size: 11px;
  opacity: 0.7;
}

/* Loading state */
.hn-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: var(--vscode-descriptionForeground);
}

.hn-loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--vscode-panel-border);
  border-top-color: var(--vscode-textLink-foreground);
  border-radius: 50%;
  animation: hn-spin 1s linear infinite;
}

/* Error state */
.hn-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  text-align: center;
}

.hn-error-icon { font-size: 32px; opacity: 0.5; }
.hn-error-message { color: var(--vscode-errorForeground); font-size: 13px; }
.hn-error-retry { margin-top: 8px; }

.hn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
  color: var(--vscode-descriptionForeground);
}

/* ============================================
   Scoped Diff Styles
   ============================================ */

.scope-tree {
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size);
}

/* Scope Node Container */
.scope-node {
  margin-left: 0;
}

.scope-node[data-depth="1"] { margin-left: 16px; }
.scope-node[data-depth="2"] { margin-left: 32px; }
.scope-node[data-depth="3"] { margin-left: 48px; }
.scope-node[data-depth="4"] { margin-left: 64px; }

/* Scope Header */
.scope-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.1s;
}

.scope-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.scope-header.has-changes {
  background: color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground) 30%, transparent);
  border-left: 3px solid var(--vscode-gitDecoration-addedResourceForeground);
  padding-left: 9px;
}

/* Collapsed scope with changes - prominent visual indicator */
.scope-header.collapsed-with-changes {
  background: linear-gradient(
    90deg,
    var(--vscode-diffEditor-insertedLineBackground) 0%,
    color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground) 60%, transparent) 100%
  );
  border-left: 4px solid var(--vscode-gitDecoration-addedResourceForeground);
  padding-left: 8px;
  animation: pulse-changed 2s ease-in-out 1;
}

.scope-header.collapsed-with-changes::after {
  content: '⚠ contains changes';
  font-size: 10px;
  color: var(--vscode-editorWarning-foreground, #cca700);
  margin-left: 8px;
  padding: 1px 6px;
  background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 15%, transparent);
  border-radius: 3px;
  font-weight: 500;
}

@keyframes pulse-changed {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Toggle Arrow */
.scope-toggle {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--vscode-foreground);
  opacity: 0.7;
  transition: transform 0.15s ease;
}

.scope-toggle.collapsed {
  transform: rotate(-90deg);
}

.scope-header.no-collapse .scope-toggle {
  opacity: 0.3;
}

/* Scope Icon */
.scope-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.scope-icon.function { color: var(--vscode-symbolIcon-functionForeground, #b180d7); }
.scope-icon.method { color: var(--vscode-symbolIcon-methodForeground, #b180d7); }
.scope-icon.class { color: var(--vscode-symbolIcon-classForeground, #ee9d28); }
.scope-icon.interface { color: var(--vscode-symbolIcon-interfaceForeground, #75beff); }
.scope-icon.constructor { color: var(--vscode-symbolIcon-constructorForeground, #b180d7); }
.scope-icon.enum { color: var(--vscode-symbolIcon-enumeratorForeground, #ee9d28); }
.scope-icon.module { color: var(--vscode-symbolIcon-moduleForeground, #ee9d28); }
.scope-icon.namespace { color: var(--vscode-symbolIcon-namespaceForeground, #ee9d28); }

/* Scope Name */
.scope-name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Scope Kind Badge */
.scope-kind {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  padding: 1px 4px;
  background: var(--vscode-badge-background);
  border-radius: 3px;
  opacity: 0.7;
}

/* Scope Stats */
.scope-stats {
  font-size: 11px;
  font-family: var(--vscode-editor-font-family);
  display: flex;
  gap: 6px;
}

.scope-stats .added {
  color: var(--vscode-gitDecoration-addedResourceForeground);
}

.scope-stats .removed {
  color: var(--vscode-gitDecoration-deletedResourceForeground);
}

.scope-stats .no-changes {
  color: var(--vscode-descriptionForeground);
  opacity: 0.6;
}

/* Scope Content */
.scope-content {
  overflow: hidden;
  border-left: 1px solid var(--vscode-panel-border);
  margin-left: 7px;
}

.scope-content.collapsed {
  display: none;
}

/* Scope Lines */
.scope-lines {
  margin: 0;
}

/* Nested scopes separator */
.scope-node + .scope-node {
  border-top: 1px solid var(--vscode-panel-border);
}

/* ============================================
   Orphan Lines Section
   ============================================ */

.orphan-lines {
  border-top: 1px dashed var(--vscode-panel-border);
  padding-top: 8px;
  margin-top: 16px;
}

.orphan-lines-header {
  color: var(--vscode-descriptionForeground);
  font-size: 11px;
  padding: 4px 12px;
  font-style: italic;
}

/* ============================================
   Expand/Collapse All Buttons
   ============================================ */

.scope-controls {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.scope-control-btn {
  font-size: 11px;
  padding: 3px 8px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: background-color 0.1s;
}

.scope-control-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* ============================================
   Fallback Message
   ============================================ */

.scope-fallback-message {
  padding: 12px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  font-style: italic;
  text-align: center;
  border-bottom: 1px solid var(--vscode-panel-border);
}

/* ============================================
   Waiting Screen Styles
   ============================================ */

.waiting-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  text-align: center;
  height: 100%;
  box-sizing: border-box;
}

.waiting-spinner {
  display: inline-block;
  width: 24px;
  height: 24px;
  border: 2px solid var(--vscode-foreground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: waiting-spin 1s linear infinite;
  margin-bottom: 12px;
}

@keyframes waiting-spin {
  to { transform: rotate(360deg); }
}

.waiting-message {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 24px;
}

.layout-guide {
  margin-bottom: 24px;
  text-align: center;
}

.layout-hint {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.layout-diagram {
  font-family: monospace;
  font-size: 11px;
  line-height: 1.3;
  color: var(--vscode-foreground);
  opacity: 0.7;
  white-space: pre;
  display: inline-block;
  text-align: left;
  padding: 8px 16px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
}

.layout-tip {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-top: 8px;
  font-style: italic;
}

.meanwhile-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 16px 0;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.meanwhile-divider::before,
.meanwhile-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--vscode-widget-border);
}

.waiting-feed-container {
  width: 100%;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.waiting-refresh-btn {
  margin-top: 16px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder));
  color: var(--vscode-foreground);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.waiting-refresh-btn:hover {
  background: var(--vscode-list-hoverBackground);
}

/* Feed Toggle Button */
.feed-toggle-btn {
  background: transparent;
  border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder));
  color: var(--vscode-foreground);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  margin-left: auto;
}

.feed-toggle-btn:hover {
  background: var(--vscode-list-hoverBackground);
}

/* ============================================
   Content View Styles
   ============================================ */

.content-view {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content-view-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--vscode-editor-background);
}

.content-view-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--vscode-editor-background);
  z-index: 10;
}

.content-view-loading.hidden {
  display: none;
}

.content-view-loading .loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--vscode-foreground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.content-view-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--vscode-editor-background);
}

.content-view-error.hidden {
  display: none;
}

.content-view-error .error-icon {
  font-size: 48px;
}

.content-view-error .error-text {
  color: var(--vscode-errorForeground);
  font-size: 14px;
}

.content-view-error .error-actions {
  display: flex;
  gap: 12px;
}

.content-view-error .error-btn {
  padding: 6px 16px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.content-view-error .error-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

/* Content View Header Actions */
.content-view-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.content-action-btn {
  padding: 4px 12px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.content-action-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.content-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Agent Header Styles (Multi-Agent Mode) */
.agent-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-header--aggregated {
  color: var(--vscode-descriptionForeground);
}

.agent-status {
  font-size: 10px;
  line-height: 1;
}

.agent-status--working {
  color: var(--vscode-charts-green, #4ec9b0);
}

.agent-status--waiting {
  color: var(--vscode-charts-yellow, #dcdcaa);
}

.agent-status--error {
  color: var(--vscode-charts-red, #f14c4c);
}

.agent-status--idle {
  color: var(--vscode-descriptionForeground);
}

.agent-name {
  font-weight: 500;
  font-size: 14px;
}

.agent-icon {
  font-size: 14px;
  opacity: 0.8;
}

/* Agent Badge Styles (for aggregated file list) */
.agent-badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  margin-left: auto;
  white-space: nowrap;
  flex-shrink: 0;
}

.agent-badge--multi {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

/* 6-color palette for agent badges */
.agent-badge--color-0 {
  background: rgba(66, 165, 245, 0.2);
  color: #42a5f5;
}

.agent-badge--color-1 {
  background: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}

.agent-badge--color-2 {
  background: rgba(255, 167, 38, 0.2);
  color: #ffa726;
}

.agent-badge--color-3 {
  background: rgba(171, 71, 188, 0.2);
  color: #ab47bc;
}

.agent-badge--color-4 {
  background: rgba(239, 83, 80, 0.2);
  color: #ef5350;
}

.agent-badge--color-5 {
  background: rgba(38, 198, 218, 0.2);
  color: #26c6da;
}

/* Thread Badge Styles (Multi-Thread Mode) */
.thread-badge {
  margin-left: 8px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-badge-background);
  border-radius: 3px;
  font-weight: normal;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
}
`;
