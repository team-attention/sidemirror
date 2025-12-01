import * as vscode from 'vscode';

// Domain
import { DiffService } from './domain/services/DiffService';

// Application - Use Cases (only SubmitCommentsUseCase remains shared)
import { SubmitCommentsUseCase } from './application/useCases/SubmitCommentsUseCase';

// Adapters - Inbound (Controllers)
import { AIDetectionController } from './adapters/inbound/controllers/AIDetectionController';
import { FileWatchController } from './adapters/inbound/controllers/FileWatchController';

// Adapters - Inbound (UI)
import { SidecarPanelAdapter } from './adapters/inbound/ui/SidecarPanelAdapter';
import {
    VscodeTerminalGateway,
    VscodeFileSystemGateway,
    VscodeGitGateway,
    VscodeNotificationGateway,
    FastGlobGateway,
    VscodeLspGateway,
} from './adapters/outbound/gateways';

// Infrastructure - Repositories
import { JsonCommentRepository } from './infrastructure/repositories/JsonCommentRepository';

let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    console.log('Sidecar is now active!');
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

    // ===== Application Layer - Shared Use Cases =====
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
        lspGateway
    );

    const fileWatchController = new FileWatchController();
    fileWatchController.setGitPort(gitGateway);
    fileWatchController.setSessionsRef(aiDetectionController.getSessions());

    // Activate Controllers
    aiDetectionController.activate(context);
    fileWatchController.activate(context);

    // ===== Commands =====

    // Show Panel (마지막 활성 패널 표시)
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.showPanel', () => {
            if (SidecarPanelAdapter.currentPanel) {
                SidecarPanelAdapter.currentPanel.show();
            }
        })
    );

    // Focus Panel
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.focusPanel', () => {
            if (SidecarPanelAdapter.currentPanel) {
                SidecarPanelAdapter.currentPanel.show();
            }
        })
    );
}

export function deactivate() {}
