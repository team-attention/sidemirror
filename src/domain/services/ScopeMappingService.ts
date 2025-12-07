import { DiffResult, DiffLine } from '../entities/Diff';
import { Scope, ScopeData } from '../entities/Scope';
import { ScopedDiffResult, ScopedChunk, ScopeLine } from '../entities/ScopedDiff';

/**
 * Scope info from LSP (flat structure)
 */
export interface ScopeInfo {
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    containerName?: string;
}

/**
 * Maps diff results to their containing code scopes
 */
export class ScopeMappingService {
    /**
     * Map diff result to scoped structure with full file content
     * @param diff - Diff result containing changed lines
     * @param scopes - Scope information from LSP
     * @param fileContent - Full content of the current file (optional)
     */
    mapDiffToScopes(
        diff: DiffResult,
        scopes: ScopeInfo[],
        fileContent?: string
    ): ScopedDiffResult {
        // Without file content, we can't show full scope view - fall back
        if (!fileContent || scopes.length === 0) {
            return {
                file: diff.file,
                root: [],
                orphanLines: this.collectAllScopeLines(diff, fileContent),
                stats: diff.stats,
                hasScopeData: false,
            };
        }

        const fileLines = fileContent.split('\n');
        const scopeTree = this.buildScopeTree(scopes);
        const diffInfo = this.buildDiffLineMap(diff);
        const { scopedChunks, orphanLines } = this.mapLinesToScopes(
            diff,
            scopeTree,
            fileLines,
            diffInfo
        );

        return {
            file: diff.file,
            root: scopedChunks,
            orphanLines,
            stats: diff.stats,
            hasScopeData: true,
        };
    }

    /**
     * Build hierarchical scope tree from flat list
     */
    buildScopeTree(scopes: ScopeInfo[]): Scope[] {
        // Sort by start line, then by size (larger scopes first for proper nesting)
        const sorted = [...scopes].sort((a, b) => {
            if (a.startLine !== b.startLine) {
                return a.startLine - b.startLine;
            }
            // Larger scopes (more lines) should come first
            return (b.endLine - b.startLine) - (a.endLine - a.startLine);
        });

        const result: Scope[] = [];
        const stack: { scope: Scope; endLine: number }[] = [];

        for (const info of sorted) {
            // Pop scopes that have ended before this one starts
            while (stack.length > 0 && stack[stack.length - 1].endLine < info.startLine) {
                stack.pop();
            }

            const scopeData: ScopeData = {
                name: info.name,
                kind: info.kind,
                startLine: info.startLine,
                endLine: info.endLine,
                containerName: info.containerName,
                children: [],
            };

            const scope = new Scope(scopeData);

            if (stack.length > 0) {
                // This scope is nested inside the top of stack
                // We need to mutate the children array
                const parent = stack[stack.length - 1].scope;
                (parent as { children: Scope[] }).children = [...parent.children, scope];
            } else {
                result.push(scope);
            }

            // Only push to stack if this scope has range for potential children
            if (info.endLine > info.startLine) {
                stack.push({ scope, endLine: info.endLine });
            }
        }

        return result;
    }

    /**
     * Build a map of NEW file line numbers to their diff status (additions only)
     * Deletions are collected separately since they use OLD file line numbers
     */
    private buildDiffLineMap(diff: DiffResult): {
        additions: Map<number, DiffLine>;
        deletions: DiffLine[];
    } {
        const additions = new Map<number, DiffLine>();
        const deletions: DiffLine[] = [];

        for (const chunk of diff.chunks) {
            for (const line of chunk.lines) {
                if (line.type === 'addition' && line.newLineNumber !== undefined) {
                    additions.set(line.newLineNumber, line);
                } else if (line.type === 'deletion') {
                    deletions.push(line);
                }
            }
        }

        return { additions, deletions };
    }

    private mapLinesToScopes(
        diff: DiffResult,
        scopeTree: Scope[],
        fileLines: string[],
        diffInfo: { additions: Map<number, DiffLine>; deletions: DiffLine[] }
    ): { scopedChunks: ScopedChunk[]; orphanLines: ScopeLine[] } {
        // Build scoped chunks from the tree with full file content
        const scopedChunks = this.buildScopedChunks(
            scopeTree,
            fileLines,
            diffInfo.additions
        );

        // Collect orphan lines (lines outside all scopes)
        const orphanLines = this.collectOrphanLines(
            scopeTree,
            fileLines,
            diffInfo.additions
        );

        return { scopedChunks, orphanLines };
    }

    private buildScopedChunks(
        scopes: Scope[],
        fileLines: string[],
        additions: Map<number, DiffLine>
    ): ScopedChunk[] {
        const result: ScopedChunk[] = [];

        for (const scope of scopes) {
            const children = this.buildScopedChunks(
                scope.children,
                fileLines,
                additions
            );

            // Get child line ranges to exclude from this scope's direct lines
            const childRanges = scope.children.map((c) => ({
                start: c.startLine,
                end: c.endLine,
            }));

            // Build lines for this scope (excluding child ranges)
            const lines = this.buildScopeLines(
                scope.startLine,
                scope.endLine,
                fileLines,
                additions,
                childRanges
            );

            const stats = this.calculateScopeLineStats(lines);
            const childStats = this.aggregateChildStats(children);
            const totalStats = {
                additions: stats.additions + childStats.additions,
                deletions: stats.deletions + childStats.deletions,
            };

            const hasChanges = totalStats.additions > 0 || totalStats.deletions > 0;

            result.push({
                scope,
                lines,
                hasChanges,
                stats: totalStats,
                children,
            });
        }

        return result;
    }

    /**
     * Build ScopeLines for a given line range, excluding lines that belong to children
     * Shows NEW file content with additions highlighted
     */
    private buildScopeLines(
        startLine: number,
        endLine: number,
        fileLines: string[],
        additions: Map<number, DiffLine>,
        childRanges: { start: number; end: number }[]
    ): ScopeLine[] {
        const lines: ScopeLine[] = [];

        for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
            // Skip lines that belong to child scopes
            const isInChildScope = childRanges.some(
                (r) => lineNum >= r.start && lineNum <= r.end
            );
            if (isInChildScope) continue;

            this.addScopeLine(lines, lineNum, fileLines, additions);
        }

        return lines;
    }

    private addScopeLine(
        lines: ScopeLine[],
        lineNum: number,
        fileLines: string[],
        additions: Map<number, DiffLine>
    ): void {
        // Skip if line doesn't exist in file
        if (fileLines[lineNum - 1] === undefined) return;

        // Check if this line is an addition or context
        const additionLine = additions.get(lineNum);
        if (additionLine) {
            lines.push({
                lineNumber: lineNum,
                content: fileLines[lineNum - 1],
                type: 'addition',
                diffLine: additionLine,
            });
        } else {
            // Regular context line from file
            lines.push({
                lineNumber: lineNum,
                content: fileLines[lineNum - 1],
                type: 'context',
            });
        }
    }

    /**
     * Collect lines that are outside all scopes
     */
    private collectOrphanLines(
        scopeTree: Scope[],
        fileLines: string[],
        additions: Map<number, DiffLine>
    ): ScopeLine[] {
        const scopeRanges = this.collectAllScopeRanges(scopeTree);
        const orphanLines: ScopeLine[] = [];

        for (let lineNum = 1; lineNum <= fileLines.length; lineNum++) {
            const isInScope = scopeRanges.some(
                (r) => lineNum >= r.start && lineNum <= r.end
            );
            if (isInScope) continue;

            // Check for addition or context
            const additionLine = additions.get(lineNum);
            if (additionLine) {
                orphanLines.push({
                    lineNumber: lineNum,
                    content: fileLines[lineNum - 1],
                    type: 'addition',
                    diffLine: additionLine,
                });
            } else {
                orphanLines.push({
                    lineNumber: lineNum,
                    content: fileLines[lineNum - 1],
                    type: 'context',
                });
            }
        }

        return orphanLines;
    }

    private collectAllScopeRanges(
        scopes: Scope[]
    ): { start: number; end: number }[] {
        const ranges: { start: number; end: number }[] = [];
        for (const scope of scopes) {
            ranges.push({ start: scope.startLine, end: scope.endLine });
            ranges.push(...this.collectAllScopeRanges(scope.children));
        }
        return ranges;
    }

    private calculateScopeLineStats(
        lines: ScopeLine[]
    ): { additions: number; deletions: number } {
        let additions = 0;
        let deletions = 0;

        for (const line of lines) {
            if (line.type === 'addition') {
                additions++;
            } else if (line.type === 'deletion') {
                deletions++;
            }
        }

        return { additions, deletions };
    }

    private aggregateChildStats(
        children: ScopedChunk[]
    ): { additions: number; deletions: number } {
        return children.reduce(
            (acc, child) => ({
                additions: acc.additions + child.stats.additions,
                deletions: acc.deletions + child.stats.deletions,
            }),
            { additions: 0, deletions: 0 }
        );
    }

    /**
     * Fallback: collect all diff lines as ScopeLines when no scope data or file content
     */
    private collectAllScopeLines(
        diff: DiffResult,
        fileContent?: string
    ): ScopeLine[] {
        const lines: ScopeLine[] = [];

        // If we have file content, show full file with additions highlighted
        if (fileContent) {
            const fileLines = fileContent.split('\n');
            const { additions } = this.buildDiffLineMap(diff);

            for (let lineNum = 1; lineNum <= fileLines.length; lineNum++) {
                const additionLine = additions.get(lineNum);
                if (additionLine) {
                    lines.push({
                        lineNumber: lineNum,
                        content: fileLines[lineNum - 1],
                        type: 'addition',
                        diffLine: additionLine,
                    });
                } else {
                    lines.push({
                        lineNumber: lineNum,
                        content: fileLines[lineNum - 1],
                        type: 'context',
                    });
                }
            }
        } else {
            // No file content - just show diff lines from chunks
            for (const chunk of diff.chunks) {
                for (const line of chunk.lines) {
                    const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0;
                    lines.push({
                        lineNumber: lineNum,
                        content: line.content,
                        type: line.type,
                        diffLine: line,
                    });
                }
            }
        }

        return lines;
    }
}
