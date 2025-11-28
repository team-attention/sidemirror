import * as vscode from 'vscode';
import * as path from 'path';
import { AISession, AIType } from '../../../domain/entities/AISession';
import { ISnapshotRepository } from '../../../application/ports/outbound/ISnapshotRepository';
import { ICaptureSnapshotsUseCase } from '../../../application/ports/inbound/ICaptureSnapshotsUseCase';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { IFileGlobber } from '../../../application/ports/outbound/IFileGlobber';
import { FileInfo } from '../../../application/ports/outbound/PanelState';
import { VscodeTerminalGateway } from '../../outbound/gateways/VscodeTerminalGateway';
import { SidecarPanelAdapter } from '../ui/SidecarPanelAdapter';

export class AIDetectionController {
    private activeAISessions = new Map<string, AISession>();
    private panelStateManager: IPanelStateManager | undefined;

    constructor(
        private readonly captureSnapshotsUseCase: ICaptureSnapshotsUseCase,
        private readonly snapshotRepository: ISnapshotRepository,
        private readonly terminalGateway: VscodeTerminalGateway,
        private readonly getExtensionContext: () => vscode.ExtensionContext,
        private readonly gitPort: IGitPort,
        private readonly fileGlobber: IFileGlobber
    ) {}

    setPanelStateManager(panelStateManager: IPanelStateManager): void {
        this.panelStateManager = panelStateManager;
    }

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
                await this.activateSidecar('claude', terminal);
            } else if (this.isCodexCommand(commandLine)) {
                console.log('Codex detected!');
                await this.activateSidecar('codex', terminal);
            } else if (this.isGeminiCommand(commandLine)) {
                console.log('Gemini CLI detected!');
                await this.activateSidecar('gemini', terminal);
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

    private async activateSidecar(type: AIType, terminal: vscode.Terminal): Promise<void> {
        const terminalId = this.getTerminalId(terminal);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        try {
            const config = vscode.workspace.getConfiguration('sidecar');
            const includePatterns = config.get<string[]>('includeFiles', []);
            await this.captureSnapshotsUseCase.execute(includePatterns);
        } catch (error) {
            console.error('Failed to capture snapshots:', error);
        }

        if (workspaceRoot && this.panelStateManager) {
            await this.captureBaseline(workspaceRoot);
        }

        await this.moveTerminalToSide();

        await vscode.commands.executeCommand('sidecar.showPanel');

        const session = AISession.create(type, terminalId);
        this.activeAISessions.set(terminalId, session);
        this.terminalGateway.registerTerminal(terminalId, terminal);

        vscode.window.showInformationMessage(
            `${session.displayName} detected! Sidecar is now active.`,
            'Show Panel'
        ).then(action => {
            if (action === 'Show Panel') {
                vscode.commands.executeCommand('sidecar.focusPanel');
            }
        });

        if (this.panelStateManager) {
            this.panelStateManager.setAIStatus({ active: true, type });
        }
    }

    private getTerminalId(terminal: vscode.Terminal): string {
        return `terminal-${terminal.processId || Date.now()}`;
    }

    private async moveTerminalToSide(): Promise<void> {
        // Skip if panel is already open to avoid terminal showing on every Claude command
        if (SidecarPanelAdapter.currentPanel) {
            return;
        }

        try {
            await vscode.commands.executeCommand('workbench.action.terminal.moveIntoEditor');
            await vscode.commands.executeCommand('workbench.action.moveEditorToRightGroup');
        } catch {
            console.log('Terminal move command not available, continuing with default layout');
        }
    }

    private async captureBaseline(workspaceRoot: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('sidecar');
            const includePatterns = config.get<string[]>('includeFiles', []);

            const gitFiles = await this.gitPort.getUncommittedFiles(workspaceRoot);

            let configFiles: string[] = [];
            if (includePatterns.length > 0) {
                const globResults = await Promise.all(
                    includePatterns.map((pattern) => this.fileGlobber.glob(pattern, workspaceRoot))
                );
                const absolutePaths = globResults.flat();
                configFiles = absolutePaths.map((absPath) =>
                    path.relative(workspaceRoot, absPath)
                );
            }

            const allPaths = new Set([...gitFiles, ...configFiles]);

            const baselineFiles: FileInfo[] = Array.from(allPaths).map((filePath) => ({
                path: filePath,
                name: path.basename(filePath),
                status: 'modified' as const,
            }));

            this.panelStateManager!.setBaseline(baselineFiles);

            console.log(`Baseline captured: ${baselineFiles.length} files`);
        } catch (error) {
            console.error('Failed to capture baseline:', error);
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

                if (this.panelStateManager) {
                    this.panelStateManager.reset();
                }

                if (SidecarPanelAdapter.currentPanel) {
                    SidecarPanelAdapter.currentPanel.dispose();
                }

                console.log('AI session ended, panel closed');
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
