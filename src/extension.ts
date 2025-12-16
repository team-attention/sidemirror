import * as vscode from 'vscode';

// Domain
import { DiffService } from './domain/services/DiffService';
import { TerminalStatusDetector } from './domain/services/TerminalStatusDetector';
import { AIType } from './domain/entities/AISession';

// Application - Use Cases
import { SubmitCommentsUseCase } from './application/useCases/SubmitCommentsUseCase';
import { CreateThreadUseCase } from './application/useCases/CreateThreadUseCase';
import { ManageWhitelistUseCase } from './application/useCases/ManageWhitelistUseCase';
import { TrackFileOwnershipUseCase } from './application/useCases/TrackFileOwnershipUseCase';
import { DetectThreadStatusUseCase } from './application/useCases/DetectThreadStatusUseCase';

// Adapters - Inbound (Controllers)
import { AIDetectionController } from './adapters/inbound/controllers/AIDetectionController';
import { FileWatchController } from './adapters/inbound/controllers/FileWatchController';
import { ClaudeCodeConfigController } from './adapters/inbound/controllers/ClaudeCodeConfigController';
import { ThreadListController } from './adapters/inbound/controllers/ThreadListController';

// Adapters - Inbound (UI)
import {
    VscodeTerminalGateway,
    VscodeFileSystemGateway,
    VscodeGitGateway,
    VscodeNotificationGateway,
    FastGlobGateway,
    VscodeLspGateway,
    HNApiGateway,
    VscodeWorkspaceStateGateway,
} from './adapters/outbound/gateways';
import { FetchHNStoriesUseCase } from './application/useCases/FetchHNStoriesUseCase';
import { WORKSPACE_STATE_KEYS } from './application/ports/outbound/IWorkspaceStatePort';

// Infrastructure - Repositories
import { JsonCommentRepository } from './infrastructure/repositories/JsonCommentRepository';
import { JsonThreadStateRepository } from './infrastructure/repositories/JsonThreadStateRepository';
import { InMemoryFileThreadMappingRepository } from './infrastructure/repositories/InMemoryFileThreadMappingRepository';

let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    console.log('[Code Squad] Code Squad is now active!');
    extensionContext = context;

    // ===== Infrastructure Layer =====
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const commentRepository = new JsonCommentRepository(workspaceRoot);
    const threadStateRepository = new JsonThreadStateRepository(workspaceRoot);
    const fileThreadMappingRepository = new InMemoryFileThreadMappingRepository();

    // ===== Domain Layer =====
    const diffService = new DiffService();
    const terminalStatusDetector = new TerminalStatusDetector();

    // ===== Adapters Layer - Gateways =====
    const terminalGateway = new VscodeTerminalGateway();
    terminalGateway.initialize();
    const fileSystemGateway = new VscodeFileSystemGateway();
    const gitGateway = new VscodeGitGateway();
    const notificationGateway = new VscodeNotificationGateway();
    const fileGlobber = new FastGlobGateway();
    const lspGateway = new VscodeLspGateway();
    const hnApiGateway = new HNApiGateway();
    const workspaceStateGateway = new VscodeWorkspaceStateGateway(context.workspaceState);

    // ===== Application Layer - Shared Use Cases =====
    const fetchHNStoriesUseCase = new FetchHNStoriesUseCase(hnApiGateway);
    const submitCommentsUseCase = new SubmitCommentsUseCase(
        commentRepository,
        terminalGateway,
        notificationGateway,
        fileThreadMappingRepository,
        threadStateRepository
    );
    const trackFileOwnershipUseCase = new TrackFileOwnershipUseCase(
        fileThreadMappingRepository
    );
    const createThreadUseCase = new CreateThreadUseCase(
        threadStateRepository,
        terminalGateway,
        gitGateway,
        fileSystemGateway,
        fileGlobber
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const manageWhitelistUseCase = new ManageWhitelistUseCase(threadStateRepository);
    const detectThreadStatusUseCase = new DetectThreadStatusUseCase(terminalStatusDetector, notificationGateway);

    // ===== Adapters Layer - Controllers =====
    const aiDetectionController = new AIDetectionController(
        fileSystemGateway,
        gitGateway,
        fileGlobber,
        terminalGateway,
        () => extensionContext,
        commentRepository,
        submitCommentsUseCase,
        diffService,
        lspGateway,
        fetchHNStoriesUseCase,
        workspaceStateGateway
    );

    const fileWatchController = new FileWatchController();
    fileWatchController.setGitPort(gitGateway);
    fileWatchController.setSessionsRef(aiDetectionController.getSessions());
    fileWatchController.setThreadStateRepository(threadStateRepository);
    fileWatchController.setTrackFileOwnershipUseCase(trackFileOwnershipUseCase);

    // Connect controllers for worktree support
    aiDetectionController.setFileWatchController(fileWatchController);
    aiDetectionController.setThreadStateRepository(threadStateRepository);

    // Thread List Controller (after AIDetectionController)
    const threadListController = new ThreadListController(
        () => aiDetectionController.getSessions(),
        terminalGateway,
        createThreadUseCase,
        (terminalId) => aiDetectionController.attachToTerminalById(terminalId),
        fileWatchController,
        commentRepository,
        gitGateway
    );

    // Connect AIDetectionController to notify ThreadListController on session changes
    aiDetectionController.setOnSessionChange(() => {
        threadListController.refresh();
    });

    // Connect terminal focus to thread list selection
    aiDetectionController.setOnTerminalFocus((terminalId) => {
        threadListController.updateSelectedThread(terminalId);
    });

    // Connect terminal output to status detection
    terminalGateway.onTerminalOutput((terminalId, data) => {
        const sessions = aiDetectionController.getSessions();
        const session = sessions.get(terminalId);
        if (session) {
            const aiType = session.session.type;
            detectThreadStatusUseCase.processOutput(terminalId, aiType, data);
        }
    });

    // Subscribe to status changes from pattern-based detection
    detectThreadStatusUseCase.onStatusChange((terminalId, status) => {
        const sessions = aiDetectionController.getSessions();
        const session = sessions.get(terminalId);
        if (session) {
            const currentMetadata = session.session.agentMetadata;
            const threadName = currentMetadata?.name ?? session.session.displayName;
            session.session.setAgentMetadata({
                name: threadName,
                status,
                fileCount: currentMetadata?.fileCount ?? 0,
            });
            detectThreadStatusUseCase.setThreadName(terminalId, threadName);
            threadListController.refresh();
        }
    });

    // Subscribe to AI type changes from output pattern detection (backup for command detection)
    detectThreadStatusUseCase.onAITypeChange((terminalId, detectedAIType) => {
        const sessions = aiDetectionController.getSessions();
        const session = sessions.get(terminalId);
        if (session && session.session.type !== detectedAIType) {
            session.session.updateType(detectedAIType);
            threadListController.refresh();
        }
    });

    // Detect AI type from executed commands (primary detection method)
    terminalGateway.onCommandExecuted((terminalId, command) => {
        const sessions = aiDetectionController.getSessions();
        const session = sessions.get(terminalId);
        if (!session) return;

        // Extract the base command (first word, ignoring paths)
        const baseCommand = command.trim().split(/[\s/]/).pop()?.toLowerCase() ?? '';

        let detectedType: AIType | null = null;
        if (baseCommand === 'claude' || baseCommand.startsWith('claude-')) {
            detectedType = 'claude';
        } else if (baseCommand === 'gemini') {
            detectedType = 'gemini';
        } else if (baseCommand === 'codex') {
            detectedType = 'codex';
        }

        if (detectedType && session.session.type !== detectedType) {
            session.session.updateType(detectedType);
            threadListController.refresh();
        }
    });

    // Detect AI CLI exit (claude, gemini, codex ended) - reset to inactive
    terminalGateway.onCommandEnded((terminalId, command) => {
        const sessions = aiDetectionController.getSessions();
        const session = sessions.get(terminalId);
        if (!session) return;

        const baseCommand = command.trim().split(/[\s/]/).pop()?.toLowerCase() ?? '';

        const isAICLI = baseCommand === 'claude' || baseCommand.startsWith('claude-') ||
                        baseCommand === 'gemini' ||
                        baseCommand === 'codex';

        if (isAICLI) {
            // Clear status detection state
            detectThreadStatusUseCase.clear(terminalId);
            // Reset session status to inactive
            const currentMetadata = session.session.agentMetadata;
            session.session.setAgentMetadata({
                name: currentMetadata?.name ?? session.session.displayName,
                status: 'inactive',
                fileCount: currentMetadata?.fileCount ?? 0,
            });
            threadListController.refresh();
        }
    });

    // Activity-based detection: triggered when shell execution starts/ends
    // This handles the case when shell execution ends (hasActivity=false)
    // to transition from 'working' to 'idle'
    terminalGateway.onTerminalActivity((terminalId, hasActivity) => {
        const sessions = aiDetectionController.getSessions();
        const session = sessions.get(terminalId);
        if (session) {
            const currentStatus = detectThreadStatusUseCase.getStatus(terminalId);
            let newStatus: 'working' | 'idle' | undefined;

            if (hasActivity) {
                // Shell execution started - set to working if currently inactive
                if (currentStatus === 'inactive') {
                    newStatus = 'working';
                }
            } else {
                // Shell execution ended - set to idle if currently working
                // This handles the case when AI finishes its work
                if (currentStatus === 'working' || currentStatus === 'inactive') {
                    newStatus = 'idle';
                }
            }

            if (newStatus) {
                const currentMetadata = session.session.agentMetadata;
                session.session.setAgentMetadata({
                    name: currentMetadata?.name ?? session.session.displayName,
                    status: newStatus,
                    fileCount: currentMetadata?.fileCount ?? 0,
                });
                threadListController.refresh();
            }
        }
    });

    // Activate Controllers
    aiDetectionController.activate(context);
    fileWatchController.activate(context);
    threadListController.activate(context);

    // Register createAgent command
    context.subscriptions.push(
        vscode.commands.registerCommand('codeSquad.createAgent', () => {
            threadListController.createThread();
        })
    );

    // Prompt Claude Code terminal mode configuration
    const claudeCodeConfigController = new ClaudeCodeConfigController();
    claudeCodeConfigController.promptTerminalMode();

    // Register controller dispose for cleanup
    context.subscriptions.push({ dispose: () => fileWatchController.dispose() });
    context.subscriptions.push({ dispose: () => threadListController.dispose() });

    // ===== Commands =====

    // Open Sidebar
    context.subscriptions.push(
        vscode.commands.registerCommand('codeSquad.openSidebar', () => {
            vscode.commands.executeCommand('workbench.view.extension.codeSquad');
        })
    );

    // Reset Auto-Open Setting
    context.subscriptions.push(
        vscode.commands.registerCommand('codeSquad.resetAutoOpen', async () => {
            await workspaceStateGateway.set(WORKSPACE_STATE_KEYS.AUTO_OPEN_PANEL, 'ask');
            vscode.window.showInformationMessage(
                'Code Squad will ask before opening panel next time.'
            );
        })
    );

    // Attach to Terminal - manually attach Code Squad to existing terminal
    context.subscriptions.push(
        vscode.commands.registerCommand('codeSquad.attachToTerminal', async () => {
            await aiDetectionController.attachToTerminal();
        })
    );
}

export function deactivate() {}
