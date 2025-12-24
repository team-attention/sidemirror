import * as vscode from 'vscode';
import { ITerminalPort, TerminalActivityCallback, TerminalOutputCallback, TerminalCommandCallback } from '../../../application/ports/outbound/ITerminalPort';

export class VscodeTerminalGateway implements ITerminalPort {
    private terminals = new Map<string, vscode.Terminal>();
    private terminalToId = new Map<vscode.Terminal, string>();
    private activityCallbacks: TerminalActivityCallback[] = [];
    private outputCallbacks: TerminalOutputCallback[] = [];
    private commandCallbacks: TerminalCommandCallback[] = [];
    private commandEndCallbacks: TerminalCommandCallback[] = [];
    private isActive = new Map<string, boolean>();
    private disposables: vscode.Disposable[] = [];
    private debugChannel: vscode.OutputChannel | undefined;
    // Track pending executions for terminals not yet registered
    private pendingExecutions = new Map<vscode.Terminal, vscode.TerminalShellExecution>();

    // Throttling for terminal output to prevent VSCode crash from high-frequency updates
    private static OUTPUT_THROTTLE_MS = 100;
    private outputBuffers = new Map<string, string>();
    private outputThrottleTimers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor() {
        this.debugChannel = vscode.window.createOutputChannel('Code Squad Terminal');
    }

    log(message: string): void {
        const timestamp = new Date().toISOString().substring(11, 23);
        const line = `[${timestamp}] ${message}`;
        this.debugChannel?.appendLine(line);
    }

    initialize(): void {
        // Listen for terminal shell execution start/end
        this.disposables.push(
            vscode.window.onDidStartTerminalShellExecution((e) => {
                const terminalId = this.terminalToId.get(e.terminal);
                const command = e.execution.commandLine?.value ?? 'unknown';
                if (terminalId) {
                    this.setActivity(terminalId, true);
                    this.notifyCommand(terminalId, command);
                    this.readOutputStream(terminalId, e.execution);
                } else {
                    // Terminal not yet registered - save execution for later
                    this.pendingExecutions.set(e.terminal, e.execution);
                }
            })
        );

        this.disposables.push(
            vscode.window.onDidEndTerminalShellExecution((e) => {
                const terminalId = this.terminalToId.get(e.terminal);
                const command = e.execution.commandLine?.value ?? 'unknown';
                if (terminalId) {
                    this.setActivity(terminalId, false);
                    this.notifyCommandEnd(terminalId, command);
                }
                // Clean up pending execution if it was never picked up
                this.pendingExecutions.delete(e.terminal);
            })
        );
    }

    private async readOutputStream(
        terminalId: string,
        execution: vscode.TerminalShellExecution
    ): Promise<void> {
        try {
            const stream = execution.read();
            for await (const data of stream) {
                this.notifyOutput(terminalId, data);
            }
        } catch {
            // Stream ended or error - ignore
        }
    }

    private notifyOutput(terminalId: string, data: string): void {
        // Accumulate output in buffer
        const currentBuffer = this.outputBuffers.get(terminalId) ?? '';
        this.outputBuffers.set(terminalId, currentBuffer + data);

        // If timer already running, let it handle the accumulated buffer
        if (this.outputThrottleTimers.has(terminalId)) {
            return;
        }

        // Schedule throttled notification
        const timer = setTimeout(() => {
            this.outputThrottleTimers.delete(terminalId);
            const bufferedData = this.outputBuffers.get(terminalId);
            if (bufferedData) {
                this.outputBuffers.delete(terminalId);
                for (const callback of this.outputCallbacks) {
                    try {
                        callback(terminalId, bufferedData);
                    } catch {
                        // Ignore callback errors
                    }
                }
            }
        }, VscodeTerminalGateway.OUTPUT_THROTTLE_MS);

        this.outputThrottleTimers.set(terminalId, timer);
    }

    private setActivity(terminalId: string, hasActivity: boolean): void {
        const wasActive = this.isActive.get(terminalId) ?? false;
        if (wasActive !== hasActivity) {
            this.isActive.set(terminalId, hasActivity);
            this.notifyActivity(terminalId, hasActivity);
        }
    }

    private notifyActivity(terminalId: string, hasActivity: boolean): void {
        for (const callback of this.activityCallbacks) {
            callback(terminalId, hasActivity);
        }
    }

    onTerminalActivity(callback: TerminalActivityCallback): void {
        this.activityCallbacks.push(callback);
    }

    onTerminalOutput(callback: TerminalOutputCallback): void {
        this.outputCallbacks.push(callback);
    }

    onCommandExecuted(callback: TerminalCommandCallback): void {
        this.commandCallbacks.push(callback);
    }

    private notifyCommand(terminalId: string, command: string): void {
        for (const callback of this.commandCallbacks) {
            try {
                callback(terminalId, command);
            } catch {
                // Ignore callback errors
            }
        }
    }

    onCommandEnded(callback: TerminalCommandCallback): void {
        this.commandEndCallbacks.push(callback);
    }

    private notifyCommandEnd(terminalId: string, command: string): void {
        for (const callback of this.commandEndCallbacks) {
            try {
                callback(terminalId, command);
            } catch {
                // Ignore callback errors
            }
        }
    }

    registerTerminal(id: string, terminal: vscode.Terminal): void {
        this.terminals.set(id, terminal);
        this.terminalToId.set(terminal, id);

        // Check for pending execution saved before registration
        // This handles the case when AI CLI is started in a terminal before session registration
        const pendingExecution = this.pendingExecutions.get(terminal);
        if (pendingExecution) {
            this.pendingExecutions.delete(terminal);
            this.setActivity(id, true);
            this.readOutputStream(id, pendingExecution);
        }
    }

    unregisterTerminal(id: string): void {
        const terminal = this.terminals.get(id);
        if (terminal) {
            this.terminalToId.delete(terminal);
        }
        this.terminals.delete(id);

        // Clean up activity tracking
        this.isActive.delete(id);

        // Clean up throttle resources
        const timer = this.outputThrottleTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.outputThrottleTimers.delete(id);
        }

        // Flush remaining data before cleanup
        const bufferedData = this.outputBuffers.get(id);
        if (bufferedData) {
            for (const callback of this.outputCallbacks) {
                try {
                    callback(id, bufferedData);
                } catch {
                    // Ignore callback errors
                }
            }
        }
        this.outputBuffers.delete(id);
    }

    getTerminal(id: string): vscode.Terminal | undefined {
        return this.terminals.get(id);
    }

    /**
     * Get terminal ID from terminal object.
     * Returns undefined if terminal is not registered.
     */
    getTerminalId(terminal: vscode.Terminal): string | undefined {
        return this.terminalToId.get(terminal);
    }

    sendText(terminalId: string, text: string): void {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.sendText(text, false);
            vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
                text: '\r'
            });
        }
    }

    showTerminal(terminalId: string): void {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.show(false); // false = take focus (don't preserve current focus)
            // Explicitly focus the terminal to ensure input focus when clicking from webview
            vscode.commands.executeCommand('workbench.action.terminal.focus').then(undefined, (err) => this.log('Error focusing terminal: ' + err));
        }
    }

    async createTerminal(name: string, cwd?: string, openInPanel?: boolean): Promise<string> {
        const terminal = vscode.window.createTerminal({
            name,
            cwd,
            location: openInPanel ? vscode.TerminalLocation.Panel : { viewColumn: vscode.ViewColumn.One },
        });
        terminal.show();

        // If opening in panel, ensure the panel is visible (user may have hidden it with Cmd+J)
        if (openInPanel) {
            await vscode.commands.executeCommand('workbench.action.terminal.focus');
        }

        const processId = await terminal.processId;
        const terminalId = processId?.toString() ?? `terminal-${Date.now()}`;

        this.registerTerminal(terminalId, terminal);

        return terminalId;
    }

    closeTerminal(terminalId: string): void {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            // First, close the terminal tab if it's opened in editor area
            this.closeTerminalTab(terminal);
            terminal.dispose();
            this.unregisterTerminal(terminalId);
        }
    }

    /**
     * Close the terminal tab if the terminal is opened in editor area.
     * When terminal is created with viewColumn (not Panel location),
     * it opens as an editor tab that needs to be explicitly closed.
     */
    private closeTerminalTab(terminal: vscode.Terminal): void {
        const terminalName = terminal.name;
        // Find and close the tab associated with this terminal
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                // Terminal tabs have TabInputTerminal as their input
                // Match by tab label since TabInputTerminal doesn't expose terminal reference
                if (tab.input instanceof vscode.TabInputTerminal && tab.label === terminalName) {
                    vscode.window.tabGroups.close(tab).then(undefined, (err) => {
                        this.log(`Failed to close terminal tab: ${err}`);
                    });
                    return;
                }
            }
        }
    }
}
