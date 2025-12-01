import { PanelState, FileInfo, CommentInfo, AIStatus, DiffDisplayState, DiffViewMode } from '../ports/outbound/PanelState';

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
    showDiff(diff: DiffDisplayState): void;
    clearDiff(): void;

    // Chunk collapse operations
    toggleChunkCollapse(chunkIndex: number): void;
    collapseAllChunks(): void;
    expandAllChunks(): void;

    // Comment operations
    addComment(comment: CommentInfo): void;
    removeComment(id: string): void;
    clearComments(): void;
    markCommentsAsSubmitted(ids: string[]): void;

    // AI status
    setAIStatus(status: AIStatus): void;

    // View mode
    setTreeView(isTree: boolean): void;
    setDiffViewMode(mode: DiffViewMode): void;

    // Search operations
    setSearchQuery(query: string): void;

    // Reset state (e.g., when panel closes)
    reset(): void;
}
