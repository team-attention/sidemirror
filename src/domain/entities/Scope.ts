/**
 * Data interface for creating a Scope
 */
export interface ScopeData {
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    containerName?: string;
    children?: ScopeData[];
}

/**
 * Represents a code scope (function, method, class, etc.)
 * Used for scope-based diff visualization
 */
export class Scope {
    readonly name: string;
    readonly kind: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly containerName?: string;
    readonly children: Scope[];

    constructor(data: ScopeData) {
        this.name = data.name;
        this.kind = data.kind;
        this.startLine = data.startLine;
        this.endLine = data.endLine;
        this.containerName = data.containerName;
        this.children = (data.children || []).map((c) => new Scope(c));
    }

    /**
     * Check if this scope contains the given line number
     */
    containsLine(line: number): boolean {
        return line >= this.startLine && line <= this.endLine;
    }

    /**
     * Check if this scope overlaps with the given range
     * Returns true for any overlap (partial or full)
     */
    containsRange(start: number, end: number): boolean {
        return this.startLine <= end && this.endLine >= start;
    }

    /**
     * Get the full qualified name including container
     */
    get fullName(): string {
        return this.containerName ? `${this.containerName}.${this.name}` : this.name;
    }

    /**
     * Get display name with appropriate suffix for methods/functions
     */
    get displayName(): string {
        const suffix = this.kind === 'method' || this.kind === 'function' ? '()' : '';
        return `${this.name}${suffix}`;
    }

    /**
     * Convert back to plain data object
     */
    toData(): ScopeData {
        return {
            name: this.name,
            kind: this.kind,
            startLine: this.startLine,
            endLine: this.endLine,
            containerName: this.containerName,
            children: this.children.map((c) => c.toData()),
        };
    }
}
