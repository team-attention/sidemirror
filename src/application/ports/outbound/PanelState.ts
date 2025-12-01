import { DiffResult, DiffChunk } from '../../../domain/entities/Diff';
import { ScopeInfo } from './ISymbolPort';

export type DiffViewMode = 'diff' | 'preview';

/**
 * File information for panel display
 */
export interface FileInfo {
    path: string;
    name: string;
    status: 'modified' | 'added' | 'deleted';
}

/**
 * Extended chunk info for UI rendering
 */
export interface ChunkDisplayInfo {
    index: number;
    isCollapsed: boolean;
    scopeLabel: string | null;
}

/**
 * Diff display state (extends DiffResult for UI)
 */
export interface DiffDisplayState {
    file: string;
    chunks: DiffChunk[];
    stats: { additions: number; deletions: number };
    chunkStates: ChunkDisplayInfo[];
    scopes: ScopeInfo[];
}

/**
 * Comment information for panel display
 */
export interface CommentInfo {
    id: string;
    file: string;
    line: number;
    endLine?: number;
    text: string;
    isSubmitted: boolean;
    codeContext: string;
    timestamp: number;
}

/**
 * AI session status
 */
export interface AIStatus {
    active: boolean;
    type?: 'claude' | 'codex' | 'gemini' | string;
}

/**
 * Complete panel state - single source of truth for UI
 */
export interface PanelState {
    sessionFiles: FileInfo[];
    uncommittedFiles: FileInfo[];
    showUncommitted: boolean;
    selectedFile: string | null;
    diff: DiffDisplayState | null;
    comments: CommentInfo[];
    aiStatus: AIStatus;
    isTreeView: boolean;
    diffViewMode: DiffViewMode;
    searchQuery: string;
}

/**
 * Create initial empty state
 */
export function createInitialPanelState(): PanelState {
    return {
        sessionFiles: [],
        uncommittedFiles: [],
        showUncommitted: false,
        selectedFile: null,
        diff: null,
        comments: [],
        aiStatus: { active: false },
        isTreeView: true,
        diffViewMode: 'preview',
        searchQuery: '',
    };
}
