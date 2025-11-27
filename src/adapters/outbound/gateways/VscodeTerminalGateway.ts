import * as vscode from 'vscode';
import { ITerminalPort } from '../../../application/ports/outbound/ITerminalPort';

export class VscodeTerminalGateway implements ITerminalPort {
    private terminals = new Map<string, vscode.Terminal>();

    registerTerminal(id: string, terminal: vscode.Terminal): void {
        this.terminals.set(id, terminal);
    }

    unregisterTerminal(id: string): void {
        this.terminals.delete(id);
    }

    getTerminal(id: string): vscode.Terminal | undefined {
        return this.terminals.get(id);
    }

    sendText(terminalId: string, text: string): void {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.sendText(text, true);
        }
    }

    showTerminal(terminalId: string): void {
        const terminal = this.terminals.get(terminalId);
        if (terminal) {
            terminal.show();
        }
    }
}
