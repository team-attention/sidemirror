export type AIType = 'claude' | 'codex' | 'gemini';

export interface AISessionData {
    type: AIType;
    terminalId: string;
    startTime: number;
}

export class AISession {
    readonly type: AIType;
    readonly terminalId: string;
    readonly startTime: number;

    constructor(data: AISessionData) {
        this.type = data.type;
        this.terminalId = data.terminalId;
        this.startTime = data.startTime;
    }

    get displayName(): string {
        if (this.type === 'claude') return 'Claude';
        if (this.type === 'codex') return 'Codex';
        return 'Gemini';
    }

    static create(type: AIType, terminalId: string): AISession {
        return new AISession({
            type,
            terminalId,
            startTime: Date.now(),
        });
    }
}
