import * as vscode from 'vscode';
import * as path from 'path';
import { AISession, AIType } from '../../../domain/entities/AISession';
import { DiffService } from '../../../domain/services/DiffService';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { IFileSystemPort } from '../../../application/ports/outbound/IFileSystemPort';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { IFileGlobber } from '../../../application/ports/outbound/IFileGlobber';
import { ICommentRepository } from '../../../application/ports/outbound/ICommentRepository';
import { ISymbolPort } from '../../../application/ports/outbound/ISymbolPort';
import { FileInfo } from '../../../application/ports/outbound/PanelState';
import { IPanelStateManager } from '../../../application/services/IPanelStateManager';
import { PanelStateManager } from '../../../application/services/PanelStateManager';
import { CaptureSnapshotsUseCase } from '../../../application/useCases/CaptureSnapshotsUseCase';
import { GenerateDiffUseCase } from '../../../application/useCases/GenerateDiffUseCase';
import { AddCommentUseCase } from '../../../application/useCases/AddCommentUseCase';
import { SubmitCommentsUseCase } from '../../../application/useCases/SubmitCommentsUseCase';
import { InMemorySnapshotRepository } from '../../../infrastructure/repositories/InMemorySnapshotRepository';
import { VscodeTerminalGateway } from '../../outbound/gateways/VscodeTerminalGateway';
import { SidecarPanelAdapter } from '../ui/SidecarPanelAdapter';

export class AIDetectionController {
    /** 터미널별 독립 세션 컨텍스트 */
    private sessions = new Map<string, SessionContext>();

    constructor(
        private readonly fileSystemGateway: IFileSystemPort,
        private readonly gitPort: IGitPort,
        private readonly fileGlobber: IFileGlobber,
        private readonly terminalGateway: VscodeTerminalGateway,
        private readonly getExtensionContext: () => vscode.ExtensionContext,
        private readonly commentRepository: ICommentRepository,
        private readonly submitCommentsUseCase: SubmitCommentsUseCase,
        private readonly diffService: DiffService,
        private readonly symbolPort: ISymbolPort
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
            if (this.sessions.has(terminalId)) {
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

    private isAICommand(commandLine: string): boolean {
        return this.isClaudeCommand(commandLine) ||
               this.isCodexCommand(commandLine) ||
               this.isGeminiCommand(commandLine);
    }

    private async activateSidecar(type: AIType, terminal: vscode.Terminal): Promise<void> {
        // 터미널 ID 등록 (처음 보는 터미널이면 새 ID 할당)
        const terminalId = this.registerTerminalId(terminal);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        // 이미 이 터미널에 세션이 있으면 무시
        if (this.sessions.has(terminalId)) {
            return;
        }

        // ===== 세션별 독립 리소스 생성 =====
        const snapshotRepository = new InMemorySnapshotRepository();
        const stateManager = new PanelStateManager();

        // 세션별 UseCase 인스턴스 생성
        const captureSnapshotsUseCase = new CaptureSnapshotsUseCase(
            snapshotRepository,
            this.fileSystemGateway,
            this.fileGlobber
        );

        const generateDiffUseCase = new GenerateDiffUseCase(
            snapshotRepository,
            this.fileSystemGateway,
            this.gitPort,
            this.diffService
        );

        const addCommentUseCase = new AddCommentUseCase(
            this.commentRepository
        );

        // 스냅샷 캡처
        try {
            const config = vscode.workspace.getConfiguration('sidecar');
            const includePatterns = config.get<string[]>('includeFiles', []);
            await captureSnapshotsUseCase.execute(includePatterns);
        } catch (error) {
            console.error('Failed to capture snapshots:', error);
        }

        // Baseline 캡처
        if (workspaceRoot) {
            await this.captureBaseline(workspaceRoot, stateManager);
        }

        await this.moveTerminalToSide(terminalId);

        // ===== 패널 생성 =====
        const panel = SidecarPanelAdapter.createNew(this.getExtensionContext(), terminalId);

        // State manager → Panel 연결
        stateManager.setRenderCallback((state) => panel.render(state));

        // Panel에 UseCase 연결
        panel.setUseCases(
            generateDiffUseCase,
            addCommentUseCase,
            async () => {
                const context = this.sessions.get(terminalId);
                if (context) {
                    const result = await this.submitCommentsUseCase.execute(context.session);
                    if (result) {
                        stateManager.markCommentsAsSubmitted(result.submittedIds);
                    }
                }
            },
            stateManager,
            this.symbolPort
        );

        // ===== SessionContext 생성 및 저장 =====
        const session = AISession.create(type, terminalId);
        const context: SessionContext = {
            terminalId,
            session,
            snapshotRepository,
            stateManager,
            generateDiffUseCase,
            addCommentUseCase,
            captureSnapshotsUseCase,
            disposePanel: () => panel.dispose(),
        };

        this.sessions.set(terminalId, context);

        // Panel dispose 시 세션 정리
        panel.onDispose(() => this.flushSession(terminalId));

        // 터미널 등록
        this.terminalGateway.registerTerminal(terminalId, terminal);

        // AI 상태 업데이트
        stateManager.setAIStatus({ active: true, type });

        // 알림
        vscode.window.showInformationMessage(
            `${session.displayName} detected! Sidecar is now active.`,
            'Show Panel'
        ).then(action => {
            if (action === 'Show Panel') {
                panel.show();
            }
        });
    }

    /**
     * 세션 플러시 - 모든 관련 리소스 정리
     */
    private flushSession(terminalId: string): void {
        const context = this.sessions.get(terminalId);
        if (!context) return;

        console.log(`Flushing session: ${context.session.type} (${terminalId})`);

        // 리소스 정리
        context.snapshotRepository.clear();
        context.stateManager.reset();
        (context.stateManager as PanelStateManager).clearRenderCallback();

        // 터미널 등록 해제
        this.terminalGateway.unregisterTerminal(terminalId);

        // 세션 제거
        this.sessions.delete(terminalId);

        console.log('Session flushed, panel closed');
    }

    /** 터미널 → ID 매핑 (터미널 객체 기반) */
    private terminalIdMap = new WeakMap<vscode.Terminal, string>();
    private terminalCounter = 0;

    /**
     * 터미널 고유 ID 조회 (동기)
     * 이미 등록된 터미널이면 저장된 ID 반환, 아니면 undefined
     */
    private getTerminalId(terminal: vscode.Terminal): string {
        const cached = this.terminalIdMap.get(terminal);
        if (cached) {
            return cached;
        }
        // 등록되지 않은 터미널 - 새 ID 생성하지 않고 임시 ID 반환
        // (handleCommandEnd/handleTerminalClose에서 세션을 찾지 못하게 됨)
        return `terminal-unregistered-${terminal.name || 'unknown'}`;
    }

    /**
     * 터미널 ID 등록 (새 세션 시작 시 호출)
     */
    private registerTerminalId(terminal: vscode.Terminal): string {
        let id = this.terminalIdMap.get(terminal);
        if (!id) {
            const name = terminal.name || 'unnamed';
            id = `terminal-${name}-${++this.terminalCounter}`;
            this.terminalIdMap.set(terminal, id);
        }
        return id;
    }

    private async moveTerminalToSide(terminalId: string): Promise<void> {
        // 이미 이 터미널에 패널이 있으면 스킵
        if (SidecarPanelAdapter.getPanel(terminalId)) {
            return;
        }

        try {
            await vscode.commands.executeCommand('workbench.action.terminal.moveIntoEditor');
        } catch {
            console.log('Terminal move command not available');
        }
    }

    private async captureBaseline(
        workspaceRoot: string,
        stateManager: IPanelStateManager
    ): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('sidecar');
            const includePatterns = config.get<string[]>('includeFiles', []);

            const gitFilesWithStatus = await this.gitPort.getUncommittedFilesWithStatus(workspaceRoot);

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

            const statusMap = new Map(gitFilesWithStatus.map(f => [f.path, f.status]));

            const allPaths = new Set([
                ...gitFilesWithStatus.map(f => f.path),
                ...configFiles
            ]);

            const baselineFiles: FileInfo[] = Array.from(allPaths).map((filePath) => ({
                path: filePath,
                name: path.basename(filePath),
                status: statusMap.get(filePath) || 'modified',
            }));

            stateManager.setBaseline(baselineFiles);

            console.log(`Baseline captured: ${baselineFiles.length} files`);
        } catch (error) {
            console.error('Failed to capture baseline:', error);
        }
    }

    private handleCommandEnd(event: vscode.TerminalShellExecutionEndEvent): void {
        const terminalId = this.getTerminalId(event.terminal);
        const context = this.sessions.get(terminalId);

        if (!context) return;

        const commandLine = event.execution.commandLine.value;

        // AI 명령 종료 시에만 세션 플러시
        if (this.isAICommand(commandLine)) {
            console.log(`AI command ended: ${context.session.type} (${terminalId})`);
            context.disposePanel();  // Panel dispose → flushSession 트리거
        }
    }

    private handleTerminalClose(terminal: vscode.Terminal): void {
        const terminalId = this.getTerminalId(terminal);
        const context = this.sessions.get(terminalId);

        if (context) {
            console.log(`Terminal closed: ${context.session.type} (${terminalId})`);
            context.disposePanel();
        }
    }

    getActiveSession(terminal?: vscode.Terminal): AISession | undefined {
        if (terminal) {
            const terminalId = this.getTerminalId(terminal);
            return this.sessions.get(terminalId)?.session;
        }

        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
            const terminalId = this.getTerminalId(activeTerminal);
            return this.sessions.get(terminalId)?.session;
        }

        const contexts = Array.from(this.sessions.values());
        return contexts[contexts.length - 1]?.session;
    }

    /**
     * 활성 세션들 반환 (FileWatchController에서 사용)
     */
    getSessions(): Map<string, SessionContext> {
        return this.sessions;
    }
}
