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
                panelStateManager
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

    // Add Comment from Panel
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'sidecar.addCommentFromPanel',
            async (file, line, endLine, text, codeContext) => {
                await addCommentUseCase.execute({
                    file,
                    line,
                    endLine,
                    text,
                    codeContext: codeContext || '',
                });
            }
        )
    );

    // Add Comment (Legacy - from editor)
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.addComment', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Open a file to add a comment');
                return;
            }

            if (!SidecarPanelAdapter.currentPanel) {
                vscode.window.showWarningMessage('Open Sidecar panel first');
                return;
            }

            const selection = editor.selection;
            const file = vscode.workspace.asRelativePath(editor.document.uri);
            const hasSelection = !selection.isEmpty;
            const startLine = selection.start.line + 1;
            const endLine = selection.end.line + 1;

            const lineDisplay = hasSelection && startLine !== endLine
                ? `${file}:${startLine}-${endLine}`
                : `${file}:${startLine}`;

            const text = await vscode.window.showInputBox({
                placeHolder: 'Enter your comment for AI...',
                prompt: `Adding comment to ${lineDisplay}`
            });

            if (!text) return;

            let codeContext: string;
            if (hasSelection) {
                codeContext = editor.document.getText(selection);
            } else {
                const contextStart = Math.max(0, startLine - 5);
                const contextEnd = Math.min(editor.document.lineCount - 1, startLine + 5);
                codeContext = editor.document.getText(
                    new vscode.Range(contextStart, 0, contextEnd, 1000)
                );
            }

            await addCommentUseCase.execute({
                file,
                line: startLine,
                endLine: hasSelection && startLine !== endLine ? endLine : undefined,
                text,
                codeContext,
            });

            vscode.window.showInformationMessage('Comment added to Sidecar');
        })
    );

    // Submit Comments
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.submitComments', async () => {
            const session = aiDetectionController.getActiveSession();
            await submitCommentsUseCase.execute(session);
        })
    );

    // Add to Whitelist
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.addToWhitelist', async () => {
            const editor = vscode.window.activeTextEditor;
            const currentFile = editor ? vscode.workspace.asRelativePath(editor.document.uri) : '';

            const input = await vscode.window.showInputBox({
                prompt: 'Enter a glob pattern to track (e.g., "dist/**", "*.log", ".env.*")',
                value: currentFile,
                placeHolder: 'dist/**, .env.local, build/**/*.js'
            });

            if (!input) return;

            const config = vscode.workspace.getConfiguration('sidecar');
            const currentPatterns = config.get<string[]>('includeFiles', []);

            if (currentPatterns.includes(input)) {
                vscode.window.showInformationMessage(`Pattern "${input}" is already in whitelist`);
                return;
            }

            await config.update('includeFiles', [...currentPatterns, input], vscode.ConfigurationTarget.Workspace);
            fileWatchController.reload();

            vscode.window.showInformationMessage(`Added "${input}" to whitelist`);
        })
    );

    // Manage Whitelist
    context.subscriptions.push(
        vscode.commands.registerCommand('sidecar.manageWhitelist', async () => {
            const config = vscode.workspace.getConfiguration('sidecar');
            const currentPatterns = config.get<string[]>('includeFiles', []);

            if (currentPatterns.length === 0) {
                const action = await vscode.window.showInformationMessage(
                    'Whitelist is empty. Add a pattern?',
                    'Add Pattern'
                );
                if (action === 'Add Pattern') {
                    vscode.commands.executeCommand('sidecar.addToWhitelist');
                }
                return;
            }

            const selected = await vscode.window.showQuickPick(
                [
                    { label: '$(add) Add new pattern...', action: 'add' },
                    { label: '$(trash) Remove all patterns', action: 'clear' },
                    { label: '', kind: vscode.QuickPickItemKind.Separator },
                    ...currentPatterns.map(p => ({ label: p, action: 'remove', pattern: p }))
                ],
                {
                    placeHolder: 'Select a pattern to remove or add new one',
                    title: 'Sidecar Whitelist'
                }
            ) as { label: string; action: string; pattern?: string } | undefined;

            if (!selected) return;

            if (selected.action === 'add') {
                vscode.commands.executeCommand('sidecar.addToWhitelist');
            } else if (selected.action === 'clear') {
                const confirm = await vscode.window.showWarningMessage(
                    'Remove all patterns from whitelist?',
                    'Yes', 'No'
                );
                if (confirm === 'Yes') {
                    await config.update('includeFiles', [], vscode.ConfigurationTarget.Workspace);
                    fileWatchController.reload();
                    vscode.window.showInformationMessage('Whitelist cleared');
                }
            } else if (selected.action === 'remove' && selected.pattern) {
                const newPatterns = currentPatterns.filter(p => p !== selected.pattern);
                await config.update('includeFiles', newPatterns, vscode.ConfigurationTarget.Workspace);
                fileWatchController.reload();
                vscode.window.showInformationMessage(`Removed "${selected.pattern}" from whitelist`);
            }
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
