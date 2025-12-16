export type TerminalActivityCallback = (terminalId: string, hasActivity: boolean) => void;
export type TerminalOutputCallback = (terminalId: string, data: string) => void;
export type TerminalCommandCallback = (terminalId: string, command: string) => void;

export interface ITerminalPort {
    initialize(): void;
    sendText(terminalId: string, text: string): void;
    showTerminal(terminalId: string): void;
    createTerminal(name: string, cwd?: string, openInPanel?: boolean): Promise<string>;
    /**
     * Register a callback to receive terminal activity notifications.
     * Called with hasActivity=true when terminal is writing output (AI running).
     * Called with hasActivity=false after a period of inactivity (AI idle).
     */
    onTerminalActivity(callback: TerminalActivityCallback): void;
    /**
     * Register a callback to receive terminal output data.
     * Called with raw output data from terminal shell execution.
     * Requires shell integration enabled in the terminal.
     */
    onTerminalOutput(callback: TerminalOutputCallback): void;
    /**
     * Register a callback to receive command execution notifications.
     * Called when a shell command is executed in the terminal.
     */
    onCommandExecuted(callback: TerminalCommandCallback): void;
    /**
     * Register a callback to receive command completion notifications.
     * Called when a shell command finishes execution.
     * Useful for detecting when AI CLI exits (claude, gemini, codex).
     */
    onCommandEnded(callback: TerminalCommandCallback): void;
    /**
     * Close a terminal by ID.
     * Disposes the terminal instance.
     * No-op if terminal doesn't exist.
     */
    closeTerminal(terminalId: string): void;
}
