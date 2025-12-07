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
let pendingScrollRestore = null;
let collapsedFolders = new Set();
let currentFile = null;  // Track current file for scroll position saving

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
  const message = event.data;
  if (message.type === 'render' && message.state) {
    renderState(message.state);
  } else if (message.type === 'scrollToLine') {
    scrollToLineInDiff(message.line, message.endLine, message.commentId);
  }
});

// Get the actual scrollable element (differs between diff table and preview mode)
function getScrollableElement() {
  const preview = document.querySelector('.markdown-preview');
  if (preview) return preview;
  return document.getElementById('diff-viewer');
}

async function renderState(state) {
  // Auto-fetch HN stories when panel is first shown and no file is selected
  if (!state.selectedFile && !state.diff && state.hnFeedStatus === 'idle') {
    vscode.postMessage({ type: 'refreshHNFeed' });
  }

  // Check if we're switching files
  const previousFile = currentFile;
  const newFile = state.selectedFile;
  const isFileSwitching = previousFile !== newFile && previousFile !== null && newFile !== null;

  // Save scroll position of current file before rendering new file
  if (isFileSwitching && previousFile) {
    const scrollEl = getScrollableElement();
    if (scrollEl && scrollEl.scrollTop > 0) {
      vscode.postMessage({ type: 'saveScrollPosition', file: previousFile, scrollTop: scrollEl.scrollTop });
    }
    // Save draft comment before switching files (if not already saved for same file)
    const existingForm = document.querySelector('.comment-form-row');
    if (existingForm) {
      const textarea = existingForm.querySelector('textarea');
      const text = textarea ? textarea.value : '';
      const startLine = existingForm.dataset.start;
      const endLine = existingForm.dataset.end;
      const formFile = existingForm.dataset.file;
      if (text && formFile) {
        vscode.postMessage({
          type: 'saveDraftComment',
          draft: { file: formFile, startLine: parseInt(startLine), endLine: parseInt(endLine), text }
        });
      }
    }
  }

  // Determine scroll position to restore
  let scrollToRestore = 0;
  if (pendingScrollRestore !== null) {
    // Explicit scroll restore (from comment operations)
    scrollToRestore = pendingScrollRestore;
    pendingScrollRestore = null;
  } else if (isFileSwitching && newFile && state.fileScrollPositions && state.fileScrollPositions[newFile]) {
    // Restore saved scroll position for new file
    scrollToRestore = state.fileScrollPositions[newFile];
  }

  // Update current file tracker
  currentFile = newFile;

  renderFileList(state.sessionFiles, state.uncommittedFiles, state.showUncommitted, state.selectedFile, state.isTreeView, state.searchQuery, state.diff || state.scopedDiff);
  renderComments(state.comments);
  renderAIStatus(state.aiStatus);

  // Render based on diffViewMode
  if (state.diffViewMode === 'scope' && state.scopedDiff) {
    await renderScopedDiff(state.scopedDiff, state.selectedFile, state.comments, !!state.diff);
  } else {
    await renderDiff(state.diff, state.selectedFile, state.diffViewMode, state.comments, !!state.scopedDiff, state.hnStories, state.hnFeedStatus, state.hnFeedError);
  }

  // Restore scroll position after render
  if (scrollToRestore > 0) {
    const restoreScroll = () => {
      const scrollEl = getScrollableElement();
      if (scrollEl) scrollEl.scrollTop = scrollToRestore;
    };
    setTimeout(restoreScroll, 0);
    setTimeout(restoreScroll, 50);
    setTimeout(restoreScroll, 100);
  }

  // Restore draft comment form if exists
  if (state.draftComment && state.draftComment.file === newFile) {
    restoreDraftCommentForm(state.draftComment);
  }
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
            isExpanded: !collapsedFolders.has(currentPath)
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
      const folderPath = folder.dataset.folder;

      toggle.classList.toggle('collapsed');
      children.classList.toggle('collapsed');

      // Update collapsed state
      if (children.classList.contains('collapsed')) {
        collapsedFolders.add(folderPath);
      } else {
        collapsedFolders.delete(folderPath);
      }
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

  // Build color map for all comments
  const commentColorMap = new Map();
  comments.forEach((comment, idx) => {
    commentColorMap.set(comment.id, idx % 6);
  });

  // Separate pending and submitted
  const pending = comments.filter(c => !c.isSubmitted);
  const submitted = comments.filter(c => c.isSubmitted);

  let html = '';

  // Pending comments with edit/delete (most recent first)
  const sortedPending = [...pending].reverse();
  sortedPending.forEach(comment => {
    const lineDisplay = comment.endLine
      ? \`\${comment.line}-\${comment.endLine}\`
      : comment.line;
    const colorIndex = commentColorMap.get(comment.id);

    html += \`
      <div class="comment-item color-\${colorIndex}" data-id="\${comment.id}">
        <div class="comment-header">
          <span class="comment-location" onclick="navigateToComment('\${comment.id}')" title="\${comment.file}:\${lineDisplay}">
            📝 \${comment.file}:\${lineDisplay}
          </span>
          <div class="comment-actions">
            <button class="btn-icon" onclick="startEditComment('\${comment.id}')" title="Edit">✎</button>
            <button class="btn-icon btn-danger" onclick="deleteComment('\${comment.id}')" title="Delete">🗑</button>
          </div>
        </div>
        <div class="comment-text" id="comment-text-\${comment.id}">\${escapeHtml(comment.text)}</div>
        <div class="comment-edit-form" id="comment-edit-\${comment.id}" style="display: none;">
          <textarea class="comment-textarea">\${escapeHtml(comment.text)}</textarea>
          <div class="comment-form-actions">
            <button class="btn-secondary" onclick="cancelEditComment('\${comment.id}')">Cancel</button>
            <button onclick="saveEditComment('\${comment.id}')">Save</button>
          </div>
        </div>
      </div>
    \`;
  });

  // Submitted history section (collapsed by default)
  if (submitted.length > 0) {
    html += \`
      <div class="submitted-section">
        <div class="submitted-header" onclick="toggleSubmittedHistory()">
          <span class="submitted-toggle" id="submitted-toggle">▶</span>
          <span>Submitted (\${submitted.length})</span>
        </div>
        <div class="submitted-list" id="submitted-list" style="display: none;">
    \`;
    const sortedSubmitted = [...submitted].reverse();
    sortedSubmitted.forEach(comment => {
      const lineDisplay = comment.endLine
        ? \`\${comment.line}-\${comment.endLine}\`
        : comment.line;
      html += \`
        <div class="comment-item submitted" data-id="\${comment.id}">
          <div class="comment-header">
            <span class="comment-location">✓ \${comment.file}:\${lineDisplay}</span>
            <span class="submitted-badge">submitted</span>
          </div>
          <div class="comment-text">\${escapeHtml(comment.text)}</div>
        </div>
      \`;
    });
    html += \`
        </div>
      </div>
    \`;
  }

  list.innerHTML = html;
}

// ===== Comment Edit/Delete Functions =====
function startEditComment(id) {
  document.getElementById('comment-text-' + id).style.display = 'none';
  document.getElementById('comment-edit-' + id).style.display = 'block';
  document.querySelector('#comment-edit-' + id + ' textarea').focus();
}

function cancelEditComment(id) {
  document.getElementById('comment-text-' + id).style.display = 'block';
  document.getElementById('comment-edit-' + id).style.display = 'none';
}

function saveEditComment(id) {
  const textarea = document.querySelector('#comment-edit-' + id + ' textarea');
  const text = textarea.value.trim();
  if (text) {
    saveScrollPosition();
    vscode.postMessage({ type: 'editComment', id, text });
  }
  cancelEditComment(id);
}

function deleteComment(id) {
  saveScrollPosition();
  vscode.postMessage({ type: 'deleteComment', id });
}

function saveScrollPosition() {
  const scrollEl = getScrollableElement();
  if (scrollEl) {
    pendingScrollRestore = scrollEl.scrollTop;
  }
}

function toggleSubmittedHistory() {
  const list = document.getElementById('submitted-list');
  const toggle = document.getElementById('submitted-toggle');
  if (list.style.display === 'none') {
    list.style.display = 'block';
    toggle.textContent = '▼';
  } else {
    list.style.display = 'none';
    toggle.textContent = '▶';
  }
}

function navigateToComment(id) {
  vscode.postMessage({ type: 'navigateToComment', id });
}

// ===== Inline Comment Toggle =====
function toggleInlineComment(elementOrLineNum) {
  // Get endLines to toggle (comment rows are rendered at endLine)
  let endLines = [];

  if (typeof elementOrLineNum === 'object' && elementOrLineNum.dataset) {
    // Called from gutter click - use data-end-lines
    const endLinesAttr = elementOrLineNum.dataset.endLines;
    if (endLinesAttr) {
      endLines = endLinesAttr.split(',').map(Number);
    }
  } else {
    // Called with lineNum directly (from header click)
    endLines = [elementOrLineNum];
  }

  // Toggle each endLine's comment row
  endLines.forEach(lineNum => {
    const commentRow = document.querySelector('.inline-comment-row[data-line="' + lineNum + '"]');
    if (!commentRow) return;

    if (commentRow.classList.contains('collapsed')) {
      commentRow.classList.remove('collapsed');
    } else {
      commentRow.classList.add('collapsed');
    }
  });
}


// ===== Inline Comment Edit =====
function startInlineEdit(commentId) {
  document.getElementById('inline-body-' + commentId).style.display = 'none';
  document.getElementById('inline-edit-' + commentId).style.display = 'block';
  document.querySelector('#inline-edit-' + commentId + ' textarea').focus();
}

function cancelInlineEdit(commentId) {
  document.getElementById('inline-body-' + commentId).style.display = 'block';
  document.getElementById('inline-edit-' + commentId).style.display = 'none';
}

function saveInlineEdit(commentId) {
  const textarea = document.querySelector('#inline-edit-' + commentId + ' textarea');
  const text = textarea.value.trim();
  if (text) {
    saveScrollPosition();
    vscode.postMessage({ type: 'editComment', id: commentId, text });
  }
  cancelInlineEdit(commentId);
}

function scrollToLineInDiff(startLine, endLine, commentId) {
  const actualEndLine = endLine || startLine;

  // Expand sidebar if collapsed
  if (bodyEl.classList.contains('sidebar-collapsed')) {
    expandSidebar();
  }

  // Find the diff viewer
  const diffContainer = document.getElementById('diff-viewer');
  if (!diffContainer) return;

  // Check if we're in preview mode
  const previewContainer = diffContainer.querySelector('.markdown-preview');
  if (previewContainer) {
    // Preview mode: find diff-block elements that contain the target lines
    const blocks = previewContainer.querySelectorAll('.diff-block[data-start-line]');
    const targetBlocks = [];

    blocks.forEach(block => {
      const blockStart = parseInt(block.dataset.startLine);
      const blockEnd = parseInt(block.dataset.endLine);
      // Check if this block overlaps with our target range
      if (blockStart <= actualEndLine && blockEnd >= startLine) {
        targetBlocks.push(block);
      }
    });

    if (targetBlocks.length > 0) {
      setTimeout(() => {
        targetBlocks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Highlight blocks in range
        targetBlocks.forEach(block => block.classList.add('highlight-target'));

        setTimeout(() => {
          targetBlocks.forEach(block => block.classList.remove('highlight-target'));
        }, 2000);
      }, 100);
    }

    // Also scroll to the comment box if it exists
    if (commentId) {
      setTimeout(() => {
        const commentBox = diffContainer.querySelector('.preview-comment-box[data-comment-id="' + commentId + '"]');
        if (commentBox) {
          commentBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
          commentBox.classList.add('highlight-target');
          setTimeout(() => commentBox.classList.remove('highlight-target'), 2000);
        }
      }, 200);
    }
    return;
  }

  // Diff table mode: find all rows in the range and expand collapsed chunks
  const chunkBodies = diffContainer.querySelectorAll('tbody.chunk-lines');
  const targetRows = [];

  chunkBodies.forEach((chunk, index) => {
    // Only select diff-line rows, not inline-comment-row
    const rows = chunk.querySelectorAll('tr.diff-line[data-line]');
    rows.forEach(row => {
      const lineNum = parseInt(row.dataset.line);
      if (lineNum >= startLine && lineNum <= actualEndLine && !row.classList.contains('deletion')) {
        // Expand chunk if collapsed
        if (chunk.classList.contains('collapsed')) {
          vscode.postMessage({ type: 'toggleChunkCollapse', index });
        }
        targetRows.push(row);
      }
    });
  });

  // If not found in chunks, try direct query
  if (targetRows.length === 0) {
    for (let line = startLine; line <= actualEndLine; line++) {
      const row = diffContainer.querySelector('tr.diff-line.addition[data-line="' + line + '"], tr.diff-line.context[data-line="' + line + '"]');
      if (row) targetRows.push(row);
    }
  }

  if (targetRows.length > 0) {
    // Small delay to allow chunk expansion animation
    setTimeout(() => {
      // Scroll to first row
      targetRows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight all rows in range
      targetRows.forEach(row => row.classList.add('highlight-target'));

      // Remove highlight after animation
      setTimeout(() => {
        targetRows.forEach(row => row.classList.remove('highlight-target'));
      }, 2000);

      // Expand the comment if collapsed (comment row is at endLine)
      const commentRow = diffContainer.querySelector('.inline-comment-row[data-line="' + actualEndLine + '"]');
      if (commentRow && commentRow.classList.contains('collapsed')) {
        commentRow.classList.remove('collapsed');
      }
    }, 100);
  }
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

// ===== Scoped Diff Rendering =====
const SCOPE_ICONS = {
  class: '📄',
  method: '🔧',
  function: '📌',
  constructor: '🏗️',
  interface: '📐',
  enum: '📊',
  module: '📦',
  namespace: '🗂️'
};

let scopedDiffCurrentFile = null;
let scopedDiffHighlightMap = new Map();

async function renderScopedDiff(scopedDiff, selectedFile, comments = [], hasDiff = false) {
  const header = document.querySelector('.diff-header-title');
  const stats = document.getElementById('diff-stats');
  const viewer = document.getElementById('diff-viewer');

  scopedDiffCurrentFile = selectedFile;
  scopedDiffHighlightMap = new Map();

  if (!scopedDiff) {
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

  header.textContent = scopedDiff.file;
  header.style.cursor = 'pointer';
  header.onclick = () => {
    vscode.postMessage({ type: 'openFile', file: scopedDiff.file });
  };

  const toggleHtml = hasDiff
    ? '<div class="view-mode-toggle"><button class="toggle-btn" onclick="toggleDiffViewMode()">Diff</button></div>'
    : '';
  stats.innerHTML = \`
    <span class="stat-added">+\${scopedDiff.stats.additions}</span>
    <span class="stat-removed">-\${scopedDiff.stats.deletions}</span>
    \${toggleHtml}
  \`;

  if (!scopedDiff.hasScopeData) {
    viewer.innerHTML = \`
      <div class="scope-fallback-message">
        Scope view unavailable for this file type. Showing diff view.
      </div>
    \`;
    return;
  }

  // Collect all line contents for batch syntax highlighting
  const allLines = [];
  collectScopeLines(scopedDiff.scopes, allLines);
  if (scopedDiff.orphanLines) {
    for (const line of scopedDiff.orphanLines) {
      allLines.push({ lineNumber: line.lineNumber, content: line.content });
    }
  }

  // Batch highlight all lines
  const language = window.SidecarHighlighter
    ? window.SidecarHighlighter.getLanguageFromPath(scopedDiff.file)
    : 'plaintext';

  let highlightedContents = allLines.map(l => escapeHtml(l.content));
  if (window.SidecarHighlighter && language !== 'plaintext') {
    try {
      highlightedContents = await window.SidecarHighlighter.highlightLines(
        allLines.map(l => l.content),
        language
      );
    } catch (e) {
      console.warn('Syntax highlighting failed:', e);
    }
  }

  // Build map of lineNumber -> highlightedContent
  for (let i = 0; i < allLines.length; i++) {
    scopedDiffHighlightMap.set(allLines[i].lineNumber, highlightedContents[i]);
  }

  let html = '';

  // Scope controls
  html += \`
    <div class="scope-controls">
      <button class="scope-control-btn" data-action="expand-all">
        Expand All
      </button>
      <button class="scope-control-btn" data-action="collapse-all">
        Collapse All
      </button>
    </div>
  \`;

  // Get filename from path
  const fileName = scopedDiff.file.split('/').pop() || scopedDiff.file;

  // Scope tree with root file scope
  html += '<div class="scope-tree">';

  // Root file scope that contains everything
  const fileHasChanges = scopedDiff.stats.additions > 0 || scopedDiff.stats.deletions > 0;
  const fileStatsHtml = fileHasChanges
    ? '<span class="added">+' + scopedDiff.stats.additions + '</span> <span class="removed">-' + scopedDiff.stats.deletions + '</span>'
    : '<span class="no-changes">unchanged</span>';

  html += \`
    <div class="scope-node file-root" data-scope-id="file-root">
      <div class="scope-header \${fileHasChanges ? 'has-changes' : ''}">
        <span class="scope-toggle">▼</span>
        <span class="scope-icon">📄</span>
        <span class="scope-name">\${escapeHtml(fileName)}</span>
        <span class="scope-kind">file</span>
        <span class="scope-stats">\${fileStatsHtml}</span>
      </div>
      <div class="scope-content">
  \`;

  // Build a virtual root scope that interleaves orphan lines and scopes
  const orphanLines = scopedDiff.orphanLines || [];
  const scopes = scopedDiff.scopes || [];

  if (scopes.length === 0) {
    // No scopes - just render orphan lines
    if (orphanLines.length > 0) {
      html += \`<div class="scope-lines">\${renderScopeDiffLines(orphanLines, comments)}</div>\`;
    }
  } else {
    // Sort scopes by start line
    const sortedScopes = [...scopes].sort((a, b) => {
      const aLine = parseInt(a.scopeId.split('-').pop()) || 0;
      const bLine = parseInt(b.scopeId.split('-').pop()) || 0;
      return aLine - bLine;
    });

    let currentLineIdx = 0;

    for (const scope of sortedScopes) {
      const scopeStartLine = parseInt(scope.scopeId.split('-').pop()) || 0;

      // Collect orphan lines before this scope
      const linesBeforeScope = [];
      while (currentLineIdx < orphanLines.length && orphanLines[currentLineIdx].lineNumber < scopeStartLine) {
        linesBeforeScope.push(orphanLines[currentLineIdx]);
        currentLineIdx++;
      }

      // Render lines before scope
      if (linesBeforeScope.length > 0) {
        html += \`<div class="scope-lines">\${renderScopeDiffLines(linesBeforeScope, comments)}</div>\`;
      }

      // Render the scope
      html += renderScopeNode(scope, comments);
    }

    // Render remaining orphan lines after last scope
    const remainingLines = orphanLines.slice(currentLineIdx);
    if (remainingLines.length > 0) {
      html += \`<div class="scope-lines">\${renderScopeDiffLines(remainingLines, comments)}</div>\`;
    }
  }

  html += '</div></div>'; // Close file root scope
  html += '</div>'; // Close scope-tree
  viewer.innerHTML = html;

  setupScopeHandlers();
  setupScopeLineHandlers(scopedDiff.file);
}

function collectScopeLines(scopes, result) {
  for (const scope of scopes) {
    if (scope.lines) {
      for (const line of scope.lines) {
        result.push({ lineNumber: line.lineNumber, content: line.content });
      }
    }
    if (scope.children) {
      collectScopeLines(scope.children, result);
    }
  }
}

function renderScopeNode(scope, comments) {
  const collapseClass = scope.isCollapsed ? 'collapsed' : '';
  const changesClass = scope.hasChanges ? 'has-changes' : '';
  const collapsedChangedClass = (scope.hasChanges && scope.isCollapsed) ? 'collapsed-with-changes' : '';
  const icon = SCOPE_ICONS[scope.scopeKind] || '○';

  const statsHtml = scope.hasChanges
    ? '<span class="added">+' + scope.stats.additions + '</span> <span class="removed">-' + scope.stats.deletions + '</span>'
    : '<span class="no-changes">unchanged</span>';

  let html = \`
    <div class="scope-node"
         data-scope-id="\${escapeHtml(scope.scopeId)}"
         data-depth="\${scope.depth}">
      <div class="scope-header \${changesClass} \${collapsedChangedClass}">
        <span class="scope-toggle \${collapseClass}">▼</span>
        <span class="scope-icon \${scope.scopeKind}">\${icon}</span>
        <span class="scope-name">\${escapeHtml(scope.scopeName)}</span>
        <span class="scope-kind">\${scope.scopeKind}</span>
        <span class="scope-stats">\${statsHtml}</span>
      </div>
      <div class="scope-content \${collapseClass}">
  \`;

  // Interleave lines and children by line number
  const lines = scope.lines || [];
  const children = scope.children || [];

  if (children.length === 0) {
    // No children - just render all lines
    if (lines.length > 0) {
      html += \`<div class="scope-lines">\${renderScopeDiffLines(lines, comments)}</div>\`;
    }
  } else {
    // Sort children by their first line number (approximated by scopeId which contains startLine)
    const sortedChildren = [...children].sort((a, b) => {
      const aLine = parseInt(a.scopeId.split('-').pop()) || 0;
      const bLine = parseInt(b.scopeId.split('-').pop()) || 0;
      return aLine - bLine;
    });

    // Build line groups: lines before each child, then lines after last child
    let currentLineIdx = 0;

    for (const child of sortedChildren) {
      const childStartLine = parseInt(child.scopeId.split('-').pop()) || 0;

      // Collect lines before this child
      const linesBeforeChild = [];
      while (currentLineIdx < lines.length && lines[currentLineIdx].lineNumber < childStartLine) {
        linesBeforeChild.push(lines[currentLineIdx]);
        currentLineIdx++;
      }

      // Render lines before child
      if (linesBeforeChild.length > 0) {
        html += \`<div class="scope-lines">\${renderScopeDiffLines(linesBeforeChild, comments)}</div>\`;
      }

      // Render the child scope
      html += renderScopeNode(child, comments);
    }

    // Render remaining lines after last child
    const remainingLines = lines.slice(currentLineIdx);
    if (remainingLines.length > 0) {
      html += \`<div class="scope-lines">\${renderScopeDiffLines(remainingLines, comments)}</div>\`;
    }
  }

  html += '</div></div>';
  return html;
}

function renderScopeDiffLines(lines, comments) {
  // Build comment lookup
  const commentColorMap = new Map();
  comments.forEach((comment, idx) => {
    commentColorMap.set(comment.id, idx % 6);
  });

  const commentsByLine = new Map();
  comments.forEach(comment => {
    const startLine = comment.line;
    const endLine = comment.endLine || comment.line;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (!commentsByLine.has(lineNum)) {
        commentsByLine.set(lineNum, []);
      }
      commentsByLine.get(lineNum).push({ ...comment, colorIndex: commentColorMap.get(comment.id) });
    }
  });

  let html = '<table class="diff-table"><colgroup><col class="col-gutter"><col class="col-line-num"><col class="col-content"></colgroup>';

  for (const line of lines) {
    const lineClass = line.type;
    const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
    // ScopeLine uses lineNumber directly
    const lineNum = line.lineNumber;
    const isDeletion = line.type === 'deletion';

    // Check for comments
    const hasComments = !isDeletion && commentsByLine.has(lineNum);
    const lineComments = hasComments ? commentsByLine.get(lineNum) : [];
    const primaryComments = lineComments.filter(c => (c.endLine || c.line) === lineNum);

    // Build range indicators
    let rangeIndicators = '';
    if (hasComments) {
      lineComments.forEach((c) => {
        const isStart = c.line === lineNum;
        const isEnd = (c.endLine || c.line) === lineNum;
        const isSingle = isStart && isEnd;
        let posClass = isSingle ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'middle';
        const dotMarker = isEnd ? '<span class="end-dot color-' + c.colorIndex + '">●</span>' : '';
        rangeIndicators += '<span class="range-line range-' + posClass + ' color-' + c.colorIndex + '" style="left: ' + (4 + c.colorIndex * 3) + 'px">' + dotMarker + '</span>';
      });
    }

    const markerClass = hasComments ? 'has-comment' : '';
    const gutterAttrs = primaryComments.length > 0 ? ' data-end-lines="' + lineNum + '" onclick="toggleInlineComment(this)"' : '';

    // Use pre-computed highlighted content if available
    const highlightedContent = scopedDiffHighlightMap.get(lineNum) || escapeHtml(line.content);

    html += \`
      <tr class="diff-line \${lineClass}" data-line="\${lineNum}">
        <td class="diff-gutter \${markerClass}"\${gutterAttrs}>
          \${rangeIndicators}
        </td>
        <td class="diff-line-num">\${lineNum}</td>
        <td class="diff-line-content shiki" data-prefix="\${prefix}">\${highlightedContent}</td>
      </tr>
    \`;

    // Add inline comment row
    if (primaryComments.length > 0) {
      html += \`
        <tr class="inline-comment-row" data-line="\${lineNum}">
          <td colspan="3">
            <div class="inline-comments">
              \${primaryComments.map(c => {
                const isPending = !c.isSubmitted;
                const statusClass = isPending ? 'pending' : 'submitted';
                return \`
                  <div class="inline-comment-box \${statusClass} color-\${c.colorIndex}" data-comment-id="\${c.id}">
                    <div class="inline-comment-header" onclick="toggleInlineComment(\${lineNum})" style="cursor: pointer;">
                      <span class="comment-author">Comment</span>
                      \${isPending ? \`
                        <div class="inline-comment-actions" onclick="event.stopPropagation()">
                          <button class="btn-icon" onclick="startInlineEdit('\${c.id}')" title="Edit">✎</button>
                          <button class="btn-icon btn-danger" onclick="deleteComment('\${c.id}')" title="Delete">🗑</button>
                        </div>
                      \` : \`
                        <span class="submitted-label">submitted</span>
                      \`}
                    </div>
                    <div class="inline-comment-body" id="inline-body-\${c.id}">
                      \${escapeHtml(c.text)}
                    </div>
                    <div class="inline-comment-edit" id="inline-edit-\${c.id}" style="display: none;">
                      <textarea class="comment-textarea">\${escapeHtml(c.text)}</textarea>
                      <div class="comment-form-actions">
                        <button class="btn-secondary" onclick="cancelInlineEdit('\${c.id}')">Cancel</button>
                        <button onclick="saveInlineEdit('\${c.id}')">Save</button>
                      </div>
                    </div>
                  </div>
                \`;
              }).join('')}
            </div>
          </td>
        </tr>
      \`;
    }
  }

  html += '</table>';
  return html;
}

function setupScopeHandlers() {
  // Scope header click handler
  document.querySelectorAll('.scope-header').forEach(header => {
    header.addEventListener('click', (e) => {
      e.stopPropagation();

      const node = header.closest('.scope-node');
      const scopeId = node?.dataset.scopeId;

      if (scopeId) {
        vscode.postMessage({
          type: 'toggleScopeCollapse',
          scopeId
        });
      }
    });
  });

  // Expand/Collapse all buttons
  document.querySelectorAll('.scope-control-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.action;

      if (action === 'expand-all') {
        vscode.postMessage({ type: 'expandAllScopes' });
      } else if (action === 'collapse-all') {
        vscode.postMessage({ type: 'collapseAllScopes' });
      }
    });
  });
}

function setupScopeLineHandlers(currentFile) {
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
    if (row.classList.contains('deletion')) return;
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

function scrollToLineInScopedDiff(line) {
  // Request scope expansion first
  vscode.postMessage({
    type: 'expandScopeForLine',
    line
  });

  // Then scroll after a short delay for DOM update
  setTimeout(() => {
    const lineEl = document.querySelector('.diff-line[data-line="' + line + '"]');
    if (lineEl) {
      lineEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      lineEl.classList.add('highlight-target');
      setTimeout(() => lineEl.classList.remove('highlight-target'), 2000);
    }
  }, 150);
}

// ===== Diff Rendering =====
async function renderDiff(diff, selectedFile, viewMode, comments = [], hasScopedDiff = false, hnStories = [], hnFeedStatus = 'idle', hnFeedError = null) {
  const header = document.querySelector('.diff-header-title');
  const stats = document.getElementById('diff-stats');
  const viewer = document.getElementById('diff-viewer');

  if (!diff || !diff.chunks || diff.chunks.length === 0) {
    // Show HN feed when no file is selected
    if (!selectedFile && !diff) {
      header.textContent = 'Hacker News';
      stats.innerHTML = '';
      diffToolbar.style.display = 'none';
      viewer.innerHTML = renderHNFeed(hnStories, hnFeedStatus, hnFeedError);
      return;
    }

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
  header.style.cursor = 'pointer';
  header.onclick = () => {
    vscode.postMessage({ type: 'openFile', file: diff.file });
  };

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
      // Filter comments for current file
      const fileComments = (comments || []).filter(c => c.file === diff.file);
      await renderMarkdownPreview(diff, viewer, fileComments);
      setupPreviewCommentHandlers(diff.file);
      // Trigger search highlighting for markdown preview
      onFileChange();
      return;
    }
  } else {
    // Non-markdown files: show Scope toggle if scopedDiff is available
    const toggleHtml = hasScopedDiff
      ? '<div class="view-mode-toggle"><button class="toggle-btn" onclick="toggleDiffViewMode()">Scope</button></div>'
      : '';
    stats.innerHTML = \`
      <span class="stat-added">+\${diff.stats.additions}</span>
      <span class="stat-removed">-\${diff.stats.deletions}</span>
      \${toggleHtml}
    \`;
  }

  const chunkStates = diff.chunkStates || [];
  const allCollapsed = chunkStates.length > 0 && chunkStates.every(s => s.isCollapsed);
  diffCollapseAll.textContent = allCollapsed ? 'Expand' : 'Collapse';

  // Filter comments for current file
  const fileComments = (comments || []).filter(c => c.file === diff.file);

  // Get language from file path for syntax highlighting
  const language = window.SidecarHighlighter
    ? window.SidecarHighlighter.getLanguageFromPath(diff.file)
    : 'plaintext';

  let html = \`
    <table class="diff-table">
      <colgroup>
        <col class="col-gutter">
        <col class="col-line-num">
        <col class="col-content">
      </colgroup>
  \`;
  html += await renderChunksToHtml(diff.chunks, chunkStates, fileComments, language);
  html += '</table>';

  viewer.innerHTML = html;
  setupLineHoverHandlers(diff.file);
  setupChunkToggleHandlers();

  onFileChange();
}

// ===== Markdown Rendering =====

/**
 * Highlight code using Shiki (async) or fallback to plain escaped text
 */
async function highlightCodeAsync(code, lang) {
  if (window.SidecarHighlighter && lang) {
    try {
      return await window.SidecarHighlighter.highlightCodeBlock(code, lang);
    } catch (e) {
      console.warn('Code highlighting failed:', e);
    }
  }
  return escapeHtml(code);
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

async function renderMarkdown(text) {
  // Extract code blocks for async highlighting
  const codeBlockData = [];
  let html = text.replace(/\\\`\\\`\\\`([\\w+-]*)[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*\\\`\\\`\\\`/g, (match, lang, code) => {
    const index = codeBlockData.length;
    codeBlockData.push({ lang, code: code.trim() });
    return '\\n{{CODE_BLOCK_' + index + '}}\\n';
  });

  // Highlight all code blocks in parallel
  const highlightedBlocks = await Promise.all(
    codeBlockData.map(async ({ lang, code }) => {
      const highlighted = await highlightCodeAsync(code, lang);
      return '<pre><code class="language-' + (lang || '') + ' shiki">' + highlighted + '</code></pre>';
    })
  );

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
      // Look ahead to check if next non-empty line is a list item
      let nextNonEmptyLine = null;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          nextNonEmptyLine = lines[j];
          break;
        }
      }

      // Check if next line is a list item at root level (indent 0)
      const isNextRootListItem = nextNonEmptyLine && (
        nextNonEmptyLine.match(/^\\d+\\.\\s+/) || // ordered list at root
        nextNonEmptyLine.match(/^[-*+]\\s+/)      // unordered list at root
      );

      if (isNextRootListItem && listStack.length > 0) {
        // Close nested lists but keep root list open
        closeListsToLevel(1);
      } else {
        closeAllLists();
      }
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

  highlightedBlocks.forEach((block, i) => {
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

async function renderMarkdownPreview(diff, container, comments = []) {
  if (diff.newFileContent) {
    await renderFullMarkdownWithHighlights(diff.newFileContent, diff.changedLineNumbers, container, diff.deletions, comments);
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
    const rendered = await renderMarkdown(content);
    if (group.isAddition) {
      html += '<div class="diff-addition">' + rendered + '</div>';
    } else {
      html += rendered;
    }
  }
  html += '</div>';
  container.innerHTML = html;
}

async function renderFullMarkdownWithHighlights(content, changedLineNumbers, container, deletions, comments = []) {
  const lines = content.split('\\n');
  const totalLines = lines.length;
  const changedSet = new Set(changedLineNumbers || []);

  const deletionMap = new Map();
  if (deletions) {
    for (const del of deletions) {
      deletionMap.set(del.afterLine, del.content);
    }
  }

  // Build comment lookup by line number
  const commentColorMap = new Map();
  comments.forEach((comment, idx) => {
    commentColorMap.set(comment.id, idx % 6);
  });

  const commentsByLine = new Map();
  comments.forEach(comment => {
    const startLine = comment.line;
    const endLine = comment.endLine || comment.line;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (!commentsByLine.has(lineNum)) {
        commentsByLine.set(lineNum, []);
      }
      commentsByLine.get(lineNum).push({ ...comment, colorIndex: commentColorMap.get(comment.id) });
    }
  });

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
    const rendered = await renderMarkdown(groupContent);
    const endLine = group.startLine + group.lines.length - 1;

    // Collect all unique comment color indices for this block
    const blockCommentColors = new Set();
    for (let lineNum = group.startLine; lineNum <= endLine; lineNum++) {
      if (commentsByLine.has(lineNum)) {
        const lineComments = commentsByLine.get(lineNum);
        lineComments.forEach(c => blockCommentColors.add(c.colorIndex));
      }
    }

    // Check if this group has any comments that END on its last line
    const groupComments = commentsByLine.has(endLine)
      ? commentsByLine.get(endLine).filter(c => (c.endLine || c.line) === endLine)
      : [];

    const hasComment = blockCommentColors.size > 0;
    const commentClass = hasComment ? ' has-comment' : '';

    // Build gutter indicator bars for each comment on this block
    let gutterHtml = '';
    if (hasComment) {
      gutterHtml = '<div class="comment-gutter-indicators">';
      Array.from(blockCommentColors).forEach(colorIdx => {
        gutterHtml += '<div class="comment-gutter-bar color-' + colorIdx + '"></div>';
      });
      gutterHtml += '</div>';
    }

    let blockHtml = '';
    if (group.type === 'addition') {
      blockHtml = '<div class="diff-block diff-addition' + commentClass + '" data-start-line="' + group.startLine + '" data-end-line="' + endLine + '">' + gutterHtml + rendered + '</div>';
    } else if (group.type === 'deletion') {
      blockHtml = '<div class="diff-block diff-deletion" data-after-line="' + group.startLine + '">' + rendered + '</div>';
    } else {
      blockHtml = '<div class="diff-block diff-normal' + commentClass + '" data-start-line="' + group.startLine + '" data-end-line="' + endLine + '">' + gutterHtml + rendered + '</div>';
    }

    markdownHtml += blockHtml;

    // Add inline comments after the block if this group ends with comments
    if (groupComments.length > 0 && group.type !== 'deletion') {
      markdownHtml += '<div class="preview-inline-comments" data-line="' + endLine + '">';
      groupComments.forEach(c => {
        const isPending = !c.isSubmitted;
        const statusClass = isPending ? 'pending' : 'submitted';
        const lineDisplay = c.line === (c.endLine || c.line)
          ? 'Line ' + c.line
          : 'Lines ' + c.line + '-' + (c.endLine || c.line);
        markdownHtml += \`
          <div class="preview-comment-box \${statusClass} color-\${c.colorIndex}" data-comment-id="\${c.id}">
            <div class="preview-comment-header">
              <span class="comment-location">\${lineDisplay}</span>
              \${isPending ? \`
                <div class="inline-comment-actions">
                  <button class="btn-icon" onclick="startPreviewCommentEdit('\${c.id}')" title="Edit">✎</button>
                  <button class="btn-icon btn-danger" onclick="deleteComment('\${c.id}')" title="Delete">🗑</button>
                </div>
              \` : \`
                <span class="submitted-label">submitted</span>
              \`}
            </div>
            <div class="preview-comment-body" id="preview-body-\${c.id}">\${escapeHtml(c.text)}</div>
            <div class="preview-comment-edit" id="preview-edit-\${c.id}" style="display: none;">
              <textarea class="comment-textarea">\${escapeHtml(c.text)}</textarea>
              <div class="comment-form-actions">
                <button class="btn-secondary" onclick="cancelPreviewCommentEdit('\${c.id}')">Cancel</button>
                <button onclick="savePreviewCommentEdit('\${c.id}')">Save</button>
              </div>
            </div>
          </div>
        \`;
      });
      markdownHtml += '</div>';
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

  // Add comment markers to overview ruler
  comments.forEach(c => {
    const endLine = c.endLine || c.line;
    const topPercent = ((endLine - 1) / totalLines) * 100;
    markersHtml += '<div class="overview-marker comment" style="top: ' + topPercent.toFixed(2) + '%;"></div>';
  });

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

  // Only allow comments on addition or normal blocks, not deletions
  const block = e.target.closest('.diff-addition, .diff-normal');
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

  saveScrollPosition();

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
  expandSidebar();
};

// ===== Preview Comment Edit Functions =====
window.startPreviewCommentEdit = function(commentId) {
  document.getElementById('preview-body-' + commentId).style.display = 'none';
  document.getElementById('preview-edit-' + commentId).style.display = 'block';
  document.querySelector('#preview-edit-' + commentId + ' textarea').focus();
};

window.cancelPreviewCommentEdit = function(commentId) {
  document.getElementById('preview-body-' + commentId).style.display = 'block';
  document.getElementById('preview-edit-' + commentId).style.display = 'none';
};

window.savePreviewCommentEdit = function(commentId) {
  const textarea = document.querySelector('#preview-edit-' + commentId + ' textarea');
  const text = textarea.value.trim();
  if (text) {
    saveScrollPosition();
    vscode.postMessage({ type: 'editComment', id: commentId, text });
  }
  cancelPreviewCommentEdit(commentId);
};

async function renderChunksToHtml(chunks, chunkStates, comments = [], language = 'plaintext') {
  // Assign color index to each comment (for visual distinction)
  const commentColorMap = new Map();
  comments.forEach((comment, idx) => {
    commentColorMap.set(comment.id, idx % 6); // 6 colors in palette
  });

  // Build comment lookup by line number (for multi-line comments, add to all lines in range)
  const commentsByLine = new Map();
  comments.forEach(comment => {
    const startLine = comment.line;
    const endLine = comment.endLine || comment.line;
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      if (!commentsByLine.has(lineNum)) {
        commentsByLine.set(lineNum, []);
      }
      commentsByLine.get(lineNum).push({ ...comment, colorIndex: commentColorMap.get(comment.id) });
    }
  });

  // Collect all line contents for batch highlighting
  const allLineContents = [];
  for (const chunk of chunks) {
    for (const line of chunk.lines) {
      allLineContents.push(line.content);
    }
  }

  // Highlight all lines at once (async)
  let highlightedContents = allLineContents.map(escapeHtml); // Default to escaped
  if (window.SidecarHighlighter && language !== 'plaintext') {
    try {
      highlightedContents = await window.SidecarHighlighter.highlightLines(allLineContents, language);
    } catch (e) {
      console.warn('Syntax highlighting failed:', e);
    }
  }

  let html = '';
  let lineIndex = 0;

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
        <td colspan="3" class="chunk-header">
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
      const isDeletion = line.type === 'deletion';

      // Get highlighted content for this line
      const highlightedContent = highlightedContents[lineIndex++] || escapeHtml(line.content);

      // Check if this line has comments (only show on non-deletion lines)
      const hasComments = !isDeletion && commentsByLine.has(lineNum);
      const lineComments = hasComments ? commentsByLine.get(lineNum) : [];
      // Only render inline comment row for comments that END on this line
      const primaryComments = lineComments.filter(c => (c.endLine || c.line) === lineNum);

      // Build range indicators for each comment (with colors)
      let rangeIndicators = '';
      if (hasComments) {
        lineComments.forEach((c) => {
          const isStart = c.line === lineNum;
          const isEnd = (c.endLine || c.line) === lineNum;
          const isSingle = isStart && isEnd;
          let posClass = isSingle ? 'single' : isStart ? 'start' : isEnd ? 'end' : 'middle';
          // Add dot marker for end lines
          const dotMarker = isEnd ? '<span class="end-dot color-' + c.colorIndex + '">●</span>' : '';
          rangeIndicators += '<span class="range-line range-' + posClass + ' color-' + c.colorIndex + '" style="left: ' + (4 + c.colorIndex * 3) + 'px">' + dotMarker + '</span>';
        });
      }

      const markerClass = hasComments ? 'has-comment' : '';

      // Click only toggles comments that END on this line (avoids overlapping comment confusion)
      const gutterAttrs = primaryComments.length > 0 ? ' data-end-lines="' + lineNum + '" onclick="toggleInlineComment(this)"' : '';

      html += \`
        <tr class="diff-line \${lineClass}" data-line="\${lineNum}">
          <td class="diff-gutter \${markerClass}"\${gutterAttrs}>
            \${rangeIndicators}
          </td>
          <td class="diff-line-num">\${lineNum}</td>
          <td class="diff-line-content shiki" data-prefix="\${prefix}">\${highlightedContent}</td>
        </tr>
      \`;

      // Add inline comment row only for comments that START on this line
      if (primaryComments.length > 0) {
        html += \`
          <tr class="inline-comment-row" data-line="\${lineNum}">
            <td colspan="3">
              <div class="inline-comments">
                \${primaryComments.map(c => {
                  const isPending = !c.isSubmitted;
                  const statusClass = isPending ? 'pending' : 'submitted';
                  return \`
                    <div class="inline-comment-box \${statusClass} color-\${c.colorIndex}" data-comment-id="\${c.id}">
                      <div class="inline-comment-header" onclick="toggleInlineComment(\${lineNum})" style="cursor: pointer;">
                        <span class="comment-author">Comment</span>
                        \${isPending ? \`
                          <div class="inline-comment-actions" onclick="event.stopPropagation()">
                            <button class="btn-icon" onclick="startInlineEdit('\${c.id}')" title="Edit">✎</button>
                            <button class="btn-icon btn-danger" onclick="deleteComment('\${c.id}')" title="Delete">🗑</button>
                          </div>
                        \` : \`
                          <span class="submitted-label">submitted</span>
                        \`}
                      </div>
                      <div class="inline-comment-body" id="inline-body-\${c.id}">
                        \${escapeHtml(c.text)}
                      </div>
                      <div class="inline-comment-edit" id="inline-edit-\${c.id}" style="display: none;">
                        <textarea class="comment-textarea">\${escapeHtml(c.text)}</textarea>
                        <div class="comment-form-actions">
                          <button class="btn-secondary" onclick="cancelInlineEdit('\${c.id}')">Cancel</button>
                          <button onclick="saveInlineEdit('\${c.id}')">Save</button>
                        </div>
                      </div>
                    </div>
                  \`;
                }).join('')}
              </div>
            </td>
          </tr>
        \`;
      }
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
    // Don't allow comments on deletion lines
    if (row.classList.contains('deletion')) return;
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

function showInlineCommentForm(currentFile, startLine, endLine, existingText = '') {
  const existingForm = document.querySelector('.comment-form-row');
  // Save current draft before removing existing form (to persist across line changes)
  if (existingForm) {
    const existingTextarea = existingForm.querySelector('textarea');
    const text = existingTextarea ? existingTextarea.value : '';
    if (text && !existingText) {
      // Preserve existing text when switching lines
      existingText = text;
    }
    existingForm.remove();
  }
  if (!selectedLineElement) return;

  const isSingleLine = !endLine || startLine === endLine;
  const lineDisplay = isSingleLine
    ? \`line \${startLine || selectedLineNum}\`
    : \`lines \${startLine}-\${endLine}\`;

  const actualStartLine = startLine || selectedLineNum;
  const actualEndLine = endLine || startLine || selectedLineNum;

  const formRow = document.createElement('tr');
  formRow.className = 'comment-form-row';
  formRow.dataset.file = currentFile;
  formRow.dataset.start = actualStartLine;
  formRow.dataset.end = actualEndLine;
  formRow.innerHTML = \`
    <td colspan="3">
      <div class="inline-comment-form active">
        <div class="comment-form-header">Comment on \${lineDisplay}</div>
        <textarea class="comment-textarea" placeholder="Leave a comment...">\${escapeHtml(existingText)}</textarea>
        <div class="comment-form-actions">
          <button class="btn-secondary" onclick="cancelCommentForm()">Cancel</button>
          <button onclick="submitInlineComment()">Add Comment</button>
        </div>
      </div>
    </td>
  \`;
  selectedLineElement.after(formRow);

  const textarea = formRow.querySelector('textarea');
  textarea.focus();
  // Move cursor to end of text
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

  // Save draft on input
  textarea.addEventListener('input', () => {
    saveDraftComment(currentFile, actualStartLine, actualEndLine, textarea.value);
  });

  // Also save initial draft if there's existing text
  if (existingText) {
    saveDraftComment(currentFile, actualStartLine, actualEndLine, existingText);
  }
}

// Save draft comment to extension state
function saveDraftComment(file, startLine, endLine, text) {
  if (text.trim()) {
    vscode.postMessage({
      type: 'saveDraftComment',
      draft: { file, startLine: parseInt(startLine), endLine: parseInt(endLine), text }
    });
  } else {
    vscode.postMessage({ type: 'clearDraftComment' });
  }
}

// Restore draft comment form from state
function restoreDraftCommentForm(draft) {
  if (!draft) return;

  // Find the target line element
  const targetRow = document.querySelector(\`.diff-line[data-line="\${draft.endLine}"]\`);
  if (!targetRow) return;

  // Check if form already exists with same content
  const existingForm = document.querySelector('.comment-form-row');
  if (existingForm) {
    const existingText = existingForm.querySelector('textarea')?.value;
    if (existingText === draft.text) return;
  }

  // Set up selection state
  selectedLineNum = draft.startLine;
  selectedLineElement = targetRow;
  selectionStartLine = draft.startLine;
  selectionEndLine = draft.endLine;

  // Show form with draft text
  showInlineCommentForm(draft.file, draft.startLine, draft.endLine, draft.text);
}

window.cancelCommentForm = function() {
  clearLineSelection();
  const formRow = document.querySelector('.comment-form-row');
  if (formRow) formRow.remove();
  selectionStartLine = null;
  selectionEndLine = null;
  // Clear draft on explicit cancel
  vscode.postMessage({ type: 'clearDraftComment' });
};

window.submitInlineComment = function() {
  const formRow = document.querySelector('.comment-form-row');
  if (!formRow) return;

  const text = formRow.querySelector('textarea').value;
  const startLine = formRow.dataset.start;
  const endLine = formRow.dataset.end;
  const currentFile = formRow.dataset.file;

  if (text && currentFile) {
    saveScrollPosition();

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
    expandSidebar();
    // Clear draft on submit
    vscode.postMessage({ type: 'clearDraftComment' });
  }
};

// ===== Utility =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Hacker News Feed =====
function renderHNFeed(stories, status, error) {
  const isLoading = status === 'loading';

  let content = '';

  if (status === 'loading') {
    content = \`
      <div class="hn-loading">
        <div class="hn-loading-spinner"></div>
        <div>Loading stories...</div>
      </div>
    \`;
  } else if (status === 'error') {
    content = \`
      <div class="hn-error">
        <div class="hn-error-icon">⚠️</div>
        <div class="hn-error-message">\${escapeHtml(error || 'Failed to load stories')}</div>
        <div class="hn-error-retry">
          <button class="hn-refresh-btn" onclick="refreshHNFeed()">
            <span class="refresh-icon">↻</span> Retry
          </button>
        </div>
      </div>
    \`;
  } else if (!stories || stories.length === 0) {
    content = \`
      <div class="hn-empty">
        <div>No stories available</div>
        <button class="hn-refresh-btn" onclick="refreshHNFeed()">
          <span class="refresh-icon">↻</span> Load Stories
        </button>
      </div>
    \`;
  } else {
    content = \`
      <div class="hn-story-list">
        \${stories.map((story, index) => renderHNStory(story, index)).join('')}
      </div>
    \`;
  }

  return \`
    <div class="hn-feed">
      <div class="hn-feed-header">
        <div class="hn-feed-title">
          <span class="hn-icon">Y</span>
          <span>Hacker News</span>
        </div>
        <button class="hn-refresh-btn \${isLoading ? 'loading' : ''}" onclick="refreshHNFeed()" \${isLoading ? 'disabled' : ''}>
          <span class="refresh-icon">↻</span> Refresh
        </button>
      </div>
      \${content}
    </div>
  \`;
}

function renderHNStory(story, index) {
  const domainDisplay = story.domain ? \`<span class="hn-story-domain">(\${escapeHtml(story.domain)})</span>\` : '';
  const storyUrl = story.url || story.discussionUrl;

  return \`
    <div class="hn-story">
      <span class="hn-story-title" onclick="openHNStory('\${escapeHtml(storyUrl)}')" title="\${escapeHtml(story.title)}">
        \${escapeHtml(story.title)}
      </span>
      <div class="hn-story-meta">
        <span class="hn-story-score">▲ \${story.score}</span>
        <span class="hn-story-comments" onclick="openHNComments(\${story.id})">
          💬 \${story.descendants} comments
        </span>
        \${domainDisplay}
        <span class="hn-story-time">\${escapeHtml(story.timeAgo)}</span>
      </div>
    </div>
  \`;
}

window.refreshHNFeed = function() {
  vscode.postMessage({ type: 'refreshHNFeed' });
};

window.openHNStory = function(url) {
  if (url) {
    vscode.postMessage({ type: 'openHNStory', url: url });
  }
};

window.openHNComments = function(storyId) {
  vscode.postMessage({ type: 'openHNComments', storyId: storyId });
};
`;
