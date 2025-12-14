import * as vscode from 'vscode';
import { ITerminalPort, TerminalActivityCallback, TerminalOutputCallback } from '../../../application/ports/outbound/ITerminalPort';

export class VscodeTerminalGateway implements ITerminalPort {
    private terminals = new Map<string, vscode.Terminal>();
    private terminalToId = new Map<vscode.Terminal, string>();
    private activityCallbacks: TerminalActivityCallback[] = [];
    private outputCallbacks: TerminalOutputCallback[] = [];
    private isActive = new Map<string, boolean>();
    private disposables: vscode.Disposable[] = [];
    private debugChannel: vscode.OutputChannel | undefined;

    constructor() {
        this.debugChannel = vscode.window.createOutputChannel('Sidecar Terminal');
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString().substring(11, 23);
        const line = `[${timestamp}] ${message}`;
        this.debugChannel?.appendLine(line);
    }

    initialize(): void {
        this.log('🚀 VscodeTerminalGateway initialized');

        // Listen for terminal shell execution start/end
        this.disposables.push(
            vscode.window.onDidStartTerminalShellExecution((e) => {
                const terminalId = this.terminalToId.get(e.terminal);
                const command = e.execution.commandLine?.value ?? 'unknown';
                this.log(`🔵 Shell execution started: terminal=${e.terminal.name}, id=${terminalId}, cmd="${command.substring(0, 50)}"`);
                if (terminalId) {
                    this.setActivity(terminalId, true);
                    // Read terminal output stream
                    this.readOutputStream(terminalId, e.execution);
                }
            })
        );

        this.disposables.push(
            vscode.window.onDidEndTerminalShellExecution((e) => {
                const terminalId = this.terminalToId.get(e.terminal);
                this.log(`🔴 Shell execution ended: terminal=${e.terminal.name}, id=${terminalId}, exitCode=${e.exitCode}`);
                if (terminalId) {
                    this.setActivity(terminalId, false);
                }
            })
        );
    }

    private async readOutputStream(
        terminalId: string,
        execution: vscode.TerminalShellExecution
    ): Promise<void> {
        this.log(`📖 readOutputStream started: id=${terminalId}`);
        try {
            const stream = execution.read();
            for await (const data of stream) {
                // Strip ANSI codes for preview
                // eslint-disable-next-line no-control-regex
                const preview = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').substring(0, 80);
                this.log(`📥 Output: id=${terminalId}, len=${data.length}, preview="${preview}"`);
                this.notifyOutput(terminalId, data);
            }
            this.log(`📖 readOutputStream ended: id=${terminalId}`);
        } catch (error) {
            this.log(`❌ readOutputStream error: id=${terminalId}, error=${error}`);
            // Stream ended or error - ignore
        }
    }

    private notifyOutput(terminalId: string, data: string): void {
        for (const callback of this.outputCallbacks) {
            callback(terminalId, data);
        }
    }

    private setActivity(terminalId: string, hasActivity: boolean): void {
        const wasActive = this.isActive.get(terminalId) ?? false;
        if (wasActive !== hasActivity) {
            this.log(`⚡ Activity changed: id=${terminalId}, ${wasActive} → ${hasActivity}`);
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

    registerTerminal(id: string, terminal: vscode.Terminal): void {
        this.terminals.set(id, terminal);
        this.terminalToId.set(terminal, id);
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

    async createTerminal(name: string, cwd?: string): Promise<string> {
        const terminal = vscode.window.createTerminal({
            name,
            cwd,
            location: { viewColumn: vscode.ViewColumn.One },
        });
        terminal.show();

        const processId = await terminal.processId;
        const terminalId = processId?.toString() ?? `terminal-${Date.now()}`;

        this.registerTerminal(terminalId, terminal);

        return terminalId;
    }
}
