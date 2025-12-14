import { ITerminalStatusDetector } from '../../domain/services/TerminalStatusDetector';
import { AgentStatus, AIType } from '../../domain/entities/AISession';
import { IDetectThreadStatusUseCase, StatusChangeCallback } from '../ports/inbound/IDetectThreadStatusUseCase';

interface TerminalState {
    status: AgentStatus;
    buffer: string[];
    lastUpdate: number;
    debounceTimer?: ReturnType<typeof setTimeout>;
}

export class DetectThreadStatusUseCase implements IDetectThreadStatusUseCase {
    private states = new Map<string, TerminalState>();
    private callbacks: StatusChangeCallback[] = [];

    // Time to wait after last output before checking for idle
    private static IDLE_DEBOUNCE_MS = 500;
    private static BUFFER_LINES = 10;

    constructor(private detector: ITerminalStatusDetector) {}

    processOutput(terminalId: string, aiType: AIType, output: string): void {
        const state = this.getOrCreateState(terminalId);

        // Add new lines to buffer
        const newLines = output.split('\n');
        state.buffer.push(...newLines);
        state.buffer = state.buffer.slice(-DetectThreadStatusUseCase.BUFFER_LINES);

        // Activity-based detection: output received = working
        // Set to 'working' immediately if not already working
        if (state.status !== 'working') {
            state.status = 'working';
            state.lastUpdate = Date.now();
            this.notifyChange(terminalId, 'working');
        }

        // Reset debounce timer for idle detection
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
        }

        // After output stops, check for idle/waiting patterns
        state.debounceTimer = setTimeout(() => {
            const detectedStatus = this.detector.detectFromBuffer(aiType, state.buffer);

            // Only transition to idle or waiting (not to 'inactive')
            if (detectedStatus === 'idle' || detectedStatus === 'waiting') {
                if (state.status !== detectedStatus) {
                    state.status = detectedStatus;
                    state.lastUpdate = Date.now();
                    this.notifyChange(terminalId, detectedStatus);
                }
            }
            // If no pattern matched but output stopped, assume still working
            // (might be waiting for slow response)
        }, DetectThreadStatusUseCase.IDLE_DEBOUNCE_MS);
    }

    getStatus(terminalId: string): AgentStatus {
        return this.states.get(terminalId)?.status ?? 'inactive';
    }

    onStatusChange(callback: StatusChangeCallback): void {
        this.callbacks.push(callback);
    }

    clear(terminalId: string): void {
        const state = this.states.get(terminalId);
        if (state?.debounceTimer) {
            clearTimeout(state.debounceTimer);
        }
        this.states.delete(terminalId);
    }

    private getOrCreateState(terminalId: string): TerminalState {
        if (!this.states.has(terminalId)) {
            this.states.set(terminalId, {
                // Start as 'inactive' - actual status determined by pattern detection
                status: 'inactive',
                buffer: [],
                lastUpdate: Date.now(),
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
