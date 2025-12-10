import * as vscode from 'vscode';

// Domain
import { DiffService } from './domain/services/DiffService';

// Application - Use Cases (only SubmitCommentsUseCase remains shared)
import { SubmitCommentsUseCase } from './application/useCases/SubmitCommentsUseCase';

// Adapters - Inbound (Controllers)
import { AIDetectionController } from './adapters/inbound/controllers/AIDetectionController';
import { FileWatchController } from './adapters/inbound/controllers/FileWatchController';
import { ClaudeCodeConfigController } from './adapters/inbound/controllers/ClaudeCodeConfigController';

// Adapters - Inbound (UI)
import { SidecarPanelAdapter } from './adapters/inbound/ui/SidecarPanelAdapter';
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

let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    console.log('[Sidecar] Sidecar is now active!');
    extensionContext = context;

    // ===== Infrastructure Layer =====
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const commentRepository = new JsonCommentRepository(workspaceRoot);

    // ===== Domain Layer =====
    const diffService = new DiffService();

    // ===== Adapters Layer - Gateways =====
    const terminalGateway = new VscodeTerminalGateway();
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
        notificationGateway
    );

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

    // Activate Controllers
    aiDetectionController.activate(context);
    fileWatchController.activate(context);

    // Prompt Claude Code terminal mode configuration
    const claudeCodeConfigController = new ClaudeCodeConfigController();
    claudeCodeConfigController.promptTerminalMode();

    // Register fileWatchController dispose for debounce timer cleanup
    context.subscriptions.push({ dispose: () => fileWatchController.dispose() });

    // Start panel cleanup interval
    SidecarPanelAdapter.startCleanupInterval();
    context.subscriptions.push({ dispose: () => SidecarPanelAdapter.stopCleanupInterval() });

    // ===== Commands =====

    // Reset Auto-Open Setting
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.resetAutoOpen', async () => {
            await workspaceStateGateway.set(WORKSPACE_STATE_KEYS.AUTO_OPEN_PANEL, 'ask');
            vscode.window.showInformationMessage(
                'Sidecar will ask before opening panel next time.'
            );
        })
    );

    // Attach to Terminal - manually attach Sidecar to existing terminal
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.attachToTerminal', async () => {
            await aiDetectionController.attachToTerminal();
        })
    );
}

export function deactivate() {}
