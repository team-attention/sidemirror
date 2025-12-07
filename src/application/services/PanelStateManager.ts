import {
    PanelState,
    FileInfo,
    CommentInfo,
    AIStatus,
    DiffDisplayState,
    DiffViewMode,
    DraftComment,
    HNStoryInfo,
    ScopedDiffDisplayState,
    ScopedChunkDisplay,
    createInitialPanelState,
} from '../ports/outbound/PanelState';
import { IPanelStateManager } from './IPanelStateManager';

/**
 * Render callback type
 * UI adapter sets this callback to receive state updates
 */
export type RenderCallback = (state: PanelState) => void;

/**
 * Panel state manager implementation
 *
 * Manages UI state and notifies via callback on changes.
 */
export class PanelStateManager implements IPanelStateManager {
    private state: PanelState;
    private renderCallback: RenderCallback | null = null;
    private baselineSet: Set<string> = new Set();

    constructor() {
        this.state = createInitialPanelState();
    }

    /**
     * Set render callback (called by UI adapter)
     */
    setRenderCallback(callback: RenderCallback): void {
        this.renderCallback = callback;
        this.render();
    }

    /**
     * Clear render callback (called when panel is disposed)
     */
    clearRenderCallback(): void {
        this.renderCallback = null;
    }

    getState(): PanelState {
        return { ...this.state };
    }

    // ===== Session file operations =====

    addSessionFile(file: FileInfo): void {
        // Remove if exists, then add to front (most recent first)
        const filtered = this.state.sessionFiles.filter((f) => f.path !== file.path);
        this.state = {
            ...this.state,
            sessionFiles: [file, ...filtered],
        };
        this.render();
    }

    removeSessionFile(path: string): void {
        const newFiles = this.state.sessionFiles.filter((f) => f.path !== path);
        if (newFiles.length !== this.state.sessionFiles.length) {
            this.state = {
                ...this.state,
                sessionFiles: newFiles,
                selectedFile: this.state.selectedFile === path ? null : this.state.selectedFile,
                diff: this.state.diff?.file === path ? null : this.state.diff,
            };
            this.render();
        }
    }

    selectFile(path: string | null): void {
        if (this.state.selectedFile !== path) {
            this.state = {
                ...this.state,
                selectedFile: path,
            };
            this.render();
        }
    }

    // ===== Baseline operations =====

    setBaseline(files: FileInfo[]): void {
        this.baselineSet = new Set(files.map((f) => f.path));
        this.state = {
            ...this.state,
            uncommittedFiles: files,
        };
        this.render();
    }

    isInBaseline(path: string): boolean {
        return this.baselineSet.has(path);
    }

    moveToSession(path: string): void {
        if (!this.isInBaseline(path)) return;

        const file = this.state.uncommittedFiles.find((f) => f.path === path);
        if (!file) return;

        this.baselineSet.delete(path);

        this.state = {
            ...this.state,
            uncommittedFiles: this.state.uncommittedFiles.filter((f) => f.path !== path),
            sessionFiles: [...this.state.sessionFiles, file],
        };
        this.render();
    }

    clearBaseline(): void {
        this.baselineSet.clear();
        this.state = {
            ...this.state,
            uncommittedFiles: [],
        };
        this.render();
    }

    // ===== Toggle =====

    toggleShowUncommitted(): void {
        this.state = {
            ...this.state,
            showUncommitted: !this.state.showUncommitted,
        };
        this.render();
    }

    setShowUncommitted(show: boolean): void {
        if (this.state.showUncommitted !== show) {
            this.state = {
                ...this.state,
                showUncommitted: show,
            };
            this.render();
        }
    }

    // ===== Diff operations =====

    showDiff(diff: DiffDisplayState, scopedDiff?: ScopedDiffDisplayState): void {
        // Auto-switch to preview mode for markdown files
        const isMarkdown = diff.file.endsWith('.md') ||
            diff.file.endsWith('.markdown') ||
            diff.file.endsWith('.mdx');

        // Determine view mode: markdown -> preview, has scopedDiff -> scope, else diff
        let viewMode: DiffViewMode = 'diff';
        if (isMarkdown) {
            viewMode = 'preview';
        } else if (scopedDiff && scopedDiff.hasScopeData) {
            viewMode = 'scope';
        }

        this.state = {
            ...this.state,
            diff,
            scopedDiff: scopedDiff || null,
            selectedFile: diff.file,
            diffViewMode: viewMode,
        };
        this.render();
    }

    clearDiff(): void {
        this.state = {
            ...this.state,
            diff: null,
        };
        this.render();
    }

    // ===== Chunk collapse operations =====

    toggleChunkCollapse(chunkIndex: number): void {
        if (!this.state.diff || !this.state.diff.chunkStates[chunkIndex]) return;

        const newChunkStates = this.state.diff.chunkStates.map((cs, i) =>
            i === chunkIndex ? { ...cs, isCollapsed: !cs.isCollapsed } : cs
        );

        this.state = {
            ...this.state,
            diff: {
                ...this.state.diff,
                chunkStates: newChunkStates,
            },
        };
        this.render();
    }

    collapseAllChunks(): void {
        if (!this.state.diff) return;

        const newChunkStates = this.state.diff.chunkStates.map((cs) => ({
            ...cs,
            isCollapsed: true,
        }));

        this.state = {
            ...this.state,
            diff: {
                ...this.state.diff,
                chunkStates: newChunkStates,
            },
        };
        this.render();
    }

    expandAllChunks(): void {
        if (!this.state.diff) return;

        const newChunkStates = this.state.diff.chunkStates.map((cs) => ({
            ...cs,
            isCollapsed: false,
        }));

        this.state = {
            ...this.state,
            diff: {
                ...this.state.diff,
                chunkStates: newChunkStates,
            },
        };
        this.render();
    }

    // ===== Scoped diff operations =====

    clearScopedDiff(): void {
        this.state = {
            ...this.state,
            scopedDiff: null,
        };
        this.render();
    }

    toggleScopeCollapse(scopeId: string): void {
        if (!this.state.scopedDiff) return;

        const scope = this.findScopeById(scopeId, this.state.scopedDiff.scopes);
        if (!scope) return;

        const newScopes = this.updateScopeCollapse(
            this.state.scopedDiff.scopes,
            scopeId,
            !scope.isCollapsed
        );

        this.state = {
            ...this.state,
            scopedDiff: { ...this.state.scopedDiff, scopes: newScopes },
        };
        this.render();
    }

    expandAllScopes(): void {
        if (!this.state.scopedDiff) return;

        const newScopes = this.setAllCollapseStates(
            this.state.scopedDiff.scopes,
            false
        );

        this.state = {
            ...this.state,
            scopedDiff: { ...this.state.scopedDiff, scopes: newScopes },
        };
        this.render();
    }

    collapseAllScopes(): void {
        if (!this.state.scopedDiff) return;

        // Collapse all scopes (including changed ones)
        const newScopes = this.setAllCollapseStates(
            this.state.scopedDiff.scopes,
            true
        );

        this.state = {
            ...this.state,
            scopedDiff: { ...this.state.scopedDiff, scopes: newScopes },
        };
        this.render();
    }

    expandScopeChain(scopeId: string): void {
        // Expand scope and all parent scopes (for comment navigation)
        if (!this.state.scopedDiff) return;

        const chain = this.findScopeChain(scopeId, this.state.scopedDiff.scopes);
        let newScopes = this.state.scopedDiff.scopes;

        for (const id of chain) {
            newScopes = this.updateScopeCollapse(newScopes, id, false);
        }

        this.state = {
            ...this.state,
            scopedDiff: { ...this.state.scopedDiff, scopes: newScopes },
        };
        this.render();
    }

    private findScopeById(
        scopeId: string,
        scopes: ScopedChunkDisplay[]
    ): ScopedChunkDisplay | null {
        for (const scope of scopes) {
            if (scope.scopeId === scopeId) return scope;
            const found = this.findScopeById(scopeId, scope.children);
            if (found) return found;
        }
        return null;
    }

    private updateScopeCollapse(
        scopes: ScopedChunkDisplay[],
        scopeId: string,
        isCollapsed: boolean
    ): ScopedChunkDisplay[] {
        return scopes.map((scope) => {
            if (scope.scopeId === scopeId) {
                return { ...scope, isCollapsed };
            }
            return {
                ...scope,
                children: this.updateScopeCollapse(scope.children, scopeId, isCollapsed),
            };
        });
    }

    private setAllCollapseStates(
        scopes: ScopedChunkDisplay[],
        collapsed: boolean,
        predicate?: (scope: ScopedChunkDisplay) => boolean
    ): ScopedChunkDisplay[] {
        return scopes.map((scope) => ({
            ...scope,
            isCollapsed: predicate ? (predicate(scope) ? collapsed : scope.isCollapsed) : collapsed,
            children: this.setAllCollapseStates(scope.children, collapsed, predicate),
        }));
    }

    private findScopeChain(
        targetId: string,
        scopes: ScopedChunkDisplay[],
        currentChain: string[] = []
    ): string[] {
        for (const scope of scopes) {
            const newChain = [...currentChain, scope.scopeId];
            if (scope.scopeId === targetId) {
                return newChain;
            }
            const found = this.findScopeChain(targetId, scope.children, newChain);
            if (found.length > 0) {
                return found;
            }
        }
        return [];
    }

    // ===== Comment operations =====

    addComment(comment: CommentInfo): void {
        this.state = {
            ...this.state,
            comments: [...this.state.comments, comment],
        };
        this.render();
    }

    updateComment(comment: CommentInfo): void {
        const index = this.state.comments.findIndex(c => c.id === comment.id);
        if (index !== -1) {
            const newComments = [...this.state.comments];
            newComments[index] = comment;
            this.state = {
                ...this.state,
                comments: newComments,
            };
            this.render();
        }
    }

    removeComment(id: string): void {
        this.state = {
            ...this.state,
            comments: this.state.comments.filter(c => c.id !== id),
        };
        this.render();
    }

    clearComments(): void {
        this.state = {
            ...this.state,
            comments: [],
        };
        this.render();
    }

    markCommentsAsSubmitted(ids: string[]): void {
        const idSet = new Set(ids);
        this.state = {
            ...this.state,
            comments: this.state.comments.map(c =>
                idSet.has(c.id) ? { ...c, isSubmitted: true } : c
            ),
        };
        this.render();
    }

    findCommentById(id: string): CommentInfo | undefined {
        return this.state.comments.find(c => c.id === id);
    }

    // ===== AI status =====

    setAIStatus(status: AIStatus): void {
        this.state = {
            ...this.state,
            aiStatus: status,
        };
        this.render();
    }

    // ===== View mode =====

    setTreeView(isTree: boolean): void {
        if (this.state.isTreeView !== isTree) {
            this.state = {
                ...this.state,
                isTreeView: isTree,
            };
            this.render();
        }
    }

    setDiffViewMode(mode: DiffViewMode): void {
        if (this.state.diffViewMode !== mode) {
            this.state = {
                ...this.state,
                diffViewMode: mode,
            };
            this.render();
        }
    }

    // ===== Search operations =====

    setSearchQuery(query: string): void {
        if (this.state.searchQuery !== query) {
            this.state = {
                ...this.state,
                searchQuery: query,
            };
            this.render();
        }
    }

    clearSearch(): void {
        this.setSearchQuery('');
    }

    // ===== Draft comment operations =====

    setDraftComment(draft: DraftComment | null): void {
        this.state = {
            ...this.state,
            draftComment: draft,
        };
        // Don't call render - draft comment is updated silently
    }

    clearDraftComment(): void {
        if (this.state.draftComment !== null) {
            this.state = {
                ...this.state,
                draftComment: null,
            };
            this.render();
        }
    }

    // ===== Scroll position operations =====

    setFileScrollPosition(filePath: string, scrollTop: number): void {
        this.state = {
            ...this.state,
            fileScrollPositions: {
                ...this.state.fileScrollPositions,
                [filePath]: scrollTop,
            },
        };
        // Don't call render - scroll position is updated silently
    }

    getFileScrollPosition(filePath: string): number {
        return this.state.fileScrollPositions[filePath] || 0;
    }

    // ===== Reset =====

    reset(): void {
        this.baselineSet.clear();
        this.state = createInitialPanelState();
        this.render();
    }

    // ===== HN feed operations =====

    setHNFeedLoading(): void {
        this.state = {
            ...this.state,
            hnFeedStatus: 'loading',
            hnFeedError: undefined,
        };
        this.render();
    }

    setHNStories(stories: HNStoryInfo[], fetchedAt: number): void {
        this.state = {
            ...this.state,
            hnStories: stories,
            hnFeedStatus: 'success',
            hnFeedError: undefined,
            hnLastFetchTime: fetchedAt,
        };
        this.render();
    }

    setHNFeedError(error: string): void {
        this.state = {
            ...this.state,
            hnFeedStatus: 'error',
            hnFeedError: error,
        };
        this.render();
    }

    clearHNFeed(): void {
        this.state = {
            ...this.state,
            hnStories: [],
            hnFeedStatus: 'idle',
            hnFeedError: undefined,
            hnLastFetchTime: undefined,
        };
        this.render();
    }

    // ===== Private =====

    private render(): void {
        if (this.renderCallback) {
            this.renderCallback(this.state);
        }
    }
}
