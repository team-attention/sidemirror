import { ITerminalStatusDetector } from '../../domain/services/TerminalStatusDetector';
import { AgentStatus, AIType } from '../../domain/entities/AISession';
import { IDetectThreadStatusUseCase, StatusChangeCallback, AITypeChangeCallback } from '../ports/inbound/IDetectThreadStatusUseCase';

interface TerminalState {
    status: AgentStatus;
    lastUpdate: number;
    idleTimer?: ReturnType<typeof setTimeout>;
    rawBuffer: string;
    toolInProgress: boolean;
    detectedAIType: AIType | null;
}

// Strip ANSI escape codes from text
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;
function stripAnsiCodes(text: string): string {
    return text.replace(ANSI_REGEX, '');
}

// Tool execution patterns - when these appear, Claude is executing a tool
// If no more output follows, it's likely waiting for permission
const TOOL_EXECUTION_PATTERN = /⏺\s*(Write|Bash|Read|Edit|Glob|Grep|MultiEdit|TodoRead|TodoWrite|WebFetch|WebSearch)/;

export class DetectThreadStatusUseCase implements IDetectThreadStatusUseCase {
    private states = new Map<string, TerminalState>();
    private callbacks: StatusChangeCallback[] = [];
    private aiTypeCallbacks: AITypeChangeCallback[] = [];

    // Time to wait after last output before switching to idle
    // Claude outputs every ~100ms when working, so 500ms silence means done
    private static IDLE_TIMEOUT_MS = 500;
    // Buffer only needed for patterns split across chunk boundaries
    // Longest pattern is ~30 chars, so 100 chars is plenty
    private static MAX_BUFFER_SIZE = 100;

    constructor(private detector: ITerminalStatusDetector) {}

    /**
     * Schedule idle/waiting transition after IDLE_TIMEOUT_MS of no output.
     * If a tool was in progress and no completion was seen, assume waiting for permission.
     */
    private scheduleIdleTransition(terminalId: string, state: TerminalState): void {
        state.idleTimer = setTimeout(() => {
            if (state.status !== 'working') {
                return;
            }

            // If tool was in progress and no more output, assume waiting for permission
            if (state.toolInProgress) {
                state.status = 'waiting';
                state.lastUpdate = Date.now();
                this.notifyChange(terminalId, 'waiting');
                return;
            }

            state.status = 'idle';
            state.lastUpdate = Date.now();
            this.notifyChange(terminalId, 'idle');
        }, DetectThreadStatusUseCase.IDLE_TIMEOUT_MS);
    }

    processOutput(terminalId: string, aiType: AIType, output: string): void {
        const state = this.getOrCreateState(terminalId);

        // Auto-detect AI type from output patterns
        const detectedType = this.detector.detectAIType(output);
        if (detectedType && detectedType !== state.detectedAIType) {
            state.detectedAIType = detectedType;
            this.notifyAITypeChange(terminalId, detectedType);
        }

        // Use detected AI type if available, otherwise fall back to provided type
        const effectiveAIType = state.detectedAIType ?? aiType;

        // Check for full screen clear - only keep content AFTER the clear sequence
        // This handles the case when Claude shows a new dialog (file create, etc.)
        // The clear screen sequence is ESC[2J (erase display)
        // eslint-disable-next-line no-control-regex
        const clearScreenRegex = /\x1b\[2J/g;
        let lastClearIndex = -1;
        let match;
        while ((match = clearScreenRegex.exec(output)) !== null) {
            lastClearIndex = match.index + match[0].length;
        }

        let outputToAppend = output;
        if (lastClearIndex !== -1) {
            state.rawBuffer = '';
            outputToAppend = output.slice(lastClearIndex);
        }

        // Strip ANSI codes for pattern matching
        const cleanOutput = stripAnsiCodes(outputToAppend);

        // Check for tool execution pattern - if found, mark tool in progress
        if (TOOL_EXECUTION_PATTERN.test(cleanOutput)) {
            state.toolInProgress = true;
        }

        // Check CURRENT chunk first (handles large outputs with patterns)
        // This ensures we detect patterns even in huge outputs before buffer truncation
        const chunkStatus = this.detector.detect(effectiveAIType, cleanOutput);

        // If pattern found in current chunk, use it immediately
        if (chunkStatus !== 'inactive') {
            // Clear any pending idle timer
            if (state.idleTimer) {
                clearTimeout(state.idleTimer);
                state.idleTimer = undefined;
            }
            // Update buffer with clean output (truncate if needed)
            state.rawBuffer = cleanOutput.length > DetectThreadStatusUseCase.MAX_BUFFER_SIZE
                ? cleanOutput.slice(-DetectThreadStatusUseCase.MAX_BUFFER_SIZE)
                : cleanOutput;

            if (chunkStatus === 'waiting') {
                if (state.status !== 'waiting') {
                    state.status = 'waiting';
                    state.lastUpdate = Date.now();
                    state.toolInProgress = false;
                    this.notifyChange(terminalId, 'waiting');
                }
                return;
            }
            if (chunkStatus === 'idle') {
                if (state.status !== 'idle') {
                    state.status = 'idle';
                    state.lastUpdate = Date.now();
                    state.rawBuffer = '';
                    state.toolInProgress = false;
                    this.notifyChange(terminalId, 'idle');
                }
                return;
            }
            if (chunkStatus === 'working') {
                if (state.status !== 'working') {
                    state.status = 'working';
                    state.lastUpdate = Date.now();
                    this.notifyChange(terminalId, 'working');
                }
                // Schedule idle timeout with re-render
                this.scheduleIdleTransition(terminalId, state);
                return;
            }
        }

        // No pattern in current chunk - accumulate in buffer for chunked patterns
        state.rawBuffer += cleanOutput;
        if (state.rawBuffer.length > DetectThreadStatusUseCase.MAX_BUFFER_SIZE) {
            state.rawBuffer = state.rawBuffer.slice(-DetectThreadStatusUseCase.MAX_BUFFER_SIZE);
        }

        // Clear any pending idle timer
        if (state.idleTimer) {
            clearTimeout(state.idleTimer);
            state.idleTimer = undefined;
        }

        // Check accumulated buffer for patterns split across chunks
        const bufferStatus = this.detector.detect(aiType, state.rawBuffer);

        // waiting = user action required (highest priority)
        if (bufferStatus === 'waiting') {
            if (state.status !== 'waiting') {
                state.status = 'waiting';
                state.lastUpdate = Date.now();
                state.toolInProgress = false;
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
                state.toolInProgress = false;
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
        // Schedule idle check with re-render - if no more output, AI is done
        this.scheduleIdleTransition(terminalId, state);
    }

    getStatus(terminalId: string): AgentStatus {
        return this.states.get(terminalId)?.status ?? 'inactive';
    }

    getAIType(terminalId: string): AIType | null {
        return this.states.get(terminalId)?.detectedAIType ?? null;
    }

    onStatusChange(callback: StatusChangeCallback): void {
        this.callbacks.push(callback);
    }

    onAITypeChange(callback: AITypeChangeCallback): void {
        this.aiTypeCallbacks.push(callback);
    }

    private notifyAITypeChange(terminalId: string, aiType: AIType): void {
        for (const callback of this.aiTypeCallbacks) {
            callback(terminalId, aiType);
        }
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
                toolInProgress: false,
                detectedAIType: null,
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
