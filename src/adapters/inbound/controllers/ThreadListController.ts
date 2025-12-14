import * as vscode from 'vscode';
import * as path from 'path';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { ThreadListWebviewProvider, CreateThreadOptions } from '../ui/ThreadListWebviewProvider';
import { SidecarPanelAdapter } from '../ui/SidecarPanelAdapter';
import { ITerminalPort } from '../../../application/ports/outbound/ITerminalPort';
import { ICreateThreadUseCase, IsolationMode } from '../../../application/ports/inbound/ICreateThreadUseCase';
import { FileWatchController } from './FileWatchController';
import { ICommentRepository } from '../../../application/ports/outbound/ICommentRepository';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { FileInfo } from '../../../application/ports/outbound/PanelState';

export class ThreadListController {
    private webviewProvider: ThreadListWebviewProvider | undefined;
    private selectedThreadId: string | null = null; // null = "All Agents"
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly getSessions: () => Map<string, SessionContext>,
        private readonly terminalGateway: ITerminalPort,
        private readonly createThreadUseCase?: ICreateThreadUseCase,
        private readonly attachSidecar?: (terminalId: string) => Promise<void>,
        private readonly fileWatchController?: FileWatchController,
        private readonly commentRepository?: ICommentRepository,
        private readonly gitPort?: IGitPort
    ) {}

    activate(context: vscode.ExtensionContext): void {
        // Create webview provider
        this.webviewProvider = new ThreadListWebviewProvider(
            context.extensionUri,
            this.getSessions,
            (id) => this.selectThread(id),
            (options) => this.createThreadFromInput(options)
        );

        // Register webview view provider
        const registration = vscode.window.registerWebviewViewProvider(
            ThreadListWebviewProvider.viewType,
            this.webviewProvider
        );
        context.subscriptions.push(registration);
        this.disposables.push(registration);

        // Register select command
        this.disposables.push(
            vscode.commands.registerCommand('sidecar.selectThread', async (id: string) => {
                await this.selectThread(id);
            })
        );

        // Set context for keyboard shortcut
        this.updateContextKey();
    }

    /**
     * Select a thread by ID.
     * Applies thread's whitelist patterns and filters comments.
     * Switches the single panel to display this thread's state.
     * Refreshes file list from git status for the thread's workspaceRoot.
     */
    async selectThread(id: string): Promise<void> {
        const sessions = this.getSessions();
        const context = sessions.get(id);

        if (!context) {
            return;
        }

        this.selectedThreadId = id;
        this.webviewProvider?.setSelectedId(id);

        // Set agent info
        const metadata = context.session.agentMetadata;
        if (metadata) {
            context.stateManager.setAgentInfo({
                name: metadata.name,
                status: metadata.status
            });
        }

        // Apply thread whitelist patterns
        const threadState = context.threadState;
        const patterns = threadState?.whitelistPatterns ?? [];
        this.fileWatchController?.setCurrentThread(id, patterns, threadState?.threadId);

        // Set threadId on state manager
        context.stateManager.setThreadId(threadState?.threadId);

        // Determine effective workspaceRoot for this thread
        // Priority: threadState.worktreePath > context.workspaceRoot
        const effectiveWorkspaceRoot = threadState?.worktreePath || context.workspaceRoot;

        // Update generateDiffUseCase to use the correct workspaceRoot
        context.generateDiffUseCase.setWorkspaceRoot(effectiveWorkspaceRoot);

        // Refresh file list from git status for this thread's workspaceRoot
        await this.refreshFilesForSession(context, effectiveWorkspaceRoot);

        // Filter and set comments for this thread
        if (this.commentRepository && threadState) {
            const comments = await this.commentRepository.findByThreadId(threadState.threadId);
            // Also include comments without threadId (backward compatibility)
            const allComments = await this.commentRepository.findActive();
            const legacyComments = allComments.filter(c => !c.threadId);
            const threadComments = [...comments, ...legacyComments];

            context.stateManager.setComments(threadComments.map(c => ({
                id: c.id,
                file: c.file,
                line: c.line,
                endLine: c.endLine,
                text: c.text,
                isSubmitted: c.isSubmitted,
                codeContext: c.codeContext,
                timestamp: c.timestamp,
            })));
        }

        // Show terminal for this session
        this.terminalGateway.showTerminal(id);

        // Switch single panel to this session's context
        const panel = SidecarPanelAdapter.currentPanel;
        if (panel) {
            panel.switchToSession(
                id,
                effectiveWorkspaceRoot, // Use worktreePath if available
                context.generateDiffUseCase,
                context.addCommentUseCase,
                context.submitComments,
                context.stateManager,
                undefined, // symbolPort - not available in ThreadListController
                context.editCommentUseCase,
                context.deleteCommentUseCase,
                context.fetchHNStoriesUseCase,
                context.generateScopedDiffUseCase
            );
            panel.show();
        }
    }

    /**
     * Refresh file list from git status for a session's workspaceRoot.
     * This ensures worktree files are properly displayed when switching threads.
     */
    private async refreshFilesForSession(context: SessionContext, workspaceRoot: string): Promise<void> {
        if (!this.gitPort || !workspaceRoot) {
            console.log(`[Sidecar] Cannot refresh files: gitPort=${!!this.gitPort}, workspaceRoot=${workspaceRoot}`);
            return;
        }

        try {
            console.log(`[Sidecar] Refreshing files for ${context.terminalId} from ${workspaceRoot}`);

            // Get uncommitted files from git for this session's workspaceRoot
            const uncommittedFiles = await this.gitPort.getUncommittedFilesWithStatus(workspaceRoot);

            // Convert to FileInfo format
            const fileInfos: FileInfo[] = uncommittedFiles.map(f => ({
                path: f.path,
                name: path.basename(f.path),
                status: f.status,
            }));

            // Update baseline with current uncommitted files
            context.stateManager.setBaseline(fileInfos);

            console.log(`[Sidecar] Refreshed files for ${context.terminalId}: ${fileInfos.length} files from ${workspaceRoot}`);
        } catch (error) {
            console.error(`[Sidecar] Failed to refresh files for session ${context.terminalId}:`, error);
        }
    }

    /**
     * Get currently selected thread ID.
     */
    getSelectedThreadId(): string | null {
        return this.selectedThreadId;
    }

    /**
     * Cycle to next thread.
     */
    async cycleToNextThread(): Promise<void> {
        const sessions = this.getSessions();
        const sessionIds = Array.from(sessions.keys());

        if (sessionIds.length === 0) {
            return;
        }

        const currentIndex = this.selectedThreadId
            ? sessionIds.indexOf(this.selectedThreadId)
            : -1;
        const nextIndex = (currentIndex + 1) % sessionIds.length;

        await this.selectThread(sessionIds[nextIndex]);
    }

    /**
     * Refresh thread list.
     * Call when sessions change.
     */
    refresh(): void {
        this.webviewProvider?.refresh();
        this.updateContextKey();
    }

    /**
     * Update thread selection without triggering full selectThread logic.
     * Used when terminal is focused externally (e.g., clicking terminal panel).
     */
    updateSelectedThread(terminalId: string): void {
        this.selectedThreadId = terminalId;
        this.webviewProvider?.setSelectedId(terminalId);
    }

    /**
     * Create a thread from webview input.
     */
    private async createThreadFromInput(options: CreateThreadOptions): Promise<void> {
        if (!this.createThreadUseCase) {
            vscode.window.showErrorMessage('Create thread use case not available');
            return;
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        try {
            const result = await this.createThreadUseCase.execute({
                name: options.name.trim(),
                isolationMode: options.isolationMode,
                branchName: options.branchName?.trim(),
                worktreePath: options.worktreePath?.trim(),
                workspaceRoot,
            });

            // Auto-attach Sidecar to the new terminal
            if (this.attachSidecar) {
                await this.attachSidecar(result.threadState.terminalId);
            }

            // Refresh and select new thread
            this.refresh();
            await this.selectThread(result.threadState.terminalId);

            vscode.window.showInformationMessage(`Agent "${options.name.trim()}" created`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create agent: ${message}`);
        }
    }

    /**
     * Create a new agent thread with interactive quick pick flow.
     */
    async createThread(): Promise<void> {
        if (!this.createThreadUseCase) {
            vscode.window.showErrorMessage('Create thread use case not available');
            return;
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Step 1: Name input
        const name = await vscode.window.showInputBox({
            prompt: 'Enter agent name',
            placeHolder: 'fix-login-bug',
            validateInput: (value) => value.trim() ? null : 'Name is required',
        });
        if (!name) return;

        // Step 2: Isolation mode
        const isolationPick = await vscode.window.showQuickPick([
            { label: 'Local', description: 'Work in current workspace', mode: 'none' as IsolationMode },
            { label: 'Worktree', description: 'Create isolated worktree for parallel work', mode: 'worktree' as IsolationMode },
        ], {
            placeHolder: 'Select isolation mode',
        });
        if (!isolationPick) return;

        // Step 3: Branch name (for worktree)
        let branchName: string | undefined;
        if (isolationPick.mode === 'worktree') {
            branchName = await vscode.window.showInputBox({
                prompt: 'Branch name',
                value: name.trim(),
                placeHolder: name.trim(),
            });
            if (branchName === undefined) return;
        }

        // Execute
        try {
            const result = await this.createThreadUseCase.execute({
                name: name.trim(),
                isolationMode: isolationPick.mode,
                branchName: branchName?.trim(),
                workspaceRoot,
            });

            // Auto-attach Sidecar to the new terminal
            if (this.attachSidecar) {
                await this.attachSidecar(result.threadState.terminalId);
            }

            // Refresh and select new thread
            this.refresh();
            await this.selectThread(result.threadState.terminalId);

            vscode.window.showInformationMessage(`Agent "${name.trim()}" created`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to create agent: ${message}`);
        }
    }

    /**
     * Get workspace root folder path.
     */
    private getWorkspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /**
     * Update context key for keyboard shortcut condition.
     */
    private updateContextKey(): void {
        const sessions = this.getSessions();
        vscode.commands.executeCommand(
            'setContext',
            'sidecar.hasMultipleThreads',
            sessions.size > 1
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
