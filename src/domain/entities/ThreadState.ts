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
