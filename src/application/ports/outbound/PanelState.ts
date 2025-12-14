import { DiffResult, DiffChunk, DiffLine } from '../../../domain/entities/Diff';
import { ScopeLine } from '../../../domain/entities/ScopedDiff';
import { ScopeInfo } from './ISymbolPort';
import { AgentStatus } from '../../../domain/entities/AISession';

export type DiffViewMode = 'diff' | 'preview' | 'scope';

export type HNFeedStatus = 'idle' | 'loading' | 'error' | 'success';

/**
 * HN story info for panel display (serializable)
 */
export interface HNStoryInfo {
    id: number;
    title: string;
    url: string | null;
    score: number;
    descendants: number;
    by: string;
    time: number;
    domain: string | null;
    discussionUrl: string;
    timeAgo: string;
}

/**
 * File information for panel display
 */
export interface FileInfo {
    path: string;
    name: string;
    status: 'modified' | 'added' | 'deleted';
    /** Agent name attribution for aggregated view */
    agentName?: string;
    /** Color index for agent badge (0-5 for 6-color palette, -1 for multi-agent) */
    agentColorIndex?: number;
    /** Thread ID that last modified this file */
    ownerThreadId?: string;
    /** Thread name for UI badge */
    ownerThreadName?: string;
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
 * Deleted content info for markdown preview
 */
export interface DeletionInfo {
    /** Line number after which this deletion occurred (0 = before first line) */
    afterLine: number;
    /** Deleted content lines */
    content: string[];
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
    /** Full new file content for markdown preview */
    newFileContent?: string;
    /** Line numbers that were added/modified (1-indexed) */
    changedLineNumbers?: number[];
    /** Deleted content with position info */
    deletions?: DeletionInfo[];
}

/**
 * Display state for a scope chunk in scoped diff view
 */
export interface ScopedChunkDisplay {
    scopeId: string;
    scopeName: string;
    scopeKind: string;
    fullName: string;
    hasChanges: boolean;
    isCollapsed: boolean;
    lines: ScopeLine[];
    stats: { additions: number; deletions: number };
    children: ScopedChunkDisplay[];
    depth: number;
}

/**
 * Display state for scoped diff view
 */
export interface ScopedDiffDisplayState {
    file: string;
    scopes: ScopedChunkDisplay[];
    orphanLines: ScopeLine[];
    stats: { additions: number; deletions: number };
    hasScopeData: boolean;
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
 * State for displaying external content (HN articles, URLs) in main panel
 */
export interface ContentViewState {
    /** URL to display in iframe */
    url: string;
    /** Title to show in header */
    title: string;
}

/**
 * Agent display information for multi-agent mode
 */
export interface AgentDisplayInfo {
    name: string;
    status: AgentStatus;
}

/**
 * Draft comment being edited (not yet submitted)
 */
export interface DraftComment {
    file: string;
    startLine: number;
    endLine: number;
    text: string;
}

/**
 * Per-file scroll position storage
 */
export interface FileScrollPositions {
    [filePath: string]: number;
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
    scopedDiff: ScopedDiffDisplayState | null;
    comments: CommentInfo[];
    aiStatus: AIStatus;
    isTreeView: boolean;
    diffViewMode: DiffViewMode;
    searchQuery: string;
    draftComment: DraftComment | null;
    fileScrollPositions: FileScrollPositions;
    hnStories: HNStoryInfo[];
    hnFeedStatus: HNFeedStatus;
    hnFeedError?: string;
    hnLastFetchTime?: number;
    hnHasMore: boolean;
    hnLoadingMore: boolean;
    showHNFeed: boolean;
    /** Active content view state, null when not showing content */
    contentView: ContentViewState | null;
    /** Agent display info (name and status) for multi-agent mode */
    agentInfo?: AgentDisplayInfo;
    /** Whether currently showing aggregated view of all agents */
    isAggregatedView?: boolean;
    /** Thread ID for per-thread comment filtering */
    threadId?: string;
    /** Total number of active threads (for showing thread badges) */
    threadCount: number;
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
        scopedDiff: null,
        comments: [],
        aiStatus: { active: false },
        isTreeView: true,
        diffViewMode: 'diff',
        searchQuery: '',
        draftComment: null,
        fileScrollPositions: {},
        hnStories: [],
        hnFeedStatus: 'idle',
        hnFeedError: undefined,
        hnLastFetchTime: undefined,
        hnHasMore: true,
        hnLoadingMore: false,
        showHNFeed: false,
        contentView: null,
        agentInfo: undefined,
        isAggregatedView: false,
        threadCount: 0,
    };
}
