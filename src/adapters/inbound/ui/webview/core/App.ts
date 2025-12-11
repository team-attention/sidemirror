/**
 * Webview Application Core
 *
 * Main orchestrator that wires together all webview components.
 * Handles message routing, state management, and component lifecycle.
 */

import { stateManager } from '../state';
import { getSignal, resetAbortController } from '../utils/events';
import {
  getSidebarElements,
  setupSidebarToggle,
  setupResizer,
  expandSidebar,
  collapseSidebar,
} from '../components/sidebar/Sidebar';
import { renderFileList } from '../components/sidebar/FileList';
import { renderComments, registerCommentHandlers, type CommentHandlers } from '../components/sidebar/Comments';
import { renderAIStatus } from '../components/sidebar/AIStatus';
import { setupFileSearchHandlers } from '../components/sidebar/FileSearch';
import { setupHNFeedHandlers, renderHNFeed } from '../components/waiting/HNFeed';
import { showWaitingScreen } from '../components/waiting/WaitingScreen';
import { renderContentView, renderContentViewHeader } from '../components/content/ContentView';
import {
  setupDiffSearchHandlers,
  getDiffSearchElements,
  performDiffSearch,
  navigateDiffSearch,
  clearDiffHighlights,
  renderChunksToHtml,
  setupChunkToggleHandlers,
  renderScopedDiffContent,
  collectScopeLines,
  setupScopeHandlers,
  isMarkdownFile,
  createSelectionState,
  clearLineSelection,
  handleLineMouseDown,
  handleLineMouseMove,
  handleLineMouseUp,
  showInlineCommentForm,
  restoreDraftCommentForm as restoreDraftFormFn,
  registerInlineCommentHandlers,
} from '../components/diff';
import type {
  DiffChunk,
  ChunkState,
  InlineComment,
  ScopedDiffData,
  SelectionState,
  CommentDraft,
} from '../components/diff';
import { registerViewModeToggle, registerFeedToggle } from '../components/diff';
import {
  renderFullMarkdownWithHighlights,
  setupPreviewCommentHandlers,
  createPreviewSelectionState,
} from '../components/markdown';
import type { MarkdownComment, PreviewSelectionState } from '../components/markdown';
import { escapeHtml } from '../utils/dom';

// ===== Types =====

interface VSCodeAPI {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

declare const acquireVsCodeApi: () => VSCodeAPI;

declare global {
  interface Window {
    SidecarHighlighter?: {
      highlightLines: (lines: string[], language: string) => Promise<string[]>;
      highlightCodeBlock: (code: string, language: string) => Promise<string>;
      getLanguageFromPath: (filePath: string) => string;
      preload: () => void;
    };
    toggleDiffViewMode?: () => void;
    toggleFeed?: () => void;
    toggleChunk?: (index: number) => void;
    openHNStory?: (url: string, title: string) => void;
    refreshHNFeed?: () => void;
    loadMoreHN?: () => void;
  }
}

// ===== Application State =====

let vscode: VSCodeAPI;
let currentContentUrl = '';

// ===== VSCode API =====

function getVSCode(): VSCodeAPI {
  if (!vscode) {
    vscode = acquireVsCodeApi();
  }
  return vscode;
}

// ===== Header Structure Management =====

function ensureDefaultHeaderStructure(): void {
  const viewerHeader = document.getElementById('viewer-header');
  if (!viewerHeader) return;

  const diffStats = document.getElementById('diff-stats');
  if (diffStats) return;

  const sidebarElements = getSidebarElements();
  const uiState = stateManager.getUI();

  viewerHeader.innerHTML = `
    <span class="diff-header-icon">📄</span>
    <span class="diff-header-title">Select a file to review</span>
    <div class="diff-stats" id="diff-stats"></div>
    <button class="sidebar-toggle" id="toggle-sidebar" aria-label="Expand file list panel">&lt;</button>
  `;

  const newToggleButton = document.getElementById('toggle-sidebar');
  if (newToggleButton && sidebarElements) {
    newToggleButton.addEventListener(
      'click',
      () => {
        if (document.body.classList.contains('sidebar-collapsed')) {
          expandSidebar(sidebarElements, uiState.sidebarWidth);
        } else {
          collapseSidebar(sidebarElements);
        }
      },
      { signal: getSignal() }
    );

    if (document.body.classList.contains('sidebar-collapsed')) {
      newToggleButton.textContent = '<';
      newToggleButton.setAttribute('aria-label', 'Expand file list panel');
    } else {
      newToggleButton.textContent = '>';
      newToggleButton.setAttribute('aria-label', 'Collapse file list panel');
    }
  }
}

// ===== Scroll Position Management =====

function getScrollableElement(): HTMLElement | null {
  const preview = document.querySelector('.markdown-preview') as HTMLElement | null;
  if (preview) return preview;
  return document.getElementById('diff-viewer');
}

// ===== Cleanup =====

function cleanup(): void {
  resetAbortController();
  stateManager.reset();
}

// ===== State Rendering =====

interface RenderState {
  selectedFile: string | null;
  diff: DiffData | null;
  scopedDiff: DiffData | null;
  sessionFiles: FileItem[];
  uncommittedFiles: FileItem[];
  showUncommitted: boolean;
  isTreeView: boolean;
  searchQuery: string;
  comments: Comment[];
  aiStatus: AIStatus;
  contentView: ContentView | null;
  hnStories: HNStory[];
  hnFeedStatus: string;
  hnFeedError: string | null;
  hnHasMore: boolean;
  hnLoadingMore: boolean;
  diffViewMode: string;
  showHNFeed: boolean;
  fileScrollPositions: Record<string, number>;
  draftComment: DraftComment | null;
}

interface DiffData {
  file: string;
  chunks: DiffChunk[];
  stats: { additions: number; deletions: number };
  chunkStates?: ChunkState[];
}

interface DiffChunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldNum?: number;
  newNum?: number;
}

interface ChunkState {
  isCollapsed: boolean;
}

interface FileItem {
  path: string;
  name: string;
  status: 'added' | 'modified' | 'deleted';
  isUncommitted?: boolean;
  matchType?: 'path' | 'content';
}

interface Comment {
  id: string;
  file: string;
  line: number;
  endLine?: number;
  text: string;
  isSubmitted: boolean;
}

interface AIStatus {
  active: boolean;
  message?: string;
}

interface ContentView {
  url: string;
  title: string;
}

interface HNStory {
  id: number;
  title: string;
  url?: string;
  score: number;
  by: string;
  descendants: number;
}

interface DraftComment {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
}

async function renderState(state: RenderState): Promise<void> {
  const vsCodeApi = getVSCode();
  const uiState = stateManager.getUI();

  // Auto-fetch HN stories when panel is first shown
  if (!state.selectedFile && !state.diff && state.hnFeedStatus === 'idle') {
    vsCodeApi.postMessage({ type: 'refreshHNFeed' });
  }

  // Check if we're switching files
  const previousFile = uiState.currentFile;
  const newFile = state.selectedFile;
  const isFileSwitching = previousFile !== newFile && previousFile !== null && newFile !== null;

  // Save scroll position before switching
  if (isFileSwitching && previousFile) {
    const scrollEl = getScrollableElement();
    if (scrollEl && scrollEl.scrollTop > 0) {
      vsCodeApi.postMessage({
        type: 'saveScrollPosition',
        file: previousFile,
        scrollTop: scrollEl.scrollTop,
      });
    }

    // Save draft comment
    const existingForm = document.querySelector('.comment-form-row') as HTMLElement | null;
    if (existingForm) {
      const textarea = existingForm.querySelector('textarea') as HTMLTextAreaElement | null;
      const text = textarea ? textarea.value : '';
      const startLine = existingForm.dataset.start;
      const endLine = existingForm.dataset.end;
      const formFile = existingForm.dataset.file;
      if (text && formFile) {
        vsCodeApi.postMessage({
          type: 'saveDraftComment',
          draft: {
            file: formFile,
            startLine: parseInt(startLine || '0'),
            endLine: parseInt(endLine || '0'),
            text,
          },
        });
      }
    }
  }

  // Determine scroll position to restore
  let scrollToRestore = 0;
  const pendingScroll = uiState.pendingScrollRestore;
  if (pendingScroll !== null) {
    scrollToRestore = pendingScroll;
    stateManager.setUI({ pendingScrollRestore: null });
  } else if (
    isFileSwitching &&
    newFile &&
    state.fileScrollPositions &&
    state.fileScrollPositions[newFile]
  ) {
    scrollToRestore = state.fileScrollPositions[newFile];
  }

  // Update current file tracker
  stateManager.setUI({ currentFile: newFile });

  // Render sidebar components
  const viewState = stateManager.getView();
  renderFileList(
    {
      sessionFiles: state.sessionFiles,
      uncommittedFiles: state.uncommittedFiles,
      selectedFile: state.selectedFile,
      isTreeView: state.isTreeView,
      searchQuery: state.searchQuery,
      showUncommitted: state.showUncommitted,
      collapsedFolders: viewState.collapsedFolders,
      diff: state.diff || state.scopedDiff || undefined,
    },
    {
      onFileSelect: (filePath) => vsCodeApi.postMessage({ type: 'selectFile', file: filePath }),
      onFolderToggle: (folderPath, isCollapsed) => {
        if (isCollapsed) {
          stateManager.addCollapsedFolder(folderPath);
        } else {
          stateManager.removeCollapsedFolder(folderPath);
        }
      },
    }
  );

  // Transform comments to match the component's expected format
  const transformedComments = (state.comments || []).map((c) => ({
    id: c.id,
    file: c.file,
    line: c.line,
    endLine: c.endLine,
    text: c.text,
    isSubmitted: c.isSubmitted,
  }));
  renderComments(transformedComments);

  renderAIStatus(state.aiStatus);

  // Content view takes precedence
  if (state.contentView) {
    renderContentViewState(state.contentView);
    return;
  }

  // Check if waiting screen should be shown
  // Show waiting screen when AI is active and no file is selected (even if files exist in sidebar)
  const hasVisibleFiles =
    state.sessionFiles.length > 0 ||
    (state.showUncommitted && state.uncommittedFiles.length > 0);
  const noFileSelected = !state.selectedFile;
  const shouldShowWaiting = state.aiStatus.active && (noFileSelected || !hasVisibleFiles || state.showHNFeed);

  if (shouldShowWaiting) {
    ensureDefaultHeaderStructure();
    showWaitingScreen(
      state.hnStories,
      state.hnFeedStatus,
      state.hnFeedError,
      state.hnHasMore,
      state.hnLoadingMore
    );
  } else if (state.diffViewMode === 'scope' && state.scopedDiff) {
    await renderScopedDiff(state.scopedDiff, state.selectedFile, state.comments, !!state.diff);
  } else {
    await renderDiff(
      state.diff,
      state.selectedFile,
      state.diffViewMode,
      state.comments,
      !!state.scopedDiff,
      state.hnStories,
      state.hnFeedStatus,
      state.hnFeedError,
      state.aiStatus
    );
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

// ===== Diff Rendering =====

async function renderScopedDiff(
  scopedDiff: ScopedDiffData,
  selectedFile: string | null,
  comments: Comment[],
  hasDiff: boolean
): Promise<void> {
  const vsCodeApi = getVSCode();
  ensureDefaultHeaderStructure();

  const header = document.querySelector('.diff-header-title') as HTMLElement | null;
  const stats = document.getElementById('diff-stats');
  const viewer = document.getElementById('diff-viewer');
  const diffToolbar = document.getElementById('diff-toolbar');
  const diffCollapseAll = document.getElementById('diff-collapse-all');

  if (!header || !stats || !viewer || !diffToolbar) return;

  diffToolbar.style.display = 'flex';
  if (diffCollapseAll) diffCollapseAll.style.display = 'none';

  header.textContent = scopedDiff.file;
  header.style.cursor = 'pointer';
  header.onclick = () => vsCodeApi.postMessage({ type: 'openFile', file: scopedDiff.file });

  // Stats with toggle button
  const toggleHtml = hasDiff
    ? '<div class="view-mode-toggle"><button class="toggle-btn" onclick="toggleDiffViewMode()">Diff</button></div>'
    : '';
  stats.innerHTML = `
    <span class="stat-added">+${scopedDiff.stats.additions}</span>
    <span class="stat-removed">-${scopedDiff.stats.deletions}</span>
    ${toggleHtml}
  `;

  // Transform comments
  const fileComments: InlineComment[] = (comments || [])
    .filter((c) => c.file === scopedDiff.file)
    .map((c) => ({
      id: c.id,
      line: c.line,
      endLine: c.endLine,
      text: c.text,
      isSubmitted: false,
    }));

  // Collect lines for highlighting
  const allLines: Array<{ lineNumber: number; content: string }> = [];
  collectScopeLines(scopedDiff.scopes, allLines);
  if (scopedDiff.orphanLines) {
    for (const line of scopedDiff.orphanLines) {
      allLines.push({ lineNumber: line.lineNumber, content: line.content });
    }
  }

  // Highlight lines
  const language = window.SidecarHighlighter
    ? window.SidecarHighlighter.getLanguageFromPath(scopedDiff.file)
    : 'plaintext';

  const highlightMap = new Map<number, string>();
  if (window.SidecarHighlighter && language !== 'plaintext') {
    try {
      const contents = allLines.map((l) => l.content);
      const highlighted = await window.SidecarHighlighter.highlightLines(contents, language);
      allLines.forEach((line, idx) => {
        highlightMap.set(line.lineNumber, highlighted[idx]);
      });
    } catch (e) {
      console.warn('Syntax highlighting failed:', e);
    }
  }

  viewer.innerHTML = `<div class="scoped-diff-view">${renderScopedDiffContent(scopedDiff, fileComments, highlightMap)}</div>`;

  // Setup handlers
  setupScopeHandlers(
    (scopeId) => vsCodeApi.postMessage({ type: 'toggleScopeCollapse', scopeId }),
    () => vsCodeApi.postMessage({ type: 'expandAllScopes' }),
    () => vsCodeApi.postMessage({ type: 'collapseAllScopes' }),
    getSignal()
  );

  setupDiffViewerLineSelection(scopedDiff.file, vsCodeApi);

  onFileChange();
}

async function renderDiff(
  diff: DiffData | null,
  selectedFile: string | null,
  viewMode: string,
  comments: Comment[],
  hasScopedDiff: boolean,
  hnStories: HNStory[],
  hnFeedStatus: string,
  hnFeedError: string | null,
  aiStatus: AIStatus
): Promise<void> {
  const vsCodeApi = getVSCode();
  ensureDefaultHeaderStructure();

  const header = document.querySelector('.diff-header-title') as HTMLElement | null;
  const stats = document.getElementById('diff-stats');
  const viewer = document.getElementById('diff-viewer');
  const diffToolbar = document.getElementById('diff-toolbar');
  const diffCollapseAll = document.getElementById('diff-collapse-all');

  if (!header || !stats || !viewer || !diffToolbar) return;

  // No diff or empty diff
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
    viewer.innerHTML = `
      <div class="placeholder">
        <div class="placeholder-icon">${selectedFile ? '✓' : '📝'}</div>
        <div class="placeholder-text">${selectedFile ? 'No changes in this file' : 'Select a modified file to view changes'}</div>
      </div>
    `;
    return;
  }

  diffToolbar.style.display = 'flex';
  if (diffCollapseAll) diffCollapseAll.style.display = 'block';

  header.textContent = diff.file;
  header.style.cursor = 'pointer';
  header.onclick = () => vsCodeApi.postMessage({ type: 'openFile', file: diff.file });

  const isMarkdown = isMarkdownFile(selectedFile || '');
  const feedToggleHtml = aiStatus.active
    ? '<button class="feed-toggle-btn" onclick="toggleFeed()" title="Show HN Feed">📰</button>'
    : '';

  if (isMarkdown) {
    stats.innerHTML = `
      <span class="stat-added">+${diff.stats.additions}</span>
      <span class="stat-removed">-${diff.stats.deletions}</span>
      <div class="view-mode-toggle">
        <button class="toggle-btn" onclick="toggleDiffViewMode()">${viewMode === 'preview' ? 'Diff' : 'Preview'}</button>
      </div>
      ${feedToggleHtml}
    `;

    if (viewMode === 'preview') {
      await renderMarkdownPreview(diff, viewer, comments, vsCodeApi);
      onFileChange();
      return;
    }
  } else {
    const toggleHtml = hasScopedDiff
      ? '<div class="view-mode-toggle"><button class="toggle-btn" onclick="toggleDiffViewMode()">Scope</button></div>'
      : '';
    stats.innerHTML = `
      <span class="stat-added">+${diff.stats.additions}</span>
      <span class="stat-removed">-${diff.stats.deletions}</span>
      ${toggleHtml}
      ${feedToggleHtml}
    `;
  }

  // Update collapse button
  const chunkStates: ChunkState[] = diff.chunkStates || [];
  const allCollapsed = chunkStates.length > 0 && chunkStates.every((s) => s.isCollapsed);
  if (diffCollapseAll) {
    diffCollapseAll.textContent = allCollapsed ? 'Expand' : 'Collapse';
  }

  // Transform comments
  const fileComments: InlineComment[] = (comments || [])
    .filter((c) => c.file === diff.file)
    .map((c) => ({
      id: c.id,
      line: c.line,
      endLine: c.endLine,
      text: c.text,
      isSubmitted: c.isSubmitted,
    }));

  // Get language for syntax highlighting
  const language = window.SidecarHighlighter
    ? window.SidecarHighlighter.getLanguageFromPath(diff.file)
    : 'plaintext';

  // Render diff table
  const chunksHtml = await renderChunksToHtml(
    diff.chunks as DiffChunk[],
    chunkStates,
    fileComments,
    language
  );

  viewer.innerHTML = `
    <table class="diff-table">
      <colgroup>
        <col class="col-gutter">
        <col class="col-line-num">
        <col class="col-content">
      </colgroup>
      ${chunksHtml}
    </table>
  `;

  // Setup handlers
  setupChunkToggleHandlers((index) =>
    vsCodeApi.postMessage({ type: 'toggleChunkCollapse', index })
  );

  setupDiffViewerLineSelection(diff.file, vsCodeApi);

  onFileChange();
}

async function renderMarkdownPreview(
  diff: DiffData,
  viewer: HTMLElement,
  comments: Comment[],
  vsCodeApi: VSCodeAPI
): Promise<void> {
  // Get the full content from diff state (set by adapter for markdown files)
  const fullContent = (diff as DiffData & { newFileContent?: string }).newFileContent;
  if (!fullContent) {
    viewer.innerHTML = '<div class="placeholder"><div class="placeholder-text">Preview not available</div></div>';
    return;
  }

  // Get changed line numbers and deletions
  const changedLineNumbers = (diff as DiffData & { changedLineNumbers?: number[] }).changedLineNumbers;
  const deletions = (diff as DiffData & { deletions?: Array<{ afterLine: number; content: string }> }).deletions;

  // Transform comments for markdown preview
  const fileComments: MarkdownComment[] = (comments || [])
    .filter((c) => c.file === diff.file)
    .map((c) => ({
      id: c.id,
      line: c.line,
      endLine: c.endLine,
      text: c.text,
      isSubmitted: false,
    }));

  // Render markdown with highlights
  const markdownHtml = await renderFullMarkdownWithHighlights(
    fullContent,
    changedLineNumbers,
    deletions?.map(d => ({ afterLine: d.afterLine, content: d.content.join('\n') })),
    fileComments
  );

  // markdownHtml already contains markdown-preview-container wrapper
  viewer.innerHTML = markdownHtml;

  // Setup comment handlers for preview
  previewSelectionState = createPreviewSelectionState();
  setupPreviewCommentHandlers(
    diff.file,
    {
      onSubmit: (file, startLine, endLine, text) =>
        vsCodeApi.postMessage({ type: 'addComment', file, line: startLine, endLine, text }),
      onEdit: (id, text) =>
        vsCodeApi.postMessage({ type: 'editComment', id, text }),
      onSaveScrollPosition: () => {
        const scrollEl = getScrollableElement();
        if (scrollEl && scrollEl.scrollTop > 0) {
          stateManager.setUI({ pendingScrollRestore: scrollEl.scrollTop });
        }
      },
      onExpandSidebar: () => {
        const sidebarElements = getSidebarElements();
        if (sidebarElements) {
          expandSidebar(sidebarElements, stateManager.getUI().sidebarWidth);
        }
      },
      getSignal,
    },
    () => previewSelectionState,
    (state) => { previewSelectionState = state; }
  );
}

function onFileChange(): void {
  // Re-run diff search if active
  const searchState = stateManager.getSearch();
  if (searchState.diffSearchQuery) {
    const matches = performDiffSearch(searchState.diffSearchQuery);
    stateManager.setSearch({
      diffSearchMatches: matches,
      diffSearchCurrentIndex: matches.length > 0 ? 0 : -1,
    });
  }
}

// ===== Line Selection for Diff Viewer =====

let selectionState: SelectionState = createSelectionState();
let previewSelectionState: PreviewSelectionState = createPreviewSelectionState();

function setupDiffViewerLineSelection(currentFile: string, vsCodeApi: VSCodeAPI): void {
  const viewer = document.getElementById('diff-viewer');
  if (!viewer) return;

  const handlers = {
    onSubmit: (file: string, startLine: number, endLine: number | undefined, text: string) =>
      vsCodeApi.postMessage({ type: 'addComment', file, line: startLine, endLine, text }),
    onDraftSave: (draft: CommentDraft) =>
      vsCodeApi.postMessage({ type: 'saveDraftComment', draft }),
    onDraftClear: () => vsCodeApi.postMessage({ type: 'clearDraftComment' }),
    onSaveScrollPosition: () => {
      const scrollEl = getScrollableElement();
      if (scrollEl && scrollEl.scrollTop > 0) {
        stateManager.setUI({ pendingScrollRestore: scrollEl.scrollTop });
      }
    },
    onExpandSidebar: () => {
      const sidebarElements = getSidebarElements();
      if (sidebarElements) {
        expandSidebar(sidebarElements, stateManager.getUI().sidebarWidth);
      }
    },
    onEdit: (id: string, text: string) =>
      vsCodeApi.postMessage({ type: 'editComment', id, text }),
    onDelete: (id: string) =>
      vsCodeApi.postMessage({ type: 'deleteComment', id }),
    getSignal,
  };

  // Register global window functions for inline comment buttons
  registerInlineCommentHandlers(handlers);

  // Handle comment button click
  viewer.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const btn = target.closest('.line-comment-btn') as HTMLElement | null;
    if (btn) {
      const lineNum = parseInt(btn.dataset.line || '0');
      const lineElement = btn.closest('tr') as HTMLElement;
      showInlineCommentForm(currentFile, lineElement, lineNum, undefined, handlers);
    }
  }, { signal: getSignal() });

  // Handle line selection for multi-line comments
  viewer.addEventListener('mousedown', (e: MouseEvent) => {
    selectionState = handleLineMouseDown(e, selectionState);
  }, { signal: getSignal() });

  viewer.addEventListener('mousemove', (e: MouseEvent) => {
    selectionState = handleLineMouseMove(e, selectionState);
  }, { signal: getSignal() });

  document.addEventListener('mouseup', (e: MouseEvent) => {
    const { state, range, element } = handleLineMouseUp(e, selectionState);
    selectionState = state;
    if (range && element) {
      showInlineCommentForm(currentFile, element, range.startLine, range.endLine, handlers);
    }
  }, { signal: getSignal() });
}

function renderContentViewState(contentView: ContentView): void {
  const diffViewer = document.getElementById('diff-viewer');
  const viewerHeader = document.getElementById('viewer-header');
  const diffToolbar = document.getElementById('diff-toolbar');
  const diffStats = document.getElementById('diff-stats');

  if (!diffViewer || !viewerHeader) return;

  currentContentUrl = contentView.url;
  const vsCodeApi = getVSCode();
  const isSidebarCollapsed = document.body.classList.contains('sidebar-collapsed');

  viewerHeader.innerHTML = renderContentViewHeader({
    title: contentView.title,
    isSidebarCollapsed,
  });

  if (diffStats) diffStats.innerHTML = '';
  if (diffToolbar) diffToolbar.style.display = 'none';

  diffViewer.innerHTML = renderContentView({
    url: contentView.url,
    title: contentView.title,
  });

  // Attach event listeners
  const backBtn = document.getElementById('content-back-btn');
  const externalBtn = document.getElementById('content-external-btn');
  const iframe = document.getElementById('content-iframe') as HTMLIFrameElement | null;
  const retryBtn = document.getElementById('content-retry-btn');
  const externalErrorBtn = document.getElementById('content-external-error-btn');

  if (backBtn) {
    backBtn.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'closeContentView' }),
      { signal: getSignal() }
    );
  }

  if (externalBtn) {
    externalBtn.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'openContentExternal', url: currentContentUrl }),
      { signal: getSignal() }
    );
  }

  if (iframe) {
    // Track if content loaded successfully
    let loadSuccessful = false;
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;

    const showError = () => {
      const loading = document.getElementById('content-loading');
      const error = document.getElementById('content-error');
      if (loading) loading.classList.add('hidden');
      if (error) error.classList.remove('hidden');
      iframe.style.display = 'none';
    };

    const showContent = () => {
      loadSuccessful = true;
      if (loadTimeout) {
        clearTimeout(loadTimeout);
        loadTimeout = null;
      }
      const loading = document.getElementById('content-loading');
      if (loading) loading.classList.add('hidden');
      iframe.style.display = 'block';
    };

    // Set a timeout to detect if iframe fails to load (X-Frame-Options, CSP blocks)
    // Many sites block iframe embedding but don't trigger error events
    loadTimeout = setTimeout(() => {
      if (!loadSuccessful) {
        // After timeout, check if iframe has any accessible content
        try {
          // Try to access iframe content - will throw for blocked/cross-origin frames
          const doc = iframe.contentDocument;
          // If we can access and it's empty or about:blank, likely blocked
          if (doc && (doc.body?.innerHTML === '' || doc.URL === 'about:blank')) {
            showError();
            return;
          }
          // If accessible and has content, show it
          if (doc && doc.body?.innerHTML) {
            showContent();
            return;
          }
          // Cross-origin but might be loaded - give benefit of doubt
          showContent();
        } catch {
          // Cross-origin access denied - this is normal for loaded external sites
          // The iframe might still be showing content, so show it
          showContent();
        }
      }
    }, 5000);

    iframe.addEventListener(
      'load',
      () => {
        // iframe loaded - but might be empty if blocked by X-Frame-Options
        // Check if we can detect empty content
        setTimeout(() => {
          try {
            const doc = iframe.contentDocument;
            // If we can access the document and it's essentially empty, likely blocked
            if (doc) {
              const bodyContent = doc.body?.innerHTML?.trim() || '';
              const hasContent = bodyContent.length > 0 && doc.URL !== 'about:blank';
              if (hasContent) {
                showContent();
              } else {
                // Empty content likely means blocked
                showError();
              }
            } else {
              // Can't access document (cross-origin) - assume loaded successfully
              showContent();
            }
          } catch {
            // Cross-origin access denied - iframe is loaded with external content
            showContent();
          }
        }, 100);
      },
      { signal: getSignal() }
    );

    iframe.addEventListener(
      'error',
      () => {
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = null;
        }
        showError();
      },
      { signal: getSignal() }
    );
  }

  if (retryBtn) {
    retryBtn.addEventListener(
      'click',
      () => {
        const loading = document.getElementById('content-loading');
        const error = document.getElementById('content-error');
        if (loading) loading.classList.remove('hidden');
        if (error) error.classList.add('hidden');
        if (iframe) iframe.src = currentContentUrl;
      },
      { signal: getSignal() }
    );
  }

  if (externalErrorBtn) {
    externalErrorBtn.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'openContentExternal', url: currentContentUrl }),
      { signal: getSignal() }
    );
  }

  // Attach sidebar toggle handler
  const sidebarElements = getSidebarElements();
  const toggleBtn = document.getElementById('toggle-sidebar');
  if (toggleBtn && sidebarElements) {
    const uiState = stateManager.getUI();
    toggleBtn.addEventListener(
      'click',
      () => {
        if (document.body.classList.contains('sidebar-collapsed')) {
          expandSidebar(sidebarElements, uiState.sidebarWidth);
          toggleBtn.textContent = '>';
          toggleBtn.setAttribute('aria-label', 'Collapse file list panel');
        } else {
          collapseSidebar(sidebarElements);
          toggleBtn.textContent = '<';
          toggleBtn.setAttribute('aria-label', 'Expand file list panel');
        }
      },
      { signal: getSignal() }
    );
  }
}

function restoreDraftCommentForm(draft: DraftComment): void {
  const vsCodeApi = getVSCode();
  const handlers = {
    onSubmit: (file: string, startLine: number, endLine: number | undefined, text: string) =>
      vsCodeApi.postMessage({ type: 'addComment', file, line: startLine, endLine, text }),
    onDraftSave: (d: CommentDraft) =>
      vsCodeApi.postMessage({ type: 'saveDraftComment', draft: d }),
    onDraftClear: () => {},
    onSaveScrollPosition: () => {},
    onExpandSidebar: () => {
      const sidebarElements = getSidebarElements();
      if (sidebarElements) {
        expandSidebar(sidebarElements, stateManager.getUI().sidebarWidth);
      }
    },
    getSignal,
  };

  restoreDraftFormFn(
    { file: draft.file, startLine: draft.startLine, endLine: draft.endLine, text: draft.text },
    handlers
  );
}

// ===== Message Handler =====

function setupMessageHandler(): void {
  window.addEventListener(
    'message',
    (event) => {
      const message = event.data;
      if (message.type === 'dispose') {
        cleanup();
        return;
      }
      if (message.type === 'render' && message.state) {
        renderState(message.state);
      } else if (message.type === 'scrollToLine') {
        scrollToLineInDiff(message.line, message.endLine, message.commentId);
      }
    },
    { signal: getSignal() }
  );
}

function scrollToLineInDiff(
  line: number,
  endLine?: number,
  commentId?: string
): void {
  // Find the line element
  const lineEl = document.querySelector(`.diff-line[data-line="${line}"]`);
  if (!lineEl) return;

  // Scroll to the line
  lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight the range
  if (endLine && endLine > line) {
    for (let i = line; i <= endLine; i++) {
      const el = document.querySelector(`.diff-line[data-line="${i}"]`);
      if (el) {
        el.classList.add('highlight-target');
        setTimeout(() => el.classList.remove('highlight-target'), 2000);
      }
    }
  } else {
    lineEl.classList.add('highlight-target');
    setTimeout(() => lineEl.classList.remove('highlight-target'), 2000);
  }

  // If commentId provided, expand the inline comment
  if (commentId) {
    const commentRow = document.querySelector(`.inline-comment-row[data-line="${endLine || line}"]`);
    if (commentRow) {
      commentRow.classList.remove('collapsed');
    }
  }
}

// ===== Setup Functions =====

function setupSidebarHandlers(): void {
  const sidebarElements = getSidebarElements();
  if (!sidebarElements) return;

  const uiState = stateManager.getUI();

  setupSidebarToggle(
    sidebarElements,
    () => ({
      isCollapsed: document.body.classList.contains('sidebar-collapsed'),
      width: uiState.sidebarWidth,
    }),
    getSignal()
  );

  setupResizer(
    sidebarElements,
    (width) => stateManager.setUI({ sidebarWidth: width }),
    getSignal()
  );
}

function setupButtonHandlers(): void {
  const vsCodeApi = getVSCode();

  // Submit comments button
  const submitBtn = document.getElementById('submit-comments');
  if (submitBtn) {
    submitBtn.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'submitComments' }),
      { signal: getSignal() }
    );
  }

  // Toggle uncommitted files
  const toggleRow = document.getElementById('toggle-row');
  if (toggleRow) {
    toggleRow.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'toggleUncommitted' }),
      { signal: getSignal() }
    );
  }

  // View mode toggle
  const viewModeToggle = document.getElementById('view-mode-toggle');
  if (viewModeToggle) {
    viewModeToggle.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'toggleViewMode' }),
      { signal: getSignal() }
    );
  }

  // Collapse all button
  const collapseAllBtn = document.getElementById('diff-collapse-all');
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener(
      'click',
      () => vsCodeApi.postMessage({ type: 'toggleAllChunks' }),
      { signal: getSignal() }
    );
  }
}

function setupKeyboardShortcuts(): void {
  document.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.getElementById('diff-search-input') as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    },
    { signal: getSignal() }
  );
}

function setupGlobalFunctions(): void {
  const vsCodeApi = getVSCode();

  // Toggle diff view mode
  registerViewModeToggle(() => {
    vsCodeApi.postMessage({ type: 'toggleDiffViewMode' });
  });

  // Toggle feed
  registerFeedToggle(() => {
    vsCodeApi.postMessage({ type: 'toggleFeed' });
  });

  // HN Feed handlers
  setupHNFeedHandlers(vsCodeApi);

  // Chunk toggle
  window.toggleChunk = (index: number) => {
    vsCodeApi.postMessage({ type: 'toggleChunk', index });
  };
}

// ===== Initialize =====

export function initialize(): void {
  const vsCodeApi = getVSCode();

  // Setup all handlers
  setupMessageHandler();
  setupSidebarHandlers();
  setupButtonHandlers();
  setupKeyboardShortcuts();
  setupGlobalFunctions();

  // Setup sidebar comment handlers
  registerCommentHandlers({
    onEdit: (id, text) => vsCodeApi.postMessage({ type: 'editComment', id, text }),
    onDelete: (id) => vsCodeApi.postMessage({ type: 'deleteComment', id }),
    onNavigate: (id) => vsCodeApi.postMessage({ type: 'navigateToComment', id }),
    onSaveScrollPosition: () => {
      const scrollEl = getScrollableElement();
      if (scrollEl && scrollEl.scrollTop > 0) {
        stateManager.setUI({ pendingScrollRestore: scrollEl.scrollTop });
      }
    },
  });

  // Setup file search
  setupFileSearchHandlers(
    {
      onSearchChange: (query) => vsCodeApi.postMessage({ type: 'setSearchQuery', query }),
      onSearchClear: () => vsCodeApi.postMessage({ type: 'setSearchQuery', query: '' }),
    },
    getSignal()
  );

  // Setup diff search (only if elements exist)
  const diffSearchElements = getDiffSearchElements();
  if (diffSearchElements) {
    setupDiffSearchHandlers(
      diffSearchElements,
      () => stateManager.getSearch(),
      (query) => {
        stateManager.setSearch({ diffSearchQuery: query });
        if (query) {
          const matches = performDiffSearch(query);
          stateManager.setSearch({
            diffSearchMatches: matches,
            diffSearchCurrentIndex: matches.length > 0 ? 0 : -1,
          });
        } else {
          clearDiffHighlights();
          stateManager.setSearch({
            diffSearchMatches: [],
            diffSearchCurrentIndex: -1,
          });
        }
      },
      (direction) => {
        const searchState = stateManager.getSearch();
        if (searchState.diffSearchMatches.length === 0) return;
        navigateDiffSearch(
          searchState.diffSearchMatches,
          searchState.diffSearchCurrentIndex,
          direction
        );
      },
      () => {
        clearDiffHighlights();
        stateManager.setSearch({
          diffSearchQuery: '',
          diffSearchMatches: [],
          diffSearchCurrentIndex: -1,
        });
      },
      getSignal()
    );
  }

  console.log('[SidecarApp] Initialized');
}

// Export for external access
export { getVSCode, cleanup, stateManager };
