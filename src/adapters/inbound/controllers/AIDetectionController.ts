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
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';
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
import {
    IWorkspaceStatePort,
    WORKSPACE_STATE_KEYS,
    AutoOpenPanelSetting,
} from '../../../application/ports/outbound/IWorkspaceStatePort';
import { ScopeMappingService } from '../../../domain/services/ScopeMappingService';
import { InMemorySnapshotRepository } from '../../../infrastructure/repositories/InMemorySnapshotRepository';
import { VscodeTerminalGateway } from '../../outbound/gateways/VscodeTerminalGateway';
import { SidecarPanelAdapter } from '../ui/SidecarPanelAdapter';

// Forward declaration for FileWatchController interface
interface IFileWatchController {
    registerSessionWorkspace(terminalId: string, workspaceRoot: string): Promise<void>;
    unregisterSessionWorkspace(terminalId: string): void;
}

export class AIDetectionController {
    /** 터미널별 독립 세션 컨텍스트 */
    private sessions = new Map<string, SessionContext>();
    private debugChannel: vscode.OutputChannel | undefined;

    /** FileWatchController reference for worktree support */
    private fileWatchController: IFileWatchController | undefined;

    /** ThreadStateRepository for worktree path lookup */
    private threadStateRepository: IThreadStateRepository | undefined;

    /** Callback for session changes (used by ThreadListController) */
    private onSessionChangeCallback?: () => void;

    /** Callback for terminal focus changes (used by ThreadListController) */
    private onTerminalFocusCallback?: (terminalId: string) => void;

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
        private readonly fetchHNStoriesUseCase?: IFetchHNStoriesUseCase,
        private readonly workspaceStatePort?: IWorkspaceStatePort
    ) {}

    /**
     * Set FileWatchController reference for worktree session tracking.
     */
    setFileWatchController(controller: IFileWatchController): void {
        this.fileWatchController = controller;
    }

    /**
     * Set ThreadStateRepository reference for worktree path lookup.
     */
    setThreadStateRepository(repository: IThreadStateRepository): void {
        this.threadStateRepository = repository;
    }

    /**
     * Set callback for session changes (used by ThreadListController).
     */
    setOnSessionChange(callback: () => void): void {
        this.onSessionChangeCallback = callback;
    }

    /**
     * Set callback for terminal focus changes (used by ThreadListController).
     */
    setOnTerminalFocus(callback: (terminalId: string) => void): void {
        this.onTerminalFocusCallback = callback;
    }

    /**
     * Notify listeners of session changes.
     */
    private notifySessionChange(): void {
        this.onSessionChangeCallback?.();
    }

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

        // Focus panel when terminal is focused
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTerminal(terminal => {
                if (terminal) {
                    this.handleTerminalFocus(terminal);
                }
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
    }

    private async handleCommandStart(
        event: vscode.TerminalShellExecutionStartEvent
    ): Promise<void> {
        try {
            const commandLine = event.execution.commandLine.value;
            const terminal = event.terminal;
            const terminalId = this.getTerminalId(terminal);

            this.log(`📥 handleCommandStart: cmd="${commandLine}", terminal="${terminal.name}", id=${terminalId}`);

            // Skip if already have an active session for this terminal
            if (this.sessions.has(terminalId)) {
                this.log(`  Skip: session already exists for ${terminalId}`);
                return;
            }

            if (this.isClaudeCommand(commandLine)) {
                this.log('🤖 Claude Code detected!');
                await this.promptAndActivateSidecar('claude', terminal);
            } else if (this.isCodexCommand(commandLine)) {
                this.log('🤖 Codex detected!');
                await this.promptAndActivateSidecar('codex', terminal);
            } else if (this.isGeminiCommand(commandLine)) {
                this.log('🤖 Gemini CLI detected!');
                await this.promptAndActivateSidecar('gemini', terminal);
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

    /**
     * Prompt user before opening Sidecar panel.
     * Respects saved preference (always/never/ask).
     */
    private async promptAndActivateSidecar(type: AIType, terminal: vscode.Terminal): Promise<void> {
        const displayName = AISession.getDisplayName(type);

        // Check saved preference
        const setting = this.workspaceStatePort?.get<AutoOpenPanelSetting>(
            WORKSPACE_STATE_KEYS.AUTO_OPEN_PANEL
        ) ?? 'ask';

        if (setting === 'never') {
            this.log(`  Skip: user preference is 'never'`);
            return;
        }

        if (setting === 'always') {
            this.log(`  Auto-open: user preference is 'always'`);
            await this.activateSidecar(type, terminal);
            return;
        }

        // Ask user with QuickPick
        const items: vscode.QuickPickItem[] = [
            { label: '$(check) Yes', description: 'Open panel', picked: true },
            { label: '$(x) No', description: 'Not this time' },
            { label: '$(sync) Always', description: "Don't ask again" },
            { label: '$(circle-slash) Never', description: 'Never open automatically' },
        ];

        const pick = await vscode.window.showQuickPick(items, {
            title: `$(hubot) ${displayName} detected! Open Sidecar?`,
            placeHolder: 'Choose an option',
            ignoreFocusOut: true,
        });

        if (!pick) {
            this.log(`  User dismissed picker`);
            return;
        }

        if (pick.label.includes('Yes')) {
            await this.activateSidecar(type, terminal);
        } else if (pick.label.includes('Always')) {
            await this.workspaceStatePort?.set(WORKSPACE_STATE_KEYS.AUTO_OPEN_PANEL, 'always');
            await this.activateSidecar(type, terminal);
        } else if (pick.label.includes('Never')) {
            await this.workspaceStatePort?.set(WORKSPACE_STATE_KEYS.AUTO_OPEN_PANEL, 'never');
            this.log(`  User chose 'Never' - preference saved`);
        } else {
            this.log(`  User declined to open panel`);
        }
    }

    private async activateSidecar(type: AIType, terminal: vscode.Terminal): Promise<void> {
        const startTime = Date.now();
        this.log(`🟢 activateSidecar START: type=${type}, terminal="${terminal.name}"`);

        // 터미널 ID 등록 (처음 보는 터미널이면 새 ID 할당)
        const terminalId = this.registerTerminalId(terminal);
        this.log(`🟢 activateSidecar: registered terminalId=${terminalId}`);

        // ThreadState 조회 (worktree 경로 확인용)
        const threadState = await this.threadStateRepository?.findByTerminalId(terminalId);
        this.log(`🟢 activateSidecar: threadState=${threadState ? `found (worktreePath=${threadState.worktreePath})` : 'none'}`);

        // 터미널의 현재 작업 디렉토리 감지 (worktree 지원)
        // Priority: threadState.worktreePath > terminal.shellIntegration.cwd > workspace folder
        const terminalCwd = terminal.shellIntegration?.cwd?.fsPath;
        const fallbackRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const workspaceRoot = threadState?.worktreePath || terminalCwd || fallbackRoot;

        this.log(`🟢 activateSidecar: worktreePath=${threadState?.worktreePath}, terminalCwd=${terminalCwd}, fallbackRoot=${fallbackRoot}, using=${workspaceRoot}`);

        // 이미 이 터미널에 세션이 있으면 무시
        if (this.sessions.has(terminalId)) {
            this.log(`  Skip: session already exists for ${terminalId}`);
            return;
        }

        // ===== 세션별 독립 리소스 생성 =====
        const snapshotRepository = new InMemorySnapshotRepository();
        const stateManager = new PanelStateManager();

        // 세션별 UseCase 인스턴스 생성
        const captureSnapshotsUseCase = new CaptureSnapshotsUseCase(
            snapshotRepository,
            this.fileSystemGateway,
            this.fileGlobber,
            workspaceRoot  // 세션별 workspaceRoot (worktree 지원)
        );

        const generateDiffUseCase = new GenerateDiffUseCase(
            snapshotRepository,
            this.fileSystemGateway,
            this.gitPort,
            this.diffService,
            workspaceRoot  // 세션별 workspaceRoot (worktree 지원)
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

        // ===== 싱글 패널 생성 또는 재사용 =====
        const panel = SidecarPanelAdapter.getOrCreate(this.getExtensionContext());
        const isFirstSession = this.sessions.size === 0;

        // 세션 전환을 위한 콜백 (아직 context 생성 전이므로 클로저 사용)
        const submitCallback = async () => {
            const ctx = this.sessions.get(terminalId);
            if (ctx) {
                const result = await this.submitCommentsUseCase.execute(ctx.session);
                if (result) {
                    stateManager.markCommentsAsSubmitted(result.submittedIds);
                }
            }
        };

        // 세션 전환 (UseCase, StateManager 연결)
        panel.switchToSession(
            terminalId,
            workspaceRoot,
            generateDiffUseCase,
            addCommentUseCase,
            submitCallback,
            stateManager,
            this.symbolPort,
            editCommentUseCase,
            deleteCommentUseCase,
            this.fetchHNStoriesUseCase,
            generateScopedDiffUseCase
        );

        // State manager → Panel 연결 (현재 포커스된 세션만)
        stateManager.setRenderCallback((state) => {
            // Only render if this session is currently focused
            if (panel.getTerminalId() === terminalId) {
                panel.render(state);
            }
        });

        // ===== SessionContext 생성 및 저장 =====
        const session = AISession.create(type, terminalId);
        // Set initial status to 'inactive' - agent just started, waiting for first interaction
        // Status will change to 'working'/'idle' based on terminal activity
        session.setAgentMetadata({
            name: threadState?.name ?? session.displayName,
            status: 'inactive',
            fileCount: 0,
        });
        const submitCommentsCallback = async () => {
            const ctx = this.sessions.get(terminalId);
            if (ctx) {
                const result = await this.submitCommentsUseCase.execute(ctx.session);
                if (result) {
                    stateManager.markCommentsAsSubmitted(result.submittedIds);
                }
            }
        };

        const context: SessionContext = {
            terminalId,
            session,
            workspaceRoot: workspaceRoot || '',
            snapshotRepository,
            stateManager,
            generateDiffUseCase,
            addCommentUseCase,
            editCommentUseCase,
            deleteCommentUseCase,
            generateScopedDiffUseCase,
            fetchHNStoriesUseCase: this.fetchHNStoriesUseCase,
            captureSnapshotsUseCase,
            // Panel은 세션이 닫힐 때 dispose하지 않음 (싱글 패널이므로)
            disposePanel: () => {
                // 세션 정리만 수행, 패널은 유지
                this.log(`📤 Session closed: ${terminalId}`);
            },
            submitComments: submitCommentsCallback,
            // ThreadState for worktree support
            threadState: threadState ?? undefined,
        };

        this.sessions.set(terminalId, context);
        this.log(`🟢 activateSidecar: session created, totalSessions=${this.sessions.size}`);

        // Notify session change listeners
        this.notifySessionChange();

        // Register worktree watcher if workspaceRoot differs from VSCode workspace
        if (workspaceRoot && this.fileWatchController) {
            await this.fileWatchController.registerSessionWorkspace(terminalId, workspaceRoot);
        }

        // 첫 세션일 때만 패널 dispose 콜백 설정
        if (isFirstSession) {
            panel.onDispose(() => {
                this.log(`📤 Panel disposed - clearing all sessions`);
                // 패널이 닫히면 모든 세션 정리
                for (const [id] of this.sessions) {
                    this.flushSession(id);
                }
            });
        }

        // 터미널 등록
        this.terminalGateway.registerTerminal(terminalId, terminal);

        // AI 상태 업데이트
        stateManager.setAIStatus({ active: true, type });

        // Set threadId on state manager for comment isolation
        stateManager.setThreadId(threadState?.threadId);

        // Load existing comments for this thread
        if (threadState) {
            const comments = await this.commentRepository.findByThreadId(threadState.threadId);
            // Also include comments without threadId (backward compatibility)
            const allComments = await this.commentRepository.findActive();
            const legacyComments = allComments.filter(c => !c.threadId);
            const threadComments = [...comments, ...legacyComments];

            stateManager.setComments(threadComments.map(c => ({
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

        // 패널 자동 표시
        panel.show();
        this.log(`🟢 activateSidecar: panel.show() called`);

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

        // 세션 먼저 제거 (에러 발생해도 세션은 삭제되도록)
        this.sessions.delete(terminalId);

        // Notify session change listeners
        this.notifySessionChange();

        try {
            // 렌더 콜백 먼저 해제 (dispose된 webview 접근 방지)
            (context.stateManager as PanelStateManager).clearRenderCallback();

            // 리소스 정리
            context.snapshotRepository.clear();
            context.stateManager.reset();

            // 터미널 등록 해제
            this.terminalGateway.unregisterTerminal(terminalId);

            // Worktree watcher 해제
            this.fileWatchController?.unregisterSessionWorkspace(terminalId);

            this.log(`🔄 flushSession END: remainingSessions=${this.sessions.size}`);
        } catch (error) {
            this.logError('flushSession cleanup', error);
            this.log(`🔄 flushSession END (with error): remainingSessions=${this.sessions.size}`);
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
     * Priority: VscodeTerminalGateway에 등록된 ID > 기존 매핑 > 새 ID 생성
     */
    private registerTerminalId(terminal: vscode.Terminal): string {
        // Check if already cached
        let id = this.terminalIdMap.get(terminal);
        if (id) {
            return id;
        }

        // Check if VscodeTerminalGateway has this terminal (created via CreateThreadUseCase)
        const gatewayId = this.terminalGateway.getTerminalId(terminal);
        if (gatewayId) {
            this.terminalIdMap.set(terminal, gatewayId);
            return gatewayId;
        }

        // Fallback: generate new ID for terminals created outside CreateThreadUseCase
        const name = terminal.name || 'unnamed';
        id = `terminal-${name}-${++this.terminalCounter}`;
        this.terminalIdMap.set(terminal, id);
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
            this.flushSession(terminalId);
        }
    }

    private handleTerminalClose(terminal: vscode.Terminal): void {
        const terminalId = this.getTerminalId(terminal);
        const context = this.sessions.get(terminalId);

        if (context) {
            console.log(`[Sidecar] Terminal closed: ${context.session.type} (${terminalId})`);
            this.flushSession(terminalId);
        }
        // 세션이 없으면 무시 (싱글 패널은 세션과 독립적으로 유지)
    }

    private async handleTerminalFocus(terminal: vscode.Terminal): Promise<void> {
        const terminalId = this.getTerminalId(terminal);
        const context = this.sessions.get(terminalId);

        if (context) {
            // Notify ThreadListController to update thread selection
            this.onTerminalFocusCallback?.(terminalId);

            // Load comments for this thread before switching
            const threadState = context.threadState;
            if (threadState) {
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

            // Switch panel to this session's context
            const panel = SidecarPanelAdapter.currentPanel;
            if (panel) {
                panel.switchToSession(
                    terminalId,
                    context.workspaceRoot,
                    context.generateDiffUseCase,
                    context.addCommentUseCase,
                    async () => {
                        const result = await this.submitCommentsUseCase.execute(context.session);
                        if (result) {
                            context.stateManager.markCommentsAsSubmitted(result.submittedIds);
                        }
                    },
                    context.stateManager,
                    this.symbolPort,
                    context.editCommentUseCase,
                    context.deleteCommentUseCase,
                    context.fetchHNStoriesUseCase,
                    context.generateScopedDiffUseCase
                );
                panel.show();
            }
        }
    }

    getActiveSession(terminal?: vscode.Terminal): AISession | undefined {
        if (terminal) {
            const terminalId = this.getTerminalId(terminal);
            const context = this.sessions.get(terminalId);
            return context?.session;
        }

        const activeTerminal = vscode.window.activeTerminal;
        if (activeTerminal) {
            const terminalId = this.getTerminalId(activeTerminal);
            const context = this.sessions.get(terminalId);
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

    /**
     * Detect AI type from terminal name or thread name.
     */
    private detectAITypeFromName(name: string): AIType {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('codex')) {
            return 'codex';
        }
        if (lowerName.includes('gemini')) {
            return 'gemini';
        }
        return 'claude';
    }

    /**
     * Attach Sidecar to a terminal by its ID.
     * Used when creating threads via the UI.
     */
    async attachToTerminalById(terminalId: string): Promise<void> {
        const terminal = this.terminalGateway.getTerminal(terminalId);
        if (!terminal) {
            this.log(`⚠️ attachToTerminalById: terminal not found for ${terminalId}`);
            return;
        }

        // Skip if already have session
        if (this.sessions.has(terminalId)) {
            this.log(`  Skip: session already exists for ${terminalId}`);
            const panel = SidecarPanelAdapter.getPanel(terminalId);
            if (panel) {
                panel.show();
            }
            return;
        }

        // Detect AI type from terminal name or thread state
        const threadState = await this.threadStateRepository?.findByTerminalId(terminalId);
        const nameToCheck = threadState?.name ?? terminal.name;
        const aiType = this.detectAITypeFromName(nameToCheck);
        this.log(`🔍 attachToTerminalById: detected aiType=${aiType} from name="${nameToCheck}"`);

        await this.activateSidecar(aiType, terminal);
    }

    /**
     * Show picker to attach Sidecar to an existing terminal.
     * Shows terminals that don't have a Sidecar panel attached.
     */
    async attachToTerminal(): Promise<void> {
        const terminals = vscode.window.terminals;

        if (terminals.length === 0) {
            vscode.window.showInformationMessage('No terminals available.');
            return;
        }

        // Build list of terminals without active sessions
        const availableTerminals: Array<{
            terminal: vscode.Terminal;
            terminalId: string;
            label: string;
            hasSession: boolean;
        }> = [];

        for (const terminal of terminals) {
            const terminalId = this.getTerminalId(terminal);
            const hasSession = this.sessions.has(terminalId);
            availableTerminals.push({
                terminal,
                terminalId,
                label: terminal.name || `Terminal ${terminalId}`,
                hasSession,
            });
        }

        // Log current state for debugging
        this.log(`📋 attachToTerminal: ${availableTerminals.length} terminals`);
        for (const t of availableTerminals) {
            const panel = SidecarPanelAdapter.getPanel(t.terminalId);
            this.log(`  - ${t.label} (${t.terminalId}): session=${t.hasSession}, panel=${!!panel}`);
        }

        // Clean up orphaned sessions (session exists but panel is gone)
        for (const t of availableTerminals) {
            if (t.hasSession) {
                const panel = SidecarPanelAdapter.getPanel(t.terminalId);
                if (!panel) {
                    // Session exists but panel is gone - clean up
                    this.log(`🧹 Cleaning orphaned session: ${t.terminalId}`);
                    this.flushSession(t.terminalId);
                    t.hasSession = false;
                }
            }
        }

        // Re-filter after cleanup
        const terminalsWithoutSession = availableTerminals.filter((t) => !t.hasSession);

        if (terminalsWithoutSession.length === 0) {
            this.log(`📋 All terminals have sessions, showing "show existing panel" picker`);
            // All have sessions with valid panels - offer to show existing panel
            const sessionsWithPanels = availableTerminals.filter((t) => t.hasSession);
            if (sessionsWithPanels.length > 0) {
                const items: vscode.QuickPickItem[] = sessionsWithPanels.map((t) => ({
                    label: t.label,
                    description: 'Show existing panel',
                }));

                const pick = await vscode.window.showQuickPick(items, {
                    title: 'Show Sidecar Panel',
                    placeHolder: 'All terminals have panels. Select one to show:',
                });

                if (pick) {
                    const selected = sessionsWithPanels.find((t) => t.label === pick.label);
                    if (selected) {
                        this.log(`📋 User selected "${selected.label}" (${selected.terminalId})`);
                        const panel = SidecarPanelAdapter.getPanel(selected.terminalId);
                        this.log(`📋 getPanel returned: ${panel ? 'found' : 'undefined'}`);
                        if (panel) {
                            panel.show();
                            this.log(`📋 panel.show() called`);
                        } else {
                            this.log(`📋 ERROR: panel is undefined but session exists!`);
                        }
                    }
                }
            }
            return;
        }

        // If only one terminal without session, auto-attach
        if (terminalsWithoutSession.length === 1) {
            this.log(`📋 Only one terminal available, auto-attaching`);
            const t = terminalsWithoutSession[0];
            const aiType = this.detectAITypeFromName(t.terminal.name);
            await this.activateSidecar(aiType, t.terminal);
            return;
        }

        // Show quick pick for terminals without session
        const items: vscode.QuickPickItem[] = terminalsWithoutSession.map((t) => ({
            label: t.label,
            description: `ID: ${t.terminalId}`,
        }));

        const pick = await vscode.window.showQuickPick(items, {
            title: 'Attach Sidecar to Terminal',
            placeHolder: 'Select a terminal to attach Sidecar panel',
        });

        if (!pick) {
            return;
        }

        const selected = terminalsWithoutSession.find((t) => t.label === pick.label);
        if (!selected) {
            return;
        }

        // Detect AI type from terminal name and activate
        const aiType = this.detectAITypeFromName(selected.terminal.name);
        await this.activateSidecar(aiType, selected.terminal);
    }
}
