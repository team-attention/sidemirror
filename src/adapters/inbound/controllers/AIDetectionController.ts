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
import { GenerateScopedDiffUseCase } from '../../../application/useCases/GenerateScopedDiffUseCase';
import { AddCommentUseCase } from '../../../application/useCases/AddCommentUseCase';
import { EditCommentUseCase } from '../../../application/useCases/EditCommentUseCase';
import { DeleteCommentUseCase } from '../../../application/useCases/DeleteCommentUseCase';
import { SubmitCommentsUseCase } from '../../../application/useCases/SubmitCommentsUseCase';
import { IFetchHNStoriesUseCase } from '../../../application/ports/inbound/IFetchHNStoriesUseCase';
import { ScopeMappingService } from '../../../domain/services/ScopeMappingService';
import { InMemorySnapshotRepository } from '../../../infrastructure/repositories/InMemorySnapshotRepository';
import { VscodeTerminalGateway } from '../../outbound/gateways/VscodeTerminalGateway';
import { SidecarPanelAdapter } from '../ui/SidecarPanelAdapter';

export class AIDetectionController {
    /** 터미널별 독립 세션 컨텍스트 */
    private sessions = new Map<string, SessionContext>();
    private debugChannel: vscode.OutputChannel | undefined;

    /** Stale session cleanup */
    private readonly SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
    private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    private cleanupInterval: NodeJS.Timeout | null = null;

    private log(message: string): void {
        if (!this.debugChannel) return;
        const timestamp = new Date().toISOString().substring(11, 23);
        const memUsage = process.memoryUsage();
        const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
        this.debugChannel.appendLine(`[Sidecar:AI] [${timestamp}] [heap=${heapMB}MB] ${message}`);
    }

    private logError(context: string, error: unknown): void {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        this.log(`❌ ERROR [${context}]: ${errorMsg}`);
        if (stack) {
            this.log(`  Stack: ${stack.split('\n').slice(0, 5).join('\n  ')}`);
        }
    }

    constructor(
        private readonly fileSystemGateway: IFileSystemPort,
        private readonly gitPort: IGitPort,
        private readonly fileGlobber: IFileGlobber,
        private readonly terminalGateway: VscodeTerminalGateway,
        private readonly getExtensionContext: () => vscode.ExtensionContext,
        private readonly commentRepository: ICommentRepository,
        private readonly submitCommentsUseCase: SubmitCommentsUseCase,
        private readonly diffService: DiffService,
        private readonly symbolPort: ISymbolPort,
        private readonly fetchHNStoriesUseCase?: IFetchHNStoriesUseCase
    ) {}

    activate(context: vscode.ExtensionContext): void {
        this.debugChannel = vscode.window.createOutputChannel('Sidecar AI Detection');
        context.subscriptions.push(this.debugChannel);

        this.log('🚀 AIDetectionController activated');

        context.subscriptions.push(
            vscode.window.onDidStartTerminalShellExecution(event => {
                this.log(`🔵 Terminal command started: ${event.execution.commandLine.value.substring(0, 50)}...`);
                this.handleCommandStart(event);
            })
        );

        context.subscriptions.push(
            vscode.window.onDidEndTerminalShellExecution(event => {
                this.log(`🔴 Terminal command ended: ${event.execution.commandLine.value.substring(0, 50)}...`);
                this.handleCommandEnd(event);
            })
        );

        context.subscriptions.push(
            vscode.window.onDidCloseTerminal(terminal => {
                this.log(`⚫ Terminal closed: ${terminal.name}`);
                this.handleTerminalClose(terminal);
            })
        );

        // Periodic health check
        const healthCheckInterval = setInterval(() => {
            const memUsage = process.memoryUsage();
            const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
            const rssMB = (memUsage.rss / 1024 / 1024).toFixed(1);
            this.log(`💓 Health: sessions=${this.sessions.size}, heap=${heapMB}MB, rss=${rssMB}MB`);
        }, 30000);

        context.subscriptions.push({ dispose: () => clearInterval(healthCheckInterval) });

        // Start stale session cleanup interval
        this.startCleanupInterval();
        context.subscriptions.push({ dispose: () => this.disposeCleanupInterval() });
    }

    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleSessions();
        }, this.CLEANUP_INTERVAL_MS);
    }

    private disposeCleanupInterval(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    private cleanupStaleSessions(): void {
        const now = Date.now();
        for (const [terminalId, session] of this.sessions) {
            if (now - session.lastActivityTime > this.SESSION_TIMEOUT_MS) {
                this.log(`🧹 Cleaning up stale session: ${terminalId} (inactive for ${Math.round((now - session.lastActivityTime) / 60000)}min)`);
                session.disposePanel();  // This will trigger flushSession
            }
        }
    }

    private updateSessionActivity(terminalId: string): void {
        const session = this.sessions.get(terminalId);
        if (session) {
            session.lastActivityTime = Date.now();
        }
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
                this.log(`  Skip: session already exists for ${terminalId}`);
                return;
            }

            if (this.isClaudeCommand(commandLine)) {
                this.log('🤖 Claude Code detected!');
                await this.activateSidecar('claude', terminal);
            } else if (this.isCodexCommand(commandLine)) {
                this.log('🤖 Codex detected!');
                await this.activateSidecar('codex', terminal);
            } else if (this.isGeminiCommand(commandLine)) {
                this.log('🤖 Gemini CLI detected!');
                await this.activateSidecar('gemini', terminal);
            }
        } catch (error) {
            this.logError('handleCommandStart', error);
        }
    }

    private isClaudeCommand(commandLine: string): boolean {
        // 명령어가 claude 또는 claude-code로 시작하는 경우만 감지
        // npx claude, bunx claude 등도 지원
        return /^(npx\s+|bunx\s+|pnpx\s+)?claude(-code)?(\s|$)/.test(commandLine.trim());
    }

    private isCodexCommand(commandLine: string): boolean {
        // 명령어가 codex로 시작하는 경우만 감지
        return /^(npx\s+|bunx\s+|pnpx\s+)?codex(\s|$)/.test(commandLine.trim());
    }

    private isGeminiCommand(commandLine: string): boolean {
        const normalized = commandLine.trim().toLowerCase();
        // 명령어가 gemini로 시작하거나 gcloud ai gemini 명령인 경우만 감지
        return (
            /^(npx\s+|bunx\s+|pnpx\s+)?gemini(\s|$)/.test(normalized) ||
            /^npx\s+@google\/generative-ai-cli(\s|$)/.test(normalized) ||
            /^gcloud\s+ai\s+gemini(\s|$)/.test(normalized)
        );
    }

    private isAICommand(commandLine: string): boolean {
        return this.isClaudeCommand(commandLine) ||
               this.isCodexCommand(commandLine) ||
               this.isGeminiCommand(commandLine);
    }

    private async activateSidecar(type: AIType, terminal: vscode.Terminal): Promise<void> {
        const startTime = Date.now();
        this.log(`🟢 activateSidecar START: type=${type}`);

        // 터미널 ID 등록 (처음 보는 터미널이면 새 ID 할당)
        const terminalId = this.registerTerminalId(terminal);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        // 이미 이 터미널에 세션이 있으면 무시
        if (this.sessions.has(terminalId)) {
            this.log(`  Skip: session already exists`);
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

        const editCommentUseCase = new EditCommentUseCase(
            this.commentRepository
        );

        const deleteCommentUseCase = new DeleteCommentUseCase(
            this.commentRepository
        );

        const scopeMappingService = new ScopeMappingService();
        const generateScopedDiffUseCase = new GenerateScopedDiffUseCase(
            generateDiffUseCase,
            this.symbolPort,
            this.fileSystemGateway,
            scopeMappingService
        );

        // 스냅샷 캡처
        try {
            const config = vscode.workspace.getConfiguration('sidecar');
            const includePatterns = config.get<string[]>('includeFiles', []);
            await captureSnapshotsUseCase.execute(includePatterns);
        } catch (error) {
            console.error('[Sidecar] Failed to capture snapshots:', error);
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
            this.symbolPort,
            editCommentUseCase,
            deleteCommentUseCase,
            this.fetchHNStoriesUseCase,
            generateScopedDiffUseCase
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
            lastActivityTime: Date.now(),
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

        const elapsed = Date.now() - startTime;
        this.log(`🟢 activateSidecar END: terminalId=${terminalId}, elapsed=${elapsed}ms, totalSessions=${this.sessions.size}`);
    }

    /**
     * 세션 플러시 - 모든 관련 리소스 정리
     */
    private flushSession(terminalId: string): void {
        const context = this.sessions.get(terminalId);
        if (!context) {
            this.log(`⚪ flushSession: no context for ${terminalId}`);
            return;
        }

        this.log(`🔄 flushSession START: ${context.session.type} (${terminalId})`);

        try {
            // 리소스 정리
            context.snapshotRepository.clear();
            context.stateManager.reset();
            (context.stateManager as PanelStateManager).clearRenderCallback();

            // 터미널 등록 해제
            this.terminalGateway.unregisterTerminal(terminalId);

            // 세션 제거
            this.sessions.delete(terminalId);

            this.log(`🔄 flushSession END: remainingSessions=${this.sessions.size}`);
        } catch (error) {
            this.logError('flushSession', error);
        }
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
            console.log('[Sidecar] Terminal move command not available');
        }
    }

    private async captureBaseline(
        workspaceRoot: string,
        stateManager: IPanelStateManager
    ): Promise<void> {
        try {
            const gitFilesWithStatus = await this.gitPort.getUncommittedFilesWithStatus(workspaceRoot);

            const baselineFiles: FileInfo[] = gitFilesWithStatus.map((f) => ({
                path: f.path,
                name: path.basename(f.path),
                status: f.status,
            }));

            stateManager.setBaseline(baselineFiles);
        } catch (error) {
            console.error('[Sidecar] Failed to capture baseline:', error);
        }
    }

    private handleCommandEnd(event: vscode.TerminalShellExecutionEndEvent): void {
        const terminalId = this.getTerminalId(event.terminal);
        const context = this.sessions.get(terminalId);

        if (!context) return;

        const commandLine = event.execution.commandLine.value;

        // AI 명령 종료 시에만 세션 플러시
        if (this.isAICommand(commandLine)) {
            console.log(`[Sidecar] AI command ended: ${context.session.type} (${terminalId})`);
            context.disposePanel();  // Panel dispose → flushSession 트리거
        }
    }

    private handleTerminalClose(terminal: vscode.Terminal): void {
        const terminalId = this.getTerminalId(terminal);
        const context = this.sessions.get(terminalId);

        if (context) {
            console.log(`[Sidecar] Terminal closed: ${context.session.type} (${terminalId})`);
            context.disposePanel();
        }
    }

    getActiveSession(terminal?: vscode.Terminal): AISession | undefined {
        if (terminal) {
            const terminalId = this.getTerminalId(terminal);
            const context = this.sessions.get(terminalId);
            if (context) {
                this.updateSessionActivity(terminalId);
            }
            return context?.session;
        }

        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
            const terminalId = this.getTerminalId(activeTerminal);
            const context = this.sessions.get(terminalId);
            if (context) {
                this.updateSessionActivity(terminalId);
            }
            return context?.session;
        }

        // Avoid Array.from() - iterate directly to get last session
        let lastContext: SessionContext | undefined;
        for (const context of this.sessions.values()) {
            lastContext = context;
        }
        return lastContext?.session;
    }

    /**
     * 활성 세션들 반환 (FileWatchController에서 사용)
     */
    getSessions(): Map<string, SessionContext> {
        return this.sessions;
    }
}
