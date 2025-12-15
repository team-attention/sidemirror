import { ITerminalStatusDetector } from '../../domain/services/TerminalStatusDetector';
import { AgentStatus, AIType } from '../../domain/entities/AISession';
import { IDetectThreadStatusUseCase, StatusChangeCallback } from '../ports/inbound/IDetectThreadStatusUseCase';

interface TerminalState {
    status: AgentStatus;
    lastUpdate: number;
    idleTimer?: ReturnType<typeof setTimeout>;
    rawBuffer: string;
}

export class DetectThreadStatusUseCase implements IDetectThreadStatusUseCase {
    private states = new Map<string, TerminalState>();
    private callbacks: StatusChangeCallback[] = [];

    // Time to wait after last output before switching to idle
    // Claude outputs every ~100ms when working, so 500ms silence means done
    private static IDLE_TIMEOUT_MS = 500;
    // Max characters to keep in raw buffer for pattern matching
    private static MAX_BUFFER_SIZE = 2000;

    constructor(private detector: ITerminalStatusDetector) {}

    processOutput(terminalId: string, aiType: AIType, output: string): void {
        const state = this.getOrCreateState(terminalId);

        // Append to raw buffer
        state.rawBuffer += output;
        // Keep only the last MAX_BUFFER_SIZE characters
        if (state.rawBuffer.length > DetectThreadStatusUseCase.MAX_BUFFER_SIZE) {
            state.rawBuffer = state.rawBuffer.slice(-DetectThreadStatusUseCase.MAX_BUFFER_SIZE);
        }


        // Clear any pending idle timer
        if (state.idleTimer) {
            clearTimeout(state.idleTimer);
            state.idleTimer = undefined;
        }

        // Check buffer for patterns (accumulated context handles chunked output)
        const bufferStatus = this.detector.detect(aiType, state.rawBuffer);

        // waiting = user action required (highest priority)
        if (bufferStatus === 'waiting') {
            if (state.status !== 'waiting') {
                state.status = 'waiting';
                state.lastUpdate = Date.now();
                this.notifyChange(terminalId, 'waiting');
            }
            return;
        }

        // idle pattern found = AI ready for input
        if (bufferStatus === 'idle') {
            if (state.status !== 'idle') {
                state.status = 'idle';
                state.lastUpdate = Date.now();
                // Clear buffer to remove old patterns
                state.rawBuffer = '';
                this.notifyChange(terminalId, 'idle');
            }
            return;
        }

        // Output received but no idle/waiting pattern = working
        if (state.status !== 'working') {
            state.status = 'working';
            state.lastUpdate = Date.now();
            this.notifyChange(terminalId, 'working');
        }
        // Schedule idle check - if no more output, AI is done
        state.idleTimer = setTimeout(() => {
            if (state.status === 'working') {
                state.status = 'idle';
                state.lastUpdate = Date.now();
                this.notifyChange(terminalId, 'idle');
            }
        }, DetectThreadStatusUseCase.IDLE_TIMEOUT_MS);
    }

    getStatus(terminalId: string): AgentStatus {
        return this.states.get(terminalId)?.status ?? 'inactive';
    }

    onStatusChange(callback: StatusChangeCallback): void {
        this.callbacks.push(callback);
    }

    clear(terminalId: string): void {
        const state = this.states.get(terminalId);
        if (state?.idleTimer) {
            clearTimeout(state.idleTimer);
        }
        this.states.delete(terminalId);
    }

    private getOrCreateState(terminalId: string): TerminalState {
        if (!this.states.has(terminalId)) {
            this.states.set(terminalId, {
                status: 'inactive',
                lastUpdate: Date.now(),
                rawBuffer: '',
            });
        }
        return this.states.get(terminalId)!;
    }

    private notifyChange(terminalId: string, status: AgentStatus): void {
        for (const callback of this.callbacks) {
            callback(terminalId, status);
        }
    }
}
