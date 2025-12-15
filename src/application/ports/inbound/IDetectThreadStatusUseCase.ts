import { AgentStatus, AIType } from '../../../domain/entities/AISession';

export interface StatusChangeCallback {
    (terminalId: string, status: AgentStatus): void;
}

export interface AITypeChangeCallback {
    (terminalId: string, aiType: AIType): void;
}

export interface IDetectThreadStatusUseCase {
    processOutput(terminalId: string, aiType: AIType, output: string): void;
    getStatus(terminalId: string): AgentStatus;
    getAIType(terminalId: string): AIType | null;
    onStatusChange(callback: StatusChangeCallback): void;
    onAITypeChange(callback: AITypeChangeCallback): void;
    clear(terminalId: string): void;
}
