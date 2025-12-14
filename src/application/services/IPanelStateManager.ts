import { PanelState, FileInfo, CommentInfo, AIStatus, DiffDisplayState, DiffViewMode, DraftComment, ScopedDiffDisplayState, HNStoryInfo, AgentDisplayInfo } from '../ports/outbound/PanelState';

/**
 * Panel state manager - manages UI state and triggers rendering
 *
 * UseCase들이 이 인터페이스를 통해 UI 상태를 변경한다.
 * 상태 변경 시 자동으로 IPanelPort.render()가 호출된다.
 */
export interface IPanelStateManager {
    // State access
    getState(): PanelState;

    // Session file operations
    addSessionFile(file: FileInfo): void;
    removeSessionFile(path: string): void;
    selectFile(path: string | null): void;

    // Baseline operations
    setBaseline(files: FileInfo[]): void;
    isInBaseline(path: string): boolean;
    moveToSession(path: string): void;
    clearBaseline(): void;

    // Toggle
    toggleShowUncommitted(): void;
    setShowUncommitted(show: boolean): void;

    // Diff operations
    showDiff(diff: DiffDisplayState, scopedDiff?: ScopedDiffDisplayState): void;
    clearDiff(): void;

    // Chunk collapse operations
    toggleChunkCollapse(chunkIndex: number): void;
    collapseAllChunks(): void;
    expandAllChunks(): void;

    // Scoped diff operations
    clearScopedDiff(): void;
    toggleScopeCollapse(scopeId: string): void;
    expandAllScopes(): void;
    collapseAllScopes(): void;
    expandScopeChain(scopeId: string): void;

    // Comment operations
    addComment(comment: CommentInfo): void;
    updateComment(comment: CommentInfo): void;
    removeComment(id: string): void;
    clearComments(): void;
    markCommentsAsSubmitted(ids: string[]): void;
    findCommentById(id: string): CommentInfo | undefined;
    /**
     * Set all comments (replaces existing comments).
     * Used when switching threads to show only that thread's comments.
     */
    setComments(comments: CommentInfo[]): void;

    // AI status
    setAIStatus(status: AIStatus): void;

    // View mode
    setTreeView(isTree: boolean): void;
    setDiffViewMode(mode: DiffViewMode): void;

    // Search operations
    setSearchQuery(query: string): void;

    // Draft comment operations
    setDraftComment(draft: DraftComment | null): void;
    clearDraftComment(): void;

    // Scroll position operations
    setFileScrollPosition(filePath: string, scrollTop: number): void;
    getFileScrollPosition(filePath: string): number;

    // Reset state (e.g., when panel closes)
    reset(): void;

    // HN feed operations
    setHNFeedLoading(): void;
    setHNStories(stories: HNStoryInfo[], fetchedAt: number, hasMore: boolean): void;
    setHNFeedError(error: string): void;
    clearHNFeed(): void;
    setHNLoadingMore(loading: boolean): void;

    // HN feed visibility toggle
    setShowHNFeed(show: boolean): void;
    toggleHNFeed(): void;

    // Content view operations
    /**
     * Open content view with specified URL and title
     * @param url URL to display in iframe
     * @param title Title to show in content view header
     */
    openContentView(url: string, title: string): void;

    /**
     * Close content view and return to previous view
     */
    closeContentView(): void;

    // Agent metadata operations
    /**
     * Set agent display info for multi-agent mode.
     * Pass undefined to clear agent info.
     */
    setAgentInfo(info: AgentDisplayInfo | undefined): void;

    /**
     * Set aggregated view mode.
     * When true, panel shows files from all agents.
     */
    setAggregatedView(isAggregated: boolean): void;

    // Thread context operations
    /**
     * Set the thread ID for this panel.
     * Comments will be associated with this thread.
     */
    setThreadId(threadId: string | undefined): void;

    /**
     * Get the current thread ID.
     */
    getThreadId(): string | undefined;

    /**
     * Set the total number of active threads.
     * Used to determine whether to show thread badges on files.
     */
    setThreadCount(count: number): void;
}
