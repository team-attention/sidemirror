/**
 * Represents a scope containing a line range
 */
export interface ScopeInfo {
    name: string;
    containerName?: string;
    kind: string;
    startLine: number;
    endLine: number;
}

/**
 * Port for symbol/scope detection via Language Server Protocol
 */
export interface ISymbolPort {
    getEnclosingScope(filePath: string, line: number): Promise<ScopeInfo | null>;
    getScopesForRange(filePath: string, startLine: number, endLine: number): Promise<ScopeInfo[]>;

    /**
     * Get all symbols for entire file.
     * Used for building complete scope hierarchy.
     */
    getAllFileSymbols(filePath: string): Promise<ScopeInfo[]>;
}
