import * as vscode from 'vscode';

// Domain
import { DiffService } from './domain/services/DiffService';

// Application - Use Cases
import { AddCommentUseCase } from './application/useCases/AddCommentUseCase';
import { SubmitCommentsUseCase } from './application/useCases/SubmitCommentsUseCase';
import { GenerateDiffUseCase } from './application/useCases/GenerateDiffUseCase';
import { CaptureSnapshotsUseCase } from './application/useCases/CaptureSnapshotsUseCase';

// Application - Services
import { PanelStateManager } from './application/services/PanelStateManager';

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
import { InMemorySnapshotRepository } from './infrastructure/repositories/InMemorySnapshotRepository';

let extensionContext: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    console.log('Sidecar is now active!');
    extensionContext = context;

    // ===== Infrastructure Layer =====
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const commentRepository = new JsonCommentRepository(workspaceRoot);
    const snapshotRepository = new InMemorySnapshotRepository();

    // ===== Domain Layer =====
    const diffService = new DiffService();

    // ===== Application Layer - Services =====
    const panelStateManager = new PanelStateManager();

    // ===== Adapters Layer - Gateways =====
    const terminalGateway = new VscodeTerminalGateway();
    const fileSystemGateway = new VscodeFileSystemGateway();
    const gitGateway = new VscodeGitGateway();
    const notificationGateway = new VscodeNotificationGateway();
    const fileGlobber = new FastGlobGateway();
    const lspGateway = new VscodeLspGateway();

    // ===== Application Layer - Use Cases =====
    const captureSnapshotsUseCase = new CaptureSnapshotsUseCase(
        snapshotRepository,
        fileSystemGateway,
        fileGlobber
    );

    const addCommentUseCase = new AddCommentUseCase(
        commentRepository
    );

    const generateDiffUseCase = new GenerateDiffUseCase(
        snapshotRepository,
        fileSystemGateway,
        gitGateway,
        diffService
    );

    const submitCommentsUseCase = new SubmitCommentsUseCase(
        commentRepository,
        terminalGateway,
        notificationGateway
    );

    // ===== Adapters Layer - Controllers =====
    const aiDetectionController = new AIDetectionController(
        captureSnapshotsUseCase,
        snapshotRepository,
        terminalGateway,
        () => extensionContext,
        gitGateway,
        fileGlobber
    );
    aiDetectionController.setPanelStateManager(panelStateManager);

    const fileWatchController = new FileWatchController();
    fileWatchController.setPanelStateManager(panelStateManager);
    fileWatchController.setGenerateDiffUseCase(generateDiffUseCase);
    fileWatchController.setGitPort(gitGateway);

    // Activate Controllers
    aiDetectionController.activate(context);
    fileWatchController.activate(context);

    // ===== Commands =====

    // Show Panel
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.showPanel', () => {
            const panel = SidecarPanelAdapter.create(context);

            // Connect state manager to panel via render callback
            panelStateManager.setRenderCallback((state) => panel.render(state));

            // Set up inbound handlers for panel
            panel.setUseCases(
                generateDiffUseCase,
                addCommentUseCase,
                async () => {
                    const session = aiDetectionController.getActiveSession();
                    const result = await submitCommentsUseCase.execute(session);
                    if (result) {
                        panelStateManager.markCommentsAsSubmitted(result.submittedIds);
                    }
                },
                panelStateManager,
                lspGateway
            );

            // Clean up when panel is disposed
            panel.onDispose(() => {
                panelStateManager.clearRenderCallback();
            });
        })
    );

    // Focus Panel (used by notification actions)
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.focusPanel', () => {
            if (!SidecarPanelAdapter.currentPanel) {
                vscode.commands.executeCommand('sidecar.showPanel');
                return;
            }
            SidecarPanelAdapter.currentPanel.show();
        })
    );


    // Update AI Type (called from AIDetectionController)
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.updateAIType', (aiType: string) => {
            panelStateManager.setAIStatus({ active: true, type: aiType });
        })
    );
}

export function deactivate() {}
