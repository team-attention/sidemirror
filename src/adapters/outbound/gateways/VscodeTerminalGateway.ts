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
        for (const callback of this.outputCallbacks) {
            try {
                callback(terminalId, data);
            } catch {
                // Ignore callback errors
            }
        }
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
            terminal.show();
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
            terminal.dispose();
            this.unregisterTerminal(terminalId);
        }
    }
}
