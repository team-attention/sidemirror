export interface ThreadStateData {
    threadId: string;
    name: string;
    terminalId: string;
    workingDir: string;
    branch?: string;
    worktreePath?: string;
    whitelistPatterns: string[];
    createdAt: number;
}

export class ThreadState {
    readonly threadId: string;
    readonly name: string;
    readonly terminalId: string;
    readonly workingDir: string;
    readonly branch?: string;
    readonly worktreePath?: string;
    private _whitelistPatterns: string[];
    readonly createdAt: number;

    private constructor(data: ThreadStateData) {
        this.threadId = data.threadId;
        this.name = data.name;
        this.terminalId = data.terminalId;
        this.workingDir = data.workingDir;
        this.branch = data.branch;
        this.worktreePath = data.worktreePath;
        this._whitelistPatterns = [...data.whitelistPatterns];
        this.createdAt = data.createdAt;
    }

    static create(data: Omit<ThreadStateData, 'threadId' | 'createdAt'>): ThreadState {
        return new ThreadState({
            ...data,
            threadId: generateUUID(),
            createdAt: Date.now(),
        });
    }

    static fromData(data: ThreadStateData): ThreadState {
        return new ThreadState(data);
    }

    get whitelistPatterns(): string[] {
        return [...this._whitelistPatterns];
    }

    addWhitelistPattern(pattern: string): void {
        if (!this._whitelistPatterns.includes(pattern)) {
            this._whitelistPatterns.push(pattern);
        }
    }

    removeWhitelistPattern(pattern: string): void {
        const index = this._whitelistPatterns.indexOf(pattern);
        if (index !== -1) {
            this._whitelistPatterns.splice(index, 1);
        }
    }

    hasWhitelistPattern(pattern: string): boolean {
        return this._whitelistPatterns.includes(pattern);
    }

    /**
     * Create a new ThreadState with updated name.
     * @param newName - New name (1-50 chars, alphanumeric/hyphens/underscores/slashes)
     * @throws Error if name is empty or exceeds 50 characters
     */
    withName(newName: string): ThreadState {
        if (!newName || newName.length === 0) {
            throw new Error('Thread name cannot be empty');
        }
        if (newName.length > 50) {
            throw new Error('Thread name cannot exceed 50 characters');
        }
        return new ThreadState({
            ...this.toData(),
            name: newName,
        });
    }

    /**
     * Create a new ThreadState with updated branch.
     * @param newBranch - New branch name
     * @throws Error if branch is empty
     */
    withBranch(newBranch: string): ThreadState {
        if (!newBranch || newBranch.length === 0) {
            throw new Error('Branch name cannot be empty');
        }
        return new ThreadState({
            ...this.toData(),
            branch: newBranch,
        });
    }

    toData(): ThreadStateData {
        return {
            threadId: this.threadId,
            name: this.name,
            terminalId: this.terminalId,
            workingDir: this.workingDir,
            branch: this.branch,
            worktreePath: this.worktreePath,
            whitelistPatterns: [...this._whitelistPatterns],
            createdAt: this.createdAt,
        };
    }
}

function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
