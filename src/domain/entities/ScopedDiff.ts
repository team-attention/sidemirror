import { DiffLine } from './Diff';
import { Scope } from './Scope';

/**
 * Represents a line in scoped view (can be from file or diff)
 */
export interface ScopeLine {
    lineNumber: number;
    content: string;
    type: 'context' | 'addition' | 'deletion';
    /** Original diff line if this is a changed line */
    diffLine?: DiffLine;
}

/**
 * Represents a chunk of lines grouped by scope
 * Contains all lines within the scope, not just diff lines
 */
export interface ScopedChunk {
    scope: Scope;
    /** All lines in this scope (from file content + diff changes) */
    lines: ScopeLine[];
    hasChanges: boolean;
    stats: { additions: number; deletions: number };
    children: ScopedChunk[];
}

/**
 * Result of mapping diff to scopes
 */
export interface ScopedDiffResult {
    file: string;
    root: ScopedChunk[];
    orphanLines: ScopeLine[];
    stats: { additions: number; deletions: number };
    hasScopeData: boolean;
}
