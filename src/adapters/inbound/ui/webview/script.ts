export const webviewScript = `
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

diffCollapseAll.addEventListener('click', () => {
  vscode.postMessage({ type: 'toggleAllChunks' });
});

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

  highlightDiffMatches();

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
  const matchesByCell = new Map();
  diffSearchMatches.forEach((match, index) => {
    if (!matchesByCell.has(match.cell)) {
      matchesByCell.set(match.cell, []);
    }
    matchesByCell.get(match.cell).push({ ...match, index });
  });

  matchesByCell.forEach((matches, cell) => {
    const text = cell.textContent;
    const prefix = cell.dataset.prefix || '';

    matches.sort((a, b) => b.start - a.start);

    let html = escapeHtml(text);

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

function onFileChange() {
  if (diffSearchQuery) {
    performDiffSearch();
  }
}

// ===== Single message handler - state-based rendering =====
window.addEventListener('message', event => {
  const { type, state } = event.data;
  if (type === 'render' && state) {
    renderState(state);
  }
});

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

  if (uncommittedFiles && uncommittedFiles.length > 0) {
    toggleRow.style.display = 'flex';
    countBadge.textContent = uncommittedFiles.length;
    toggleSwitch.classList.toggle('checked', showUncommitted);
    toggleSwitch.textContent = showUncommitted ? '✓' : '';
  } else {
    toggleRow.style.display = 'none';
  }

  let allFiles = [...(sessionFiles || [])];
  if (showUncommitted && uncommittedFiles) {
    allFiles.push(...uncommittedFiles.map(f => ({ ...f, isUncommitted: true })));
  }

  let filteredFiles = allFiles;
  const searchActive = searchQuery && searchQuery.trim().length > 0;

  if (searchActive) {
    const query = searchQuery.toLowerCase();
    filteredFiles = allFiles.filter(file => {
      const pathMatch = file.path.toLowerCase().includes(query);
      if (pathMatch) {
        file.matchType = 'path';
        return true;
      }

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

  if (!node.children || node.children.length === 0) return '';

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
  document.querySelectorAll('.tree-folder').forEach(folder => {
    folder.onclick = (e) => {
      e.stopPropagation();
      const toggle = folder.querySelector('.tree-toggle');
      const children = folder.nextElementSibling;
      toggle.classList.toggle('collapsed');
      children.classList.toggle('collapsed');
    };
  });

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

  const sortedComments = [...comments].reverse();

  list.innerHTML = sortedComments.map(comment => {
    const lineDisplay = comment.endLine
      ? \`\${comment.line}-\${comment.endLine}\`
      : comment.line;
    const submittedClass = comment.isSubmitted ? 'submitted' : '';
    const icon = comment.isSubmitted ? '✓' : '📝';
    const statusLabel = comment.isSubmitted ? '<span class="comment-status">(submitted)</span>' : '';

    const timeStr = comment.timestamp
      ? new Date(comment.timestamp).toLocaleString()
      : '';

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

  diffToolbar.style.display = 'flex';

  header.textContent = diff.file;

  const isMarkdown = selectedFile && (
    selectedFile.endsWith('.md') ||
    selectedFile.endsWith('.markdown') ||
    selectedFile.endsWith('.mdx')
  );

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

  onFileChange();
}

// ===== Markdown Rendering =====
function highlightCode(code, lang) {
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
    py: ['print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple', 'bool', 'type', 'isinstance', 'hasattr', 'getattr', 'setattr', 'open', 'input', 'sorted', 'map', 'filter', 'zip', 'enumerate', 'sum', 'min', 'max', 'abs', 'round'],
    bash: ['mkdir', 'cd', 'ls', 'rm', 'cp', 'mv', 'cat', 'echo', 'grep', 'find', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'brew', 'npm', 'npx', 'pnpm', 'yarn', 'git', 'curl', 'wget', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'touch', 'head', 'tail', 'sed', 'awk', 'sort', 'uniq', 'wc', 'pwd', 'which', 'man', 'kill', 'ps', 'top', 'df', 'du', 'ln', 'source', 'alias', 'env', 'set', 'unset'],
    sh: ['mkdir', 'cd', 'ls', 'rm', 'cp', 'mv', 'cat', 'echo', 'grep', 'find', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'brew', 'npm', 'npx', 'pnpm', 'yarn', 'git', 'curl', 'wget', 'tar', 'zip', 'unzip', 'ssh', 'scp', 'touch', 'head', 'tail', 'sed', 'awk', 'sort', 'uniq', 'wc', 'pwd', 'which', 'man', 'kill', 'ps', 'top', 'df', 'du', 'ln', 'source', 'alias', 'env', 'set', 'unset']
  };

  const types = {
    ts: ['string', 'number', 'boolean', 'void', 'null', 'undefined', 'never', 'any', 'unknown', 'object', 'symbol', 'bigint'],
    typescript: ['string', 'number', 'boolean', 'void', 'null', 'undefined', 'never', 'any', 'unknown', 'object', 'symbol', 'bigint']
  };

  let escaped = escapeHtml(code);
  const langKeywords = keywords[lang] || keywords['js'] || [];
  const langBuiltins = builtins[lang] || [];
  const langTypes = types[lang] || [];

  const placeholders = [];
  const savePlaceholder = (html) => {
    const idx = placeholders.length;
    placeholders.push(html);
    return '___HLPH' + idx + '___';
  };

  escaped = escaped.replace(/(\\/{2}.*)$/gm, (m) => savePlaceholder('<span class="hljs-comment">' + m + '</span>'));
  if (['python', 'py', 'bash', 'sh', 'yaml', 'yml'].includes(lang)) {
    escaped = escaped.replace(/(#.*)$/gm, (m) => savePlaceholder('<span class="hljs-comment">' + m + '</span>'));
  }
  escaped = escaped.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g, (m) => savePlaceholder('<span class="hljs-comment">' + m + '</span>'));
  escaped = escaped.replace(/(&lt;!--[\\s\\S]*?--&gt;)/g, (m) => savePlaceholder('<span class="hljs-comment">' + m + '</span>'));

  escaped = escaped.replace(/("(?:[^"\\\\]|\\\\.)*")/g, (m) => savePlaceholder('<span class="hljs-string">' + m + '</span>'));
  escaped = escaped.replace(/('(?:[^'\\\\]|\\\\.)*')/g, (m) => savePlaceholder('<span class="hljs-string">' + m + '</span>'));
  escaped = escaped.replace(/(\`(?:[^\`\\\\]|\\\\.)*\`)/g, (m) => savePlaceholder('<span class="hljs-string">' + m + '</span>'));

  escaped = escaped.replace(/\\b(\\d+\\.?\\d*)\\b/g, (m) => savePlaceholder('<span class="hljs-number">' + m + '</span>'));

  for (const kw of langKeywords) {
    const regex = new RegExp('\\\\b(' + kw + ')\\\\b', 'g');
    escaped = escaped.replace(regex, (_, m) => savePlaceholder('<span class="hljs-keyword">' + m + '</span>'));
  }

  for (const bi of langBuiltins) {
    const regex = new RegExp('\\\\b(' + bi + ')\\\\b', 'g');
    escaped = escaped.replace(regex, (_, m) => savePlaceholder('<span class="hljs-builtin">' + m + '</span>'));
  }

  for (const tp of langTypes) {
    const regex = new RegExp('\\\\b(' + tp + ')\\\\b', 'g');
    escaped = escaped.replace(regex, (_, m) => savePlaceholder('<span class="hljs-type">' + m + '</span>'));
  }

  escaped = escaped.replace(/\\b([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(/g, (m, name) => savePlaceholder('<span class="hljs-function">' + name + '</span>') + '(');

  if (['ts', 'typescript'].includes(lang)) {
    escaped = escaped.replace(/([a-zA-Z_][a-zA-Z0-9_]*)(\\??\\s*):/g, (m, name, suffix) => savePlaceholder('<span class="hljs-property">' + name + '</span>') + suffix + ':');
  }

  if (['html', 'xml', 'jsx', 'tsx'].includes(lang)) {
    escaped = escaped.replace(/(&lt;\\/?)([a-zA-Z][a-zA-Z0-9]*)/g, (m, prefix, tag) => prefix + savePlaceholder('<span class="hljs-tag">' + tag + '</span>'));
    escaped = escaped.replace(/\\s([a-zA-Z-]+)=/g, (m, attr) => ' ' + savePlaceholder('<span class="hljs-attr">' + attr + '</span>') + '=');
  }

  placeholders.forEach((val, idx) => {
    escaped = escaped.replace('___HLPH' + idx + '___', val);
  });

  return escaped;
}

function renderTable(rows) {
  if (rows.length === 0) return '';

  const parseRow = (row) => {
    return row.slice(1, -1).split('|').map(cell => cell.trim());
  };

  const hasSeparator = rows.length > 1 && rows[1].match(/^\\|[\\s:|-]+\\|$/);
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

  tableHtml += '<thead><tr>';
  headerRow.forEach((cell, i) => {
    const align = alignments[i] ? ' style="text-align: ' + alignments[i] + '"' : '';
    tableHtml += '<th' + align + '>' + processInline(cell) + '</th>';
  });
  tableHtml += '</tr></thead>';

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
  const codeBlocks = [];
  let html = text.replace(/\\\`\\\`\\\`([\\w+-]*)[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*\\\`\\\`\\\`/g, (match, lang, code) => {
    const index = codeBlocks.length;
    const highlighted = highlightCode(code.trim(), lang);
    codeBlocks.push('<pre><code class="language-' + (lang || '') + '">' + highlighted + '</code></pre>');
    return '\\n{{CODE_BLOCK_' + index + '}}\\n';
  });

  const inlineCode = [];
  html = html.replace(/\\\`([^\\\`\\n]+)\\\`/g, (match, code) => {
    const index = inlineCode.length;
    inlineCode.push('<code>' + escapeHtml(code) + '</code>');
    return '{{INLINE_CODE_' + index + '}}';
  });

  const lines = html.split('\\n');
  const processedLines = [];
  let inTable = false;
  let tableRows = [];

  let listStack = [];

  const getIndentLevel = (line) => {
    const match = line.match(/^(\\s*)/);
    return match ? Math.floor(match[1].length / 2) : 0;
  };

  const closeListsToLevel = (targetLevel) => {
    while (listStack.length > targetLevel) {
      const closed = listStack.pop();
      processedLines.push(closed.type === 'ul' ? '</ul>' : '</ol>');
    }
  };

  const closeAllLists = () => {
    closeListsToLevel(0);
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (line.trim().match(/^\\{\\{CODE_BLOCK_\\d+\\}\\}$/)) {
      closeAllLists();
      if (inTable) {
        processedLines.push(renderTable(tableRows));
        tableRows = [];
        inTable = false;
      }
      processedLines.push(line.trim());
      continue;
    }

    if (line.trim().match(/^\\|.*\\|$/)) {
      closeAllLists();
      inTable = true;
      tableRows.push(line.trim());
      continue;
    } else if (inTable) {
      processedLines.push(renderTable(tableRows));
      tableRows = [];
      inTable = false;
    }

    if (line.trim().match(/^(-{3,}|\\*{3,}|_{3,})$/)) {
      closeAllLists();
      processedLines.push('<hr>');
      continue;
    }

    if (line.match(/^>\\s?/)) {
      closeAllLists();
      const content = line.replace(/^>\\s?/, '');
      processedLines.push('<blockquote><p>' + processInline(content) + '</p></blockquote>');
      continue;
    }

    if (line.match(/^#{1,6} /)) {
      closeAllLists();
      const level = line.match(/^(#+)/)[1].length;
      const content = line.replace(/^#+\\s*/, '');
      processedLines.push('<h' + level + '>' + escapeHtml(content) + '</h' + level + '>');
      continue;
    }

    const ulMatch = line.match(/^(\\s*)[-*+]\\s+(.*)$/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      const content = ulMatch[2];

      if (listStack.length > indent + 1) {
        closeListsToLevel(indent + 1);
      }

      if (listStack.length === 0 || listStack.length <= indent) {
        while (listStack.length <= indent) {
          processedLines.push('<ul>');
          listStack.push({ type: 'ul', indent: listStack.length });
        }
      } else if (listStack[indent] && listStack[indent].type !== 'ul') {
        closeListsToLevel(indent);
        processedLines.push('<ul>');
        listStack.push({ type: 'ul', indent: indent });
      }

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

    const olMatch = line.match(/^(\\s*)\\d+\\.\\s+(.*)$/);
    if (olMatch) {
      const indent = Math.floor(olMatch[1].length / 2);
      const content = olMatch[2];

      if (listStack.length > indent + 1) {
        closeListsToLevel(indent + 1);
      }

      if (listStack.length === 0 || listStack.length <= indent) {
        while (listStack.length <= indent) {
          processedLines.push('<ol>');
          listStack.push({ type: 'ol', indent: listStack.length });
        }
      } else if (listStack[indent] && listStack[indent].type !== 'ol') {
        closeListsToLevel(indent);
        processedLines.push('<ol>');
        listStack.push({ type: 'ol', indent: indent });
      }

      processedLines.push('<li>' + processInline(content) + '</li>');
      continue;
    }

    if (line.trim() === '') {
      closeAllLists();
      processedLines.push('');
      continue;
    }

    closeAllLists();
    processedLines.push(processInline(line));
  }

  closeAllLists();

  if (inTable && tableRows.length > 0) {
    processedLines.push(renderTable(tableRows));
  }

  html = processedLines.join('\\n');

  codeBlocks.forEach((block, i) => {
    html = html.replace('{{CODE_BLOCK_' + i + '}}', block);
  });
  inlineCode.forEach((code, i) => {
    html = html.replace('{{INLINE_CODE_' + i + '}}', code);
  });

  const blockTags = ['<h1', '<h2', '<h3', '<h4', '<h5', '<h6', '<ul', '<ol', '<li', '<pre', '<hr', '<blockquote', '</ul', '</ol', '</li', '</blockquote', '<table', '</table'];
  const finalLines = html.split('\\n');
  let result = '';
  let paragraphBuffer = [];
  let inPreBlock = false;

  for (const line of finalLines) {
    const trimmed = line.trim();

    if (trimmed.includes('<pre')) {
      inPreBlock = true;
    }

    if (inPreBlock) {
      if (paragraphBuffer.length > 0) {
        result += '<p>' + paragraphBuffer.join('<br>') + '</p>\\n';
        paragraphBuffer = [];
      }
      result += line + '\\n';
      if (line.includes('</pre>')) {
        inPreBlock = false;
      }
      continue;
    }

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
  const placeholders = [];
  let result = text.replace(/\\{\\{INLINE_CODE_(\\d+)\\}\\}/g, (match) => {
    const index = placeholders.length;
    placeholders.push(match);
    return '\\x00PLACEHOLDER' + index + '\\x00';
  });

  result = escapeHtml(result);

  result = result.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

  result = result.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

  result = result.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

  placeholders.forEach((placeholder, i) => {
    result = result.replace('\\x00PLACEHOLDER' + i + '\\x00', placeholder);
  });

  return result;
}

function renderMarkdownPreview(diff, container) {
  if (diff.newFileContent) {
    renderFullMarkdownWithHighlights(diff.newFileContent, diff.changedLineNumbers, container, diff.deletions);
    return;
  }

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

  const deletionMap = new Map();
  if (deletions) {
    for (const del of deletions) {
      deletionMap.set(del.afterLine, del.content);
    }
  }

  const groups = [];
  let currentGroup = null;
  let inCodeBlock = false;

  if (deletionMap.has(0)) {
    groups.push({ type: 'deletion', lines: deletionMap.get(0), startLine: 0 });
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const isChanged = changedSet.has(lineNum);
    const groupType = isChanged ? 'addition' : 'normal';

    const trimmedLine = line.trim();
    const isCodeFence = trimmedLine.startsWith(String.fromCharCode(96, 96, 96));
    if (isCodeFence) {
      inCodeBlock = !inCodeBlock;
    }

    const isBlankLine = line.trim() === '';
    const isHeader = line.match(/^#{1,6}\\s/);
    const shouldSplit = !inCodeBlock && currentGroup && currentGroup.type === groupType && (isBlankLine || isHeader);

    const effectiveTypeChange = !inCodeBlock && currentGroup && currentGroup.type !== groupType;

    if (!currentGroup || effectiveTypeChange || shouldSplit) {
      if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup);
      currentGroup = { type: groupType, lines: [], startLine: lineNum };
    }
    currentGroup.lines.push(line);

    if (deletionMap.has(lineNum) && !inCodeBlock) {
      if (currentGroup && currentGroup.lines.length > 0) groups.push(currentGroup);
      groups.push({ type: 'deletion', lines: deletionMap.get(lineNum), startLine: lineNum });
      currentGroup = null;
    }
  }
  if (currentGroup) groups.push(currentGroup);

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

  preview.onmousedown = null;
  preview.onmousemove = null;
  document.removeEventListener('mouseup', handlePreviewMouseUp);

  preview.onmousedown = handlePreviewMouseDown;
  preview.onmousemove = handlePreviewMouseMove;
  document.addEventListener('mouseup', handlePreviewMouseUp);
}

function handlePreviewMouseDown(e) {
  if (e.target.closest('.preview-comment-form')) return;
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;

  let block = e.target.closest('.diff-addition, .diff-normal');

  if (!block) {
    const deletionBlock = e.target.closest('.diff-deletion');
    if (deletionBlock) {
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

  const lastBlock = selectedBlocks[selectedBlocks.length - 1];
  showPreviewCommentForm(lastBlock, minLine, maxLine);
}

function updatePreviewSelection() {
  if (!previewDragStartBlock || !previewDragEndBlock) return;

  const preview = document.querySelector('.markdown-preview');
  if (!preview) return;

  const selectableBlocks = Array.from(preview.querySelectorAll('.diff-addition, .diff-normal'));

  const startIdx = selectableBlocks.indexOf(previewDragStartBlock);
  const endIdx = selectableBlocks.indexOf(previewDragEndBlock);

  if (startIdx === -1 || endIdx === -1) return;

  const minIdx = Math.min(startIdx, endIdx);
  const maxIdx = Math.max(startIdx, endIdx);

  selectableBlocks.forEach(b => b.classList.remove('preview-selected'));

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
    let scopeLabel = state.scopeLabel;
    if (!scopeLabel) {
      if (chunk.oldStart === 0) {
        scopeLabel = 'New file';
      } else {
        scopeLabel = \`Lines \${chunk.oldStart}-\${chunk.oldStart + chunk.lines.length}\`;
      }
    }

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
    if (row.classList.contains('deletion')) {
      const lineNum = row.dataset.line;
      if (!lineNum) return;
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

  const getRowType = (row) => {
    if (!row) return null;
    return row.classList.contains('addition') ? 'addition' :
           row.classList.contains('deletion') ? 'deletion' : 'context';
  };
  const startRowType = getRowType(selectionStartRow);
  const endRowType = getRowType(selectionEndRow);

  const selectBothTypes = startRowType && endRowType && startRowType !== endRowType;

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
`;
