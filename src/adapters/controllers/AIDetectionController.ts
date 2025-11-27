import * as vscode from 'vscode';
import { AISession, AIType } from '../../domain/entities/AISession';
import { ISnapshotRepository } from '../../domain/repositories/ISnapshotRepository';
import { CaptureSnapshotsUseCase } from '../../application/useCases/CaptureSnapshotsUseCase';
import { VscodeTerminalGateway } from '../gateways/VscodeTerminalGateway';
import { SideMirrorPanelAdapter } from '../presenters/SideMirrorPanelAdapter';

export class AIDetectionController {
    private activeAISessions = new Map<string, AISession>();

    constructor(
        private readonly captureSnapshotsUseCase: CaptureSnapshotsUseCase,
        private readonly snapshotRepository: ISnapshotRepository,
        private readonly terminalGateway: VscodeTerminalGateway,
        private readonly getExtensionContext: () => vscode.ExtensionContext
    ) {}

    activate(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.window.onDidStartTerminalShellExecution(event => {
                this.handleCommandStart(event);
            })
        );

        context.subscriptions.push(
            vscode.window.onDidEndTerminalShellExecution(event => {
                this.handleCommandEnd(event);
            })
        );

        context.subscriptions.push(
            vscode.window.onDidCloseTerminal(terminal => {
                this.handleTerminalClose(terminal);
            })
        );
    }

    private async handleCommandStart(
        event: vscode.TerminalShellExecutionStartEvent
    ): Promise<void> {
        try {
            const commandLine = event.execution.commandLine.value;
            const terminal = event.terminal;
            const terminalId = this.getTerminalId(terminal);

            // Skip if already have an active session for this terminal
            if (this.activeAISessions.has(terminalId)) {
                return;
            }

            if (this.isClaudeCommand(commandLine)) {
                console.log('Claude Code detected!');
                await this.activateSideMirror('claude', terminal);
            } else if (this.isCodexCommand(commandLine)) {
                console.log('Codex detected!');
                await this.activateSideMirror('codex', terminal);
            } else if (this.isGeminiCommand(commandLine)) {
                console.log('Gemini CLI detected!');
                await this.activateSideMirror('gemini', terminal);
            }
        } catch (error) {
            console.error('Error in handleCommandStart:', error);
        }
    }

    private isClaudeCommand(commandLine: string): boolean {
        return /\bclaude(-code)?\b/.test(commandLine);
    }

    private isCodexCommand(commandLine: string): boolean {
        return /\bcodex\b/.test(commandLine);
    }

    private isGeminiCommand(commandLine: string): boolean {
        const normalized = commandLine.toLowerCase();
        return (
            /\bgemini\b/.test(normalized) ||
            /@google\/generative-ai-cli/.test(normalized) ||
            /\bgcloud\s+ai\s+gemini\b/.test(normalized)
        );
    }

    private async activateSideMirror(type: AIType, terminal: vscode.Terminal): Promise<void> {
        const terminalId = this.getTerminalId(terminal);

        try {
            const config = vscode.workspace.getConfiguration('sidemirror');
            const includePatterns = config.get<string[]>('includeFiles', []);
            await this.captureSnapshotsUseCase.execute(includePatterns);
        } catch (error) {
            console.error('Failed to capture snapshots:', error);
        }

        await this.moveTerminalToSide();

        await vscode.commands.executeCommand('sidemirror.showPanel');

        const session = AISession.create(type, terminalId);
        this.activeAISessions.set(terminalId, session);
        this.terminalGateway.registerTerminal(terminalId, terminal);

        vscode.window.showInformationMessage(
            `${session.displayName} detected! SideMirror is now active.`,
            'Show Panel'
        ).then(action => {
            if (action === 'Show Panel') {
                vscode.commands.executeCommand('sidemirror.focusPanel');
            }
        });

        if (SideMirrorPanelAdapter.currentPanel) {
            SideMirrorPanelAdapter.currentPanel.updateAIType(type);
        }
    }

    private getTerminalId(terminal: vscode.Terminal): string {
        return `terminal-${terminal.processId || Date.now()}`;
    }

    private async moveTerminalToSide(): Promise<void> {
        // Skip if panel is already open to avoid terminal showing on every Claude command
        if (SideMirrorPanelAdapter.currentPanel) {
            return;
        }

        try {
            await vscode.commands.executeCommand('workbench.action.terminal.moveIntoEditor');
            await vscode.commands.executeCommand('workbench.action.moveEditorToRightGroup');
        } catch {
            console.log('Terminal move command not available, continuing with default layout');
        }
    }

    private handleCommandEnd(event: vscode.TerminalShellExecutionEndEvent): void {
        const terminalId = this.getTerminalId(event.terminal);
        const session = this.activeAISessions.get(terminalId);

        if (session) {
            console.log(`AI session ended: ${session.type}`);
        }
    }

    private handleTerminalClose(terminal: vscode.Terminal): void {
        const terminalId = this.getTerminalId(terminal);
        const session = this.activeAISessions.get(terminalId);

        if (session) {
            console.log(`AI terminal closed: ${session.type}`);
            this.activeAISessions.delete(terminalId);
            this.terminalGateway.unregisterTerminal(terminalId);

            if (this.activeAISessions.size === 0) {
                this.snapshotRepository.clear();
                vscode.window.showInformationMessage(
                    'No active AI sessions. SideMirror panel will remain open.'
                );
            }
        }
    }

    getActiveSession(terminal?: vscode.Terminal): AISession | undefined {
        if (terminal) {
            const terminalId = this.getTerminalId(terminal);
            return this.activeAISessions.get(terminalId);
        }

        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
            const terminalId = this.getTerminalId(activeTerminal);
            return this.activeAISessions.get(terminalId);
        }

        const sessions = Array.from(this.activeAISessions.values());
        return sessions[sessions.length - 1];
    }
}
