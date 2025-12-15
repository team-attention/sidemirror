export type AIType = 'claude' | 'codex' | 'gemini';

export type AgentStatus = 'inactive' | 'idle' | 'working' | 'waiting';

export interface AgentMetadata {
    name: string;
    role?: string;
    status: AgentStatus;
    fileCount: number;
}

export interface AISessionData {
    type: AIType;
    terminalId: string;
    startTime: number;
}

export class AISession {
    private _type: AIType;
    readonly terminalId: string;
    readonly startTime: number;
    private _agentMetadata?: AgentMetadata;

    constructor(data: AISessionData) {
        this._type = data.type;
        this.terminalId = data.terminalId;
        this.startTime = data.startTime;
    }

    get type(): AIType {
        return this._type;
    }

    /**
     * Update the AI type for this session.
     * Used when AI type is detected from command execution or output patterns.
     */
    updateType(newType: AIType): void {
        this._type = newType;
    }

    get displayName(): string {
        if (this.type === 'claude') return 'Claude';
        if (this.type === 'codex') return 'Codex';
        return 'Gemini';
    }

    get agentMetadata(): AgentMetadata | undefined {
        return this._agentMetadata;
    }

    setAgentMetadata(metadata: AgentMetadata): void {
        this._agentMetadata = metadata;
    }

    get agentName(): string {
        return this._agentMetadata?.name ?? this.displayName;
    }

    get agentStatus(): AgentStatus {
        return this._agentMetadata?.status ?? 'inactive';
    }

    static create(type: AIType, terminalId: string): AISession {
        return new AISession({
            type,
            terminalId,
            startTime: Date.now(),
        });
    }

    static getDisplayName(type: AIType): string {
        if (type === 'claude') return 'Claude';
        if (type === 'codex') return 'Codex';
        return 'Gemini';
    }
}
