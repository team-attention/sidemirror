/**
 * Diff Components
 */

export {
  performDiffSearch,
  highlightDiffMatches,
  clearDiffHighlights,
  updateCurrentMatch,
  navigateDiffSearch,
  updateNavButtons,
  updateMatchCounter,
  setupDiffSearchHandlers,
  getDiffSearchElements,
} from './DiffSearch';
export type {
  SearchMatch,
  DiffSearchState,
  DiffSearchElements,
} from './DiffSearch';

export {
  isMarkdownFile,
  renderDiffStats,
  renderViewModeToggle,
  renderFeedToggle,
  renderThreadBadge,
  renderStatsSection,
  updateDiffHeader,
  renderPlaceholder,
} from './DiffHeader';
export type { DiffStats, ViewMode, DiffHeaderProps } from './DiffHeader';

export {
  createSelectionState,
  isSelectableLine,
  clearLineSelection,
  updateLineSelection,
  handleLineMouseDown,
  handleLineMouseMove,
  handleLineMouseUp,
  setupLineSelectionHandlers,
} from './LineSelection';
export type {
  SelectionState,
  SelectionRange,
  LineSelectionHandlers,
} from './LineSelection';

export {
  showInlineCommentForm,
  saveDraftComment,
  restoreDraftCommentForm,
  cancelCommentForm,
  submitInlineComment,
  toggleInlineComment,
  startInlineEdit,
  cancelInlineEdit,
  saveInlineEdit,
  registerInlineCommentHandlers,
} from './InlineComments';
export type { CommentDraft, InlineCommentHandlers } from './InlineComments';

export { renderChunksToHtml, setupChunkToggleHandlers } from './ChunkRenderer';
export type {
  DiffLine,
  ChunkStats,
  DiffChunk,
  ChunkState,
  InlineComment,
} from './ChunkRenderer';

export {
  SCOPE_ICONS,
  collectScopeLines,
  renderScopeDiffLines,
  renderScopeNode,
  renderScopedDiffContent,
  setupScopeHandlers,
  scrollToLineInScopedDiff,
} from './ScopedDiff';
export type {
  ScopeDiffLine,
  ScopeStats,
  ScopeNode,
  ScopedDiffData,
} from './ScopedDiff';

export {
  getDiffViewerElements,
  updateDiffViewerHeader,
  renderEmptyState,
  getNextViewMode,
  registerViewModeToggle,
  registerFeedToggle,
  renderDiffTableWrapper,
} from './DiffViewer';
export type {
  DiffData,
  DiffViewerProps,
  DiffViewerElements,
} from './DiffViewer';
