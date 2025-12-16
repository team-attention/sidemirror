import * as vscode from 'vscode';
import * as path from 'path';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { ThreadListWebviewProvider, CreateThreadOptions } from '../ui/ThreadListWebviewProvider';
import { CodeSquadPanelAdapter } from '../ui/CodeSquadPanelAdapter';
import { ITerminalPort } from '../../../application/ports/outbound/ITerminalPort';
import { ICreateThreadUseCase, IsolationMode } from '../../../application/ports/inbound/ICreateThreadUseCase';
import { IAttachToWorktreeUseCase } from '../../../application/ports/inbound/IAttachToWorktreeUseCase';
import { IDeleteThreadUseCase } from '../../../application/ports/inbound/IDeleteThreadUseCase';
import { IOpenInEditorUseCase } from '../../../application/ports/inbound/IOpenInEditorUseCase';
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';
import { FileWatchController } from './FileWatchController';
import { ICommentRepository } from '../../../application/ports/outbound/ICommentRepository';
import { IGitPort, WorktreeInfo } from '../../../application/ports/outbound/IGitPort';
import { FileInfo } from '../../../application/ports/outbound/PanelState';

export class ThreadListController {
    private webviewProvider: ThreadListWebviewProvider | undefined;
    private selectedThreadId: string | null = null; // null = "All Agents"
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly getSessions: () => Map<string, SessionContext>,
        private readonly terminalGateway: ITerminalPort,
        private readonly createThreadUseCase?: ICreateThreadUseCase,
        private readonly attachToWorktreeUseCase?: IAttachToWorktreeUseCase,
        private readonly attachCodeSquad?: (terminalId: string) => Promise<void>,
        private readonly fileWatchController?: FileWatchController,
        private readonly commentRepository?: ICommentRepository,
        private readonly gitPort?: IGitPort,
        private readonly deleteThreadUseCase?: IDeleteThreadUseCase,
        private readonly threadStateRepository?: IThreadStateRepository,
        private readonly openInEditorUseCase?: IOpenInEditorUseCase,
        private readonly removeSession?: (terminalId: string) => void
    ) {}

    activate(context: vscode.ExtensionContext): void {
        // Create webview provider
        this.webviewProvider = new ThreadListWebviewProvider(
            context.extensionUri,
            this.getSessions,
            (id) => this.selectThread(id),
            (options) => this.createThreadFromInput(options),
            (id) => this.openNewTerminal(id),
            () => this.attachToWorktree(),
            (id) => this.deleteThread(id),
            (id) => this.openInEditor(id)
        );

        // Register webview view provider
        const registration = vscode.window.registerWebviewViewProvider(
            ThreadListWebviewProvider.viewType,
            this.webviewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        );
        context.subscriptions.push(registration);
        this.disposables.push(registration);
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
        const panel = CodeSquadPanelAdapter.currentPanel;
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
                context.generateScopedDiffUseCase,
                this.threadStateRepository
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
            console.log(`[Code Squad] Cannot refresh files: gitPort=${!!this.gitPort}, workspaceRoot=${workspaceRoot}`);
            return;
        }

        try {
            console.log(`[Code Squad] Refreshing files for ${context.terminalId} from ${workspaceRoot}`);

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

            console.log(`[Code Squad] Refreshed files for ${context.terminalId}: ${fileInfos.length} files from ${workspaceRoot}`);
        } catch (error) {
            console.error(`[Code Squad] Failed to refresh files for session ${context.terminalId}:`, error);
        }
    }

    /**
     * Get currently selected thread ID.
     */
    getSelectedThreadId(): string | null {
        return this.selectedThreadId;
    }

    /**
     * Refresh thread list.
     * Call when sessions change.
     */
    refresh(): void {
        this.webviewProvider?.refresh();
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
                worktreeCopyPatterns: this.getWorktreeCopyPatterns(),
            });

            // Auto-attach Code Squad to the new terminal
            if (this.attachCodeSquad) {
                await this.attachCodeSquad(result.threadState.terminalId);
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
                worktreeCopyPatterns: this.getWorktreeCopyPatterns(),
            });

            // Auto-attach Code Squad to the new terminal
            if (this.attachCodeSquad) {
                await this.attachCodeSquad(result.threadState.terminalId);
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
     * Get worktree copy patterns from configuration.
     */
    private getWorktreeCopyPatterns(): string[] {
        const config = vscode.workspace.getConfiguration('codeSquad');
        return config.get<string[]>('worktreeCopyPatterns', []);
    }

    /**
     * Open a new terminal in the thread's working directory.
     */
    async openNewTerminal(id: string): Promise<void> {
        const sessions = this.getSessions();
        const context = sessions.get(id);

        if (!context) {
            return;
        }

        const threadState = context.threadState;
        const workingDir = threadState?.worktreePath || context.workspaceRoot;
        const name = threadState?.name ?? context.session.displayName;

        await this.terminalGateway.createTerminal(`Terminal: ${name}`, workingDir, true);
    }

    /**
     * Attach Code Squad to an existing git worktree.
     * Shows Quick Pick for worktree selection and Input Box for thread naming.
     */
    async attachToWorktree(): Promise<void> {
        if (!this.attachToWorktreeUseCase) {
            vscode.window.showErrorMessage('Attach to worktree use case not available');
            return;
        }

        if (!this.gitPort) {
            vscode.window.showErrorMessage('Git port not available');
            return;
        }

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Step 1: Get all worktrees
        let allWorktrees: WorktreeInfo[];
        try {
            allWorktrees = await this.gitPort.listWorktrees(workspaceRoot);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to list worktrees: ${message}`);
            return;
        }

        if (allWorktrees.length === 0) {
            vscode.window.showInformationMessage(
                'No git worktrees found in this repository. Create one using "Start Thread" with Worktree isolation mode.'
            );
            return;
        }

        // Step 2: Filter out already-attached worktrees
        const sessions = this.getSessions();
        const attachedPaths = new Set(
            Array.from(sessions.values())
                .map(ctx => ctx.threadState?.worktreePath)
                .filter(Boolean)
        );

        const availableWorktrees = allWorktrees.filter(
            wt => !attachedPaths.has(wt.path)
        );

        if (availableWorktrees.length === 0) {
            vscode.window.showInformationMessage(
                'All worktrees are already attached to threads'
            );
            return;
        }

        // Step 3: Show Quick Pick for worktree selection
        const selectedWorktree = await vscode.window.showQuickPick(
            availableWorktrees.map(wt => ({
                label: wt.path,
                description: `branch: ${wt.branch}`,
                worktree: wt,
            })),
            {
                placeHolder: 'Select a worktree to attach',
            }
        );

        if (!selectedWorktree) {
            return;
        }

        // Step 4: Show Input Box for thread name (pre-filled with branch name)
        const threadName = await vscode.window.showInputBox({
            prompt: 'Thread name',
            value: selectedWorktree.worktree.branch,
            placeHolder: selectedWorktree.worktree.branch,
            validateInput: (value) => value.trim() ? null : 'Name is required',
        });

        if (!threadName) {
            return;
        }

        // Step 5: Execute attach use case
        try {
            const result = await this.attachToWorktreeUseCase.execute({
                worktreePath: selectedWorktree.worktree.path,
                name: threadName.trim(),
                workspaceRoot,
            });

            // Step 6: Auto-attach Code Squad to the new terminal
            if (this.attachCodeSquad) {
                await this.attachCodeSquad(result.threadState.terminalId);
            }

            // Step 7: Refresh and select new thread
            this.refresh();
            await this.selectThread(result.threadState.terminalId);

            vscode.window.showInformationMessage(`Agent "${threadName.trim()}" attached to worktree`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to attach to worktree: ${message}`);
        }
    }

    /**
     * Delete a thread with confirmation dialog.
     */
    async deleteThread(threadId: string): Promise<void> {
        if (!this.deleteThreadUseCase || !this.threadStateRepository) {
            vscode.window.showErrorMessage('Delete thread use case not available');
            return;
        }

        // Get thread info for confirmation
        const thread = await this.threadStateRepository.findById(threadId);
        if (!thread) return;

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // Show confirmation dialog
        const options: vscode.MessageItem[] = [
            { title: 'Keep Worktree' },
            { title: 'Delete Worktree Too' },
            { title: 'Cancel', isCloseAffordance: true }
        ];

        const result = await vscode.window.showWarningMessage(
            `Delete thread "${thread.name}"?`,
            { modal: true },
            ...options
        );

        if (!result || result.title === 'Cancel') return;

        // Execute deletion
        const deleteAll = result.title === 'Delete Worktree Too';
        await this.deleteThreadUseCase.execute({
            threadId,
            workspaceRoot,
            closeTerminal: true, // Always close terminal when deleting thread
            removeWorktree: deleteAll
        });

        // Remove session from AIDetectionController's sessions Map
        // This is needed even when terminal is kept, since thread state is deleted
        if (this.removeSession && thread.terminalId) {
            this.removeSession(thread.terminalId);
        }

        // Handle selection if deleted thread was selected
        // Use terminalId since that's what selectedThreadId stores
        if (this.selectedThreadId === thread.terminalId) {
            await this.selectNextThread();
        }

        // Refresh UI
        this.refresh();
    }

    /**
     * Open thread's worktree in a new editor window.
     */
    async openInEditor(threadId: string): Promise<void> {
        if (!this.openInEditorUseCase) {
            vscode.window.showErrorMessage('Open in editor use case not available');
            return;
        }

        const result = await this.openInEditorUseCase.execute({ threadId });
        if (!result.success) {
            vscode.window.showErrorMessage(`Failed to open in editor: ${result.error}`);
        }
    }

    /**
     * Select next available thread after deletion.
     */
    private async selectNextThread(): Promise<void> {
        const sessions = this.getSessions();
        if (sessions.size > 0) {
            const [firstId] = sessions.keys();
            await this.selectThread(firstId);
        } else {
            this.selectedThreadId = null;
            // Clear Code Squad panel or show empty state
        }
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
