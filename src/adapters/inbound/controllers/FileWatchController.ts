import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import ignore, { Ignore } from 'ignore';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { DiffDisplayState, ChunkDisplayInfo, FileInfo } from '../../../application/ports/outbound/PanelState';
import { DiffResult } from '../../../domain/entities/Diff';
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';
import { ITrackFileOwnershipUseCase } from '../../../application/ports/inbound/ITrackFileOwnershipUseCase';
import {
    BatchEventCollector,
    IBatchEventCollector,
    FileChangeEvent,
    coalesceFileEvents
} from '../../../application/services/BatchEventCollector';

/**
 * Fixed-size circular buffer to prevent memory growth.
 * When full, new items overwrite oldest entries.
 */
class CircularBuffer<T> {
    private buffer: (T | undefined)[];
    private head = 0;
    private tail = 0;
    private _size = 0;

    constructor(private capacity: number) {
        this.buffer = new Array(capacity);
    }

    push(item: T): void {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        if (this._size < this.capacity) {
            this._size++;
        } else {
            this.head = (this.head + 1) % this.capacity;
        }
    }

    get size(): number {
        return this._size;
    }

    *[Symbol.iterator](): Iterator<T> {
        for (let i = 0; i < this._size; i++) {
            const index = (this.head + i) % this.capacity;
            yield this.buffer[index] as T;
        }
    }

    countIf(predicate: (item: T) => boolean): number {
        let count = 0;
        for (const item of this) {
            if (predicate(item)) count++;
        }
        return count;
    }

    clear(): void {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.tail = 0;
        this._size = 0;
    }
}

/** Per-session worktree watcher resources */
interface SessionWorktreeWatcher {
    terminalId: string;
    workspaceRoot: string;
    headWatcher: vscode.FileSystemWatcher | undefined;
    lastHeadCommit: string | undefined;
    /** FileSystemWatcher for worktree directory */
    fileWatcher: vscode.FileSystemWatcher | undefined;
    /** Batch event collector for worktree file changes */
    batchCollector: IBatchEventCollector | undefined;
    /** Whitelist watchers for this worktree session */
    whitelistWatchers: vscode.FileSystemWatcher[];
}

export class FileWatchController {
    private gitignore: Ignore;
    private includePatterns: Ignore;
    private workspaceRoot: string | undefined;
    private gitPort: IGitPort | undefined;
    private debugChannel: vscode.OutputChannel | undefined;
    private gitHeadWatcher: vscode.FileSystemWatcher | undefined;
    private lastHeadCommit: string | undefined;

    /** 모든 활성 세션 참조 */
    private sessions: Map<string, SessionContext> | undefined;

    /** Deduplication map for rapid file events */
    private lastProcessedChanges: Map<string, number> = new Map();
    /** Watchers for whitelisted file patterns */
    private whitelistWatchers: vscode.FileSystemWatcher[] = [];
    /** Extension context for config change handling */
    private extensionContext: vscode.ExtensionContext | undefined;

    // ===== Session-specific worktree watchers =====
    /** Watchers for sessions with different workspaceRoot (worktree support) */
    private sessionWorktreeWatchers: Map<string, SessionWorktreeWatcher> = new Map();

    // ===== Debug metrics =====
    private eventCount = 0;
    private eventCountWindow = new CircularBuffer<number>(1000); // timestamps of recent events
    private processedCount = 0;
    private lastStatsLog = Date.now();
    private pendingEvents = 0;
    private maxPendingEvents = 0;

    // ===== Batch Event Collection =====
    /** Batch event collector for coalescing file changes */
    private batchCollector: IBatchEventCollector | undefined;
    /** Batch window timer (ms) - max time before flush */
    private batchWindowMs: number = 100;
    /** Batch idle timer (ms) - idle time after last event before flush */
    private batchIdleMs: number = 50;

    // ===== Commit Grace Period =====
    /** Grace period after commit to ignore file change events (ms) */
    private static readonly COMMIT_GRACE_PERIOD_MS = 200;
    /** Timestamp when main workspace commit was processed */
    private lastMainCommitTime: number = 0;
    /** Timestamps when worktree commits were processed (per terminalId) */
    private lastWorktreeCommitTimes: Map<string, number> = new Map();

    // ===== Thread tracking =====
    /** Current thread's terminal ID (null = no thread selected) */
    private currentThreadId: string | null = null;
    /** Current thread's whitelist patterns */
    private currentThreadPatterns: string[] = [];
    /** Current thread's state ID (for repository operations) */
    private currentThreadStateId: string | undefined;
    /** Repository for persisting thread state changes */
    private threadStateRepository: IThreadStateRepository | undefined;
    /** Use case for tracking file ownership */
    private trackFileOwnershipUseCase: ITrackFileOwnershipUseCase | undefined;

    constructor() {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    private log(message: string): void {
        if (!this.debugChannel) return;
        try {
            const timestamp = new Date().toISOString().substring(11, 23);
            this.debugChannel.appendLine(`[Code Squad] [${timestamp}] ${message}`);
        } catch {
            // Channel may be disposed during extension deactivation
        }
    }

    private logStats(): void {
        const now = Date.now();
        // Log stats every 10 seconds
        if (now - this.lastStatsLog < 10000) return;

        // Calculate events per second (last 10 seconds) using circular buffer
        const windowStart = now - 10000;
        const recentCount = this.eventCountWindow.countIf(t => t > windowStart);
        const eventsPerSecond = (recentCount / 10).toFixed(1);

        const memUsage = process.memoryUsage();
        const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);

        const mode = this.getWatchMode();
        this.log(`[Stats] rate=${eventsPerSecond}/s, pending=${this.pendingEvents}, maxPending=${this.maxPendingEvents}, total=${this.eventCount}, mode=${mode}, heap=${heapMB}MB`);

        if (recentCount > 50) {
            this.log(`WARNING: High event rate! ${recentCount} events in last 10 seconds`);
        }

        this.lastStatsLog = now;
        this.maxPendingEvents = Math.max(this.maxPendingEvents, this.pendingEvents);
    }

    private logError(context: string, error: unknown): void {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : '';
        this.log(`❌ ERROR [${context}]: ${errorMsg}`);
        if (stack) {
            this.log(`  Stack: ${stack.split('\n').slice(0, 3).join(' -> ')}`);
        }
    }

    /**
     * 세션 맵 참조 설정 (AIDetectionController에서 호출)
     */
    setSessionsRef(sessions: Map<string, SessionContext>): void {
        this.sessions = sessions;
    }

    setGitPort(gitPort: IGitPort): void {
        this.gitPort = gitPort;
    }

    setThreadStateRepository(repo: IThreadStateRepository): void {
        this.threadStateRepository = repo;
    }

    setTrackFileOwnershipUseCase(useCase: ITrackFileOwnershipUseCase): void {
        this.trackFileOwnershipUseCase = useCase;
    }

    /**
     * Set the current thread and apply its whitelist patterns.
     * Called when user selects a thread in ThreadListController.
     *
     * @param terminalId The terminal ID (null for "All Agents" view)
     * @param patterns The thread's whitelist patterns
     * @param threadStateId The actual thread state ID (for repository operations)
     */
    setCurrentThread(
        terminalId: string | null,
        patterns: string[],
        threadStateId?: string
    ): void {
        this.currentThreadId = terminalId;
        this.currentThreadPatterns = patterns;
        this.currentThreadStateId = threadStateId;
        this.log(`[Thread] Set current thread: ${terminalId ?? 'none'} (patterns=${patterns.length}, stateId=${threadStateId ?? 'none'})`);

        // Rebuild effective patterns (global + thread)
        this.rebuildIncludePatterns();
    }

    /**
     * Get the current thread's terminal ID.
     * Returns null if no thread is selected.
     */
    getCurrentThreadId(): string | null {
        return this.currentThreadId;
    }

    /**
     * Get the current thread's state ID (for repository operations).
     */
    getCurrentThreadStateId(): string | undefined {
        return this.currentThreadStateId;
    }

    /**
     * Add a whitelist pattern.
     * If a thread is selected, saves to thread state.
     * Otherwise, saves to global config.
     *
     * @param pattern The glob pattern to add
     */
    async addWhitelistPattern(pattern: string): Promise<void> {
        if (this.currentThreadStateId && this.threadStateRepository) {
            // Save to current thread using the efficient updateWhitelist method
            const newPatterns = [...this.currentThreadPatterns];
            if (!newPatterns.includes(pattern)) {
                newPatterns.push(pattern);
                await this.threadStateRepository.updateWhitelist(this.currentThreadStateId, newPatterns);
                this.log(`[Thread] Added pattern "${pattern}" to thread ${this.currentThreadStateId}`);

                // Update current patterns and rebuild
                this.currentThreadPatterns = newPatterns;
                this.rebuildIncludePatterns();
                return;
            }
            return; // Pattern already exists
        }

        // Fallback: Save to global config (existing behavior)
        const config = vscode.workspace.getConfiguration('codeSquad');
        const current = config.get<string[]>('includeFiles', []);
        if (!current.includes(pattern)) {
            await config.update('includeFiles', [...current, pattern], vscode.ConfigurationTarget.Workspace);
            this.log(`[Global] Added pattern "${pattern}" to global config`);
        }
    }

    /**
     * Rebuild include patterns from global config + current thread patterns.
     */
    private rebuildIncludePatterns(): void {
        // Reset and reload global patterns
        this.includePatterns = ignore();

        const config = vscode.workspace.getConfiguration('codeSquad');
        const globalPatterns = config.get<string[]>('includeFiles', []);

        if (globalPatterns.length > 0) {
            this.includePatterns.add(globalPatterns);
        }

        // Add current thread patterns
        if (this.currentThreadPatterns.length > 0) {
            this.includePatterns.add(this.currentThreadPatterns);
            this.log(`[Thread] Applied ${this.currentThreadPatterns.length} thread patterns`);
        }

        // Rebuild whitelist watchers with new patterns
        if (this.extensionContext) {
            this.setupWhitelistWatchers(this.extensionContext);
        }

        // Rebuild whitelist watchers for all worktree sessions
        for (const [terminalId, watcher] of this.sessionWorktreeWatchers) {
            this.setupWorktreeWhitelistWatchers(watcher, watcher.workspaceRoot, terminalId);
        }
    }

    /**
     * Get the current file watch mode.
     */
    getWatchMode(): 'filesystem' {
        return 'filesystem';
    }

    private initialize(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.loadGitignore();
        this.loadIncludePatterns();
    }

    private loadGitignore(): void {
        if (!this.workspaceRoot) return;

        const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            const content = fs.readFileSync(gitignorePath, 'utf8');
            this.gitignore.add(content);
        }

        // 항상 제외할 패턴
        this.gitignore.add([
            '.git',
            'code-squad-comments.json'
        ]);
    }

    private loadIncludePatterns(): void {
        // Delegate to rebuildIncludePatterns to handle both global and thread patterns
        this.rebuildIncludePatterns();
    }

    private loadBatchConfig(): void {
        const config = vscode.workspace.getConfiguration('codeSquad');
        this.batchWindowMs = config.get<number>('fileWatchBatchWindowMs', 100);
        this.batchIdleMs = config.get<number>('fileWatchBatchIdleMs', 50);
        this.log(`Batch config loaded: window=${this.batchWindowMs}ms, idle=${this.batchIdleMs}ms`);
    }

    private initBatchCollector(): void {
        // Dispose existing collector if any
        this.batchCollector?.dispose();

        this.batchCollector = new BatchEventCollector({
            batchWindowMs: this.batchWindowMs,
            batchIdleMs: this.batchIdleMs
        });

        // Subscribe to batch ready events
        this.batchCollector.onBatchReady((events) => this.processBatch(events));

        this.log(`BatchEventCollector initialized: window=${this.batchWindowMs}ms, idle=${this.batchIdleMs}ms`);
    }

    /** Main workspace FileSystemWatcher */
    private mainWorkspaceWatcher: vscode.FileSystemWatcher | undefined;

    /**
     * Setup FileSystemWatcher for the main workspace.
     * Watches all files and uses BatchEventCollector for efficient batching.
     */
    private setupMainWorkspaceWatcher(context: vscode.ExtensionContext): void {
        if (!this.workspaceRoot) {
            this.log('No workspace root, skipping main workspace watcher');
            return;
        }

        // Dispose existing watcher if any
        this.mainWorkspaceWatcher?.dispose();

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.log('No workspace folders, skipping main workspace watcher');
            return;
        }

        this.log(`Setting up FileSystemWatcher for main workspace: ${this.workspaceRoot}`);

        // Watch all files in the workspace
        const pattern = new vscode.RelativePattern(workspaceFolders[0], '**/*');
        this.mainWorkspaceWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        const handleFileChange = (uri: vscode.Uri, eventType: 'create' | 'change') => {
            if (!this.batchCollector) return;

            const relativePath = vscode.workspace.asRelativePath(uri);

            // Skip .git directory
            if (relativePath.startsWith('.git/') || relativePath.startsWith('.git\\')) {
                return;
            }

            // Skip gitignored files (whitelist watcher handles those separately)
            if (this.gitignore.ignores(relativePath) && !this.includePatterns.ignores(relativePath)) {
                return;
            }

            this.eventCount++;
            this.eventCountWindow.push(Date.now());

            this.log(`[Main:FSW] Event #${this.eventCount}: ${relativePath} (type=${eventType})`);
            this.logStats();

            // Add to batch collector
            this.batchCollector.addEvent({
                uri: { fsPath: uri.fsPath },
                type: eventType,
                timestamp: Date.now(),
                source: 'git'
            });
        };

        this.mainWorkspaceWatcher.onDidChange((uri) => handleFileChange(uri, 'change'));
        this.mainWorkspaceWatcher.onDidCreate((uri) => handleFileChange(uri, 'create'));

        context.subscriptions.push(this.mainWorkspaceWatcher);

        this.log('Main workspace FileSystemWatcher created');
    }

    /**
     * Setup per-pattern file watchers for whitelisted files.
     * These track gitignored files that match includeFiles patterns.
     */
    private setupWhitelistWatchers(context: vscode.ExtensionContext): void {
        // Clear existing watchers
        this.disposeWhitelistWatchers();

        const config = vscode.workspace.getConfiguration('codeSquad');
        const globalPatterns = config.get<string[]>('includeFiles', []);

        // Combine global patterns with current thread patterns
        const allPatterns = [...new Set([...globalPatterns, ...this.currentThreadPatterns])];

        if (allPatterns.length === 0) {
            this.log('No whitelist patterns configured');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.log('No workspace folder, cannot setup whitelist watchers');
            return;
        }

        this.log(`Setting up ${allPatterns.length} whitelist watcher(s)`);

        for (const pattern of allPatterns) {
            // Use RelativePattern to properly match against workspace-relative paths
            // createFileSystemWatcher matches against full absolute paths,
            // so plain patterns like "dist/**" won't work without RelativePattern
            const relativePattern = new vscode.RelativePattern(workspaceFolders[0], pattern);
            const watcher = vscode.workspace.createFileSystemWatcher(relativePattern);
            this.whitelistWatchers.push(watcher);

            const handleWhitelistChange = (uri: vscode.Uri) => {
                this.handleWhitelistFileChange(uri);
            };

            context.subscriptions.push(watcher);
            context.subscriptions.push(watcher.onDidChange(handleWhitelistChange));
            context.subscriptions.push(watcher.onDidCreate(handleWhitelistChange));

            this.log(`  Whitelist watcher: ${pattern}`);
        }
    }

    /**
     * Dispose all whitelist watchers.
     */
    private disposeWhitelistWatchers(): void {
        const count = this.whitelistWatchers.length;
        for (const watcher of this.whitelistWatchers) {
            watcher.dispose();
        }
        this.whitelistWatchers = [];
        if (count > 0) {
            this.log(`Disposed ${count} whitelist watcher(s)`);
        }
    }

    /**
     * Handle file change from whitelist watcher.
     * Uses BatchEventCollector for batching instead of per-file debounce.
     */
    private handleWhitelistFileChange(uri: vscode.Uri): void {
        if (!this.batchCollector) return;

        const relativePath = vscode.workspace.asRelativePath(uri);
        const now = Date.now();

        this.eventCount++;
        this.eventCountWindow.push(now);

        this.log(`[Whitelist] Event #${this.eventCount}: ${relativePath}`);
        this.logStats();

        // Add to batch collector for efficient batching
        this.batchCollector.addEvent({
            uri: { fsPath: uri.fsPath },
            type: 'change',
            timestamp: now,
            source: 'whitelist'
        });
    }

    reload(): void {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();

        // Re-setup whitelist watchers if context available
        if (this.extensionContext) {
            this.setupWhitelistWatchers(this.extensionContext);
        }

        this.log('FileWatchController reloaded');
    }

    /**
     * Cleanup all watchers and pending data.
     * Called when extension deactivates.
     */
    dispose(): void {
        // Dispose batch collector
        this.batchCollector?.dispose();
        this.batchCollector = undefined;

        // Dispose main workspace watcher
        this.mainWorkspaceWatcher?.dispose();
        this.mainWorkspaceWatcher = undefined;

        // Dispose whitelist watchers
        this.disposeWhitelistWatchers();

        // Dispose all session worktree watchers
        for (const [terminalId] of this.sessionWorktreeWatchers) {
            this.unregisterSessionWorkspace(terminalId);
        }

        // Clear dedup tracking
        this.lastProcessedChanges.clear();

        this.log('FileWatchController disposed');
    }

    shouldTrack(uri: vscode.Uri): boolean {
        if (!this.workspaceRoot) return true;

        const relativePath = vscode.workspace.asRelativePath(uri);

        const inWhitelist = this.includePatterns.ignores(relativePath);
        const inGitignore = this.gitignore.ignores(relativePath);

        this.log(`  shouldTrack: ${relativePath} (whitelist=${inWhitelist}, gitignore=${inGitignore})`);

        if (inWhitelist) {
            return true;
        }

        if (inGitignore) {
            return false;
        }

        return true;
    }

    /**
     * Check if a file is in a session's per-thread whitelist.
     * Returns true if the file matches any of the session's threadState whitelist patterns.
     */
    private isInSessionWhitelist(session: SessionContext, relativePath: string): boolean {
        const threadState = session.threadState;
        if (!threadState) {
            return false;
        }

        const patterns = threadState.whitelistPatterns;
        if (patterns.length === 0) {
            return false;
        }

        // Use ignore library to match patterns
        const matcher = ignore().add(patterns);
        return matcher.ignores(relativePath);
    }

    /**
     * Check if a file is in the global or session-specific whitelist.
     */
    private isWhitelisted(relativePath: string, session?: SessionContext): boolean {
        // Check global whitelist first
        if (this.includePatterns.ignores(relativePath)) {
            return true;
        }

        // Check session-specific whitelist
        if (session && this.isInSessionWhitelist(session, relativePath)) {
            return true;
        }

        return false;
    }

    /**
     * Process a batch of file change events.
     * Called by BatchEventCollector when batch is ready.
     */
    private async processBatch(events: FileChangeEvent[]): Promise<void> {
        const startTime = Date.now();
        const coalesced = coalesceFileEvents(events);

        if (coalesced.length === 0) {
            this.log(`[Batch] Empty batch after coalescing`);
            return;
        }

        this.log(`[Batch] Processing ${coalesced.length} files (from ${events.length} events)`);

        // Skip if no active sessions
        if (!this.sessions || this.sessions.size === 0) {
            this.log(`[Batch] Skip: no sessions`);
            return;
        }

        // Skip if within commit grace period (to prevent re-adding files after commit)
        const now = Date.now();
        if (now - this.lastMainCommitTime < FileWatchController.COMMIT_GRACE_PERIOD_MS) {
            this.log(`[Batch] Skip: within commit grace period (${now - this.lastMainCommitTime}ms since commit)`);
            return;
        }

        try {
            // Collect FileInfo for batch update
            const fileInfos: FileInfo[] = [];

            for (const event of coalesced) {
                const uri = vscode.Uri.file(event.uri.fsPath);
                const relativePath = vscode.workspace.asRelativePath(uri);
                const fileName = path.basename(event.uri.fsPath);

                // Map event type to file status
                const status = event.type === 'create' ? 'added'
                             : event.type === 'delete' ? 'deleted'
                             : 'modified';

                fileInfos.push({
                    path: relativePath,
                    name: fileName,
                    status,
                });
            }

            // Update all sessions that use the main workspace
            for (const [terminalId, sessionContext] of this.sessions) {
                // Skip sessions with different workspaceRoot (they have their own watchers)
                if (sessionContext.workspaceRoot && sessionContext.workspaceRoot !== this.workspaceRoot) {
                    continue;
                }

                // Use batch update for single render
                sessionContext.stateManager.updateSessionFilesBatch(fileInfos);

                // Auto-mount diff for the focused session
                await this.maybeAutoMountDiffForFocusedSession(sessionContext, terminalId, fileInfos, 'Batch');
            }

            // Track file ownership for the focused thread
            const focusedThreadId = this.currentThreadId;
            if (focusedThreadId && this.trackFileOwnershipUseCase) {
                const focusedSession = this.sessions?.get(focusedThreadId);
                if (focusedSession?.threadState?.threadId) {
                    for (const event of coalesced) {
                        if (event.type !== 'delete') {
                            const relativePath = vscode.workspace.asRelativePath(
                                vscode.Uri.file(event.uri.fsPath)
                            );
                            await this.trackFileOwnershipUseCase.execute({
                                filePath: relativePath,
                                threadId: focusedSession.threadState.threadId
                            });
                        }
                    }
                }
            }

            const totalTime = Date.now() - startTime;
            this.log(`[Batch] Completed: ${coalesced.length} files in ${totalTime}ms`);

            if (totalTime > 200) {
                this.log(`[Batch] ⚠️ Slow batch processing: ${totalTime}ms total`);
            }
        } catch (error) {
            this.logError('processBatch', error);
        }
    }

    activate(context: vscode.ExtensionContext): void {
        this.extensionContext = context;
        this.debugChannel = vscode.window.createOutputChannel('Code Squad FileWatch');
        context.subscriptions.push(this.debugChannel);

        this.log('Activating file watch with FileSystemWatcher + BatchEventCollector');

        // Load batch config and initialize collector
        this.loadBatchConfig();
        this.initBatchCollector();

        // Setup main workspace FileSystemWatcher
        this.setupMainWorkspaceWatcher(context);

        // Setup whitelist watchers (for gitignored files that should be tracked)
        this.setupWhitelistWatchers(context);

        // Watch for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('codeSquad.includeFiles')) {
                    this.log('includeFiles configuration changed');
                    this.loadIncludePatterns();
                    this.setupWhitelistWatchers(context);
                }
                if (e.affectsConfiguration('codeSquad.fileWatchBatchWindowMs') ||
                    e.affectsConfiguration('codeSquad.fileWatchBatchIdleMs')) {
                    this.log('Batch config changed');
                    this.loadBatchConfig();
                    this.initBatchCollector();
                }
            })
        );

        // Watch for git commits by monitoring .git/HEAD changes
        this.setupGitCommitWatcher(context);
    }

    /**
     * Setup watcher for git commits
     * Monitors .git/HEAD and .git/refs to detect commits
     */
    private setupGitCommitWatcher(context: vscode.ExtensionContext): void {
        if (!this.workspaceRoot) return;

        // Initialize last commit hash
        this.updateLastHeadCommit();

        // Watch .git/HEAD and refs for commit changes
        const gitPattern = new vscode.RelativePattern(
            this.workspaceRoot,
            '.git/{HEAD,refs/**,index}'
        );
        this.gitHeadWatcher = vscode.workspace.createFileSystemWatcher(gitPattern);

        const handleGitChange = async () => {
            const currentCommit = await this.getCurrentHeadCommit();
            if (currentCommit && currentCommit !== this.lastHeadCommit) {
                this.log(`Git commit detected: ${this.lastHeadCommit?.slice(0, 7)} -> ${currentCommit.slice(0, 7)}`);
                this.lastHeadCommit = currentCommit;

                // Flush pending batch events BEFORE processing commit
                // This prevents race condition where pending file changes
                // would re-add files that handleCommit removes
                if (this.batchCollector && this.batchCollector.pendingCount > 0) {
                    this.log(`[Commit] Flushing ${this.batchCollector.pendingCount} pending events before commit handling`);
                    await this.batchCollector.flush();
                }

                await this.handleCommit();
            }
        };

        context.subscriptions.push(this.gitHeadWatcher);
        context.subscriptions.push(this.gitHeadWatcher.onDidChange(handleGitChange));
        context.subscriptions.push(this.gitHeadWatcher.onDidCreate(handleGitChange));
    }

    private async updateLastHeadCommit(): Promise<void> {
        this.lastHeadCommit = await this.getCurrentHeadCommit();
    }

    private getCurrentHeadCommit(): Promise<string | undefined> {
        if (!this.workspaceRoot) return Promise.resolve(undefined);

        return new Promise((resolve) => {
            exec(
                `cd "${this.workspaceRoot}" && git rev-parse HEAD`,
                { maxBuffer: 1024 },
                (error: Error | null, stdout: string) => {
                    if (error) {
                        resolve(undefined);
                    } else {
                        resolve(stdout.trim());
                    }
                }
            );
        });
    }

    /**
     * Handle git commit - refresh session files
     * Remove files that are no longer changed after commit
     * Also removes whitelist files (gitignored files tracked via includeFiles)
     */
    private async handleCommit(): Promise<void> {
        if (!this.sessions || this.sessions.size === 0) {
            this.log('  Skip commit handling: no active sessions');
            return;
        }

        if (!this.gitPort || !this.workspaceRoot) {
            this.log('  Skip commit handling: no gitPort or workspaceRoot');
            return;
        }

        // Set grace period timestamp to ignore subsequent file change events
        this.lastMainCommitTime = Date.now();
        this.log(`Refreshing session files after commit (grace period until ${this.lastMainCommitTime + FileWatchController.COMMIT_GRACE_PERIOD_MS})...`);

        // Get current uncommitted files from git
        const uncommittedFiles = await this.gitPort.getUncommittedFilesWithStatus(this.workspaceRoot);
        const uncommittedPaths = new Set(uncommittedFiles.map(f => f.path));

        // Update only sessions that belong to this (main) workspace
        // Worktree sessions are handled separately by handleWorktreeCommit()
        for (const [terminalId, sessionContext] of this.sessions) {
            // Skip sessions with different workspaceRoot (worktree sessions)
            if (sessionContext.workspaceRoot !== this.workspaceRoot) {
                this.log(`  Skip session ${terminalId}: different workspaceRoot (worktree)`);
                continue;
            }

            const { stateManager } = sessionContext;
            const currentState = stateManager.getState();

            // Find files that were committed (no longer in uncommitted list)
            // Also include whitelist files (gitignored) - they should be flushed on commit too
            // Check both global and per-session whitelist
            const filesToRemove = currentState.sessionFiles.filter(f => {
                const isUncommitted = uncommittedPaths.has(f.path);
                const isInWhitelist = this.isWhitelisted(f.path, sessionContext);
                // Remove if: (git-tracked AND committed) OR (whitelist file)
                return !isUncommitted || isInWhitelist;
            });

            // Remove files from session
            for (const file of filesToRemove) {
                const reason = this.isWhitelisted(file.path, sessionContext) ? 'whitelist' : 'committed';
                this.log(`  Removing ${reason} file: ${file.path}`);
                stateManager.removeSessionFile(file.path);
            }

            // Update baseline with current uncommitted files
            const baselineFiles: FileInfo[] = uncommittedFiles.map(f => ({
                path: f.path,
                name: path.basename(f.path),
                status: f.status,
            }));
            stateManager.setBaseline(baselineFiles);

            this.log(`  Session ${terminalId}: removed ${filesToRemove.length} files`);
        }
    }

    /**
     * 특정 세션에 파일 변경 알림
     */
    private async notifyFileChange(
        context: SessionContext,
        relativePath: string,
        fileName: string,
        status: 'added' | 'modified' | 'deleted'
    ): Promise<void> {
        const { stateManager, generateDiffUseCase } = context;
        const currentState = stateManager.getState();

        // Baseline에서 Session으로 이동 또는 새 파일 추가
        if (stateManager.isInBaseline(relativePath)) {
            stateManager.moveToSession(relativePath);
        } else {
            const existsInSession = currentState.sessionFiles.some(
                (f) => f.path === relativePath
            );
            if (!existsInSession) {
                stateManager.addSessionFile({
                    path: relativePath,
                    name: fileName,
                    status,
                });
            }
        }

        // 첫 파일이거나 현재 선택된 파일이면 Diff 갱신
        const isFirstFile =
            currentState.sessionFiles.length === 0 &&
            !stateManager.isInBaseline(relativePath);
        const isSelectedFile = currentState.selectedFile === relativePath;

        if (isFirstFile || isSelectedFile) {
            const diffResult = await generateDiffUseCase.execute(relativePath);
            if (diffResult) {
                // Use session's workspaceRoot for worktree support
                const sessionWorkspaceRoot = context.workspaceRoot || this.workspaceRoot;
                const displayState = await this.createDiffDisplayState(diffResult, relativePath, sessionWorkspaceRoot);
                stateManager.showDiff(displayState);
            }
        }
    }

    private async createDiffDisplayState(diff: DiffResult, filePath: string, workspaceRoot?: string): Promise<DiffDisplayState> {
        const chunkStates: ChunkDisplayInfo[] = diff.chunks.map((_, index) => ({
            index,
            isCollapsed: false,
            scopeLabel: null,
        }));

        const displayState: DiffDisplayState = {
            ...diff,
            chunkStates,
            scopes: [],
        };

        // For markdown files, add full content and change info for preview
        const effectiveRoot = workspaceRoot || this.workspaceRoot;
        const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown') || filePath.endsWith('.mdx');
        if (isMarkdown && effectiveRoot) {
            const fullContent = await this.readFullFileContent(filePath, effectiveRoot);
            if (fullContent !== null) {
                displayState.newFileContent = fullContent;
                displayState.changedLineNumbers = this.extractChangedLineNumbers(diff);
                displayState.deletions = this.extractDeletions(diff);
            }
        }

        return displayState;
    }

    private async readFullFileContent(relativePath: string, workspaceRoot?: string): Promise<string | null> {
        const effectiveRoot = workspaceRoot || this.workspaceRoot;
        if (!effectiveRoot) return null;
        try {
            const absolutePath = path.join(effectiveRoot, relativePath);
            const uri = vscode.Uri.file(absolutePath);
            const content = await vscode.workspace.fs.readFile(uri);
            return Buffer.from(content).toString('utf8');
        } catch {
            return null;
        }
    }

    private extractChangedLineNumbers(diff: DiffResult): number[] {
        const changedLines: number[] = [];
        for (const chunk of diff.chunks) {
            for (const line of chunk.lines) {
                if (line.type === 'addition' && line.newLineNumber) {
                    changedLines.push(line.newLineNumber);
                }
            }
        }
        return changedLines;
    }

    private extractDeletions(diff: DiffResult): { afterLine: number; content: string[] }[] {
        const deletions: { afterLine: number; content: string[] }[] = [];

        for (const chunk of diff.chunks) {
            let currentDeletion: { afterLine: number; content: string[] } | null = null;
            let lastNewLineNum = chunk.newStart - 1;

            for (const line of chunk.lines) {
                if (line.type === 'deletion') {
                    if (!currentDeletion) {
                        currentDeletion = { afterLine: lastNewLineNum, content: [] };
                    }
                    currentDeletion.content.push(line.content);
                } else {
                    if (currentDeletion) {
                        deletions.push(currentDeletion);
                        currentDeletion = null;
                    }
                    if (line.newLineNumber) {
                        lastNewLineNum = line.newLineNumber;
                    }
                }
            }

            if (currentDeletion) {
                deletions.push(currentDeletion);
            }
        }

        return deletions;
    }

    // ===== Session Worktree Management =====

    /**
     * Register a session's workspaceRoot for file watching.
     * Creates separate watchers if workspaceRoot differs from VSCode workspace.
     */
    async registerSessionWorkspace(terminalId: string, sessionWorkspaceRoot: string): Promise<void> {
        // Skip if same as VSCode workspace
        if (sessionWorkspaceRoot === this.workspaceRoot) {
            this.log(`[Worktree] Session ${terminalId}: same as VSCode workspace, skipping`);
            return;
        }

        // Skip if already registered
        if (this.sessionWorktreeWatchers.has(terminalId)) {
            this.log(`[Worktree] Session ${terminalId}: already registered`);
            return;
        }

        this.log(`[Worktree] Registering session ${terminalId} with workspaceRoot: ${sessionWorkspaceRoot}`);

        const watcher: SessionWorktreeWatcher = {
            terminalId,
            workspaceRoot: sessionWorkspaceRoot,
            headWatcher: undefined,
            lastHeadCommit: undefined,
            fileWatcher: undefined,
            batchCollector: undefined,
            whitelistWatchers: [],
        };

        // Setup FileSystemWatcher for worktree directory
        this.log(`[Worktree] Setting up FileSystemWatcher for ${sessionWorkspaceRoot}`);
        try {
            // Initialize batch collector for this worktree session
            watcher.batchCollector = new BatchEventCollector({
                batchWindowMs: this.batchWindowMs,
                batchIdleMs: this.batchIdleMs
            });
            watcher.batchCollector.onBatchReady((events) => {
                this.processWorktreeBatch(terminalId, events, sessionWorkspaceRoot);
            });
            this.log(`[Worktree] BatchEventCollector initialized for ${sessionWorkspaceRoot}`);

            // Watch all files in the worktree directory
            const worktreePattern = new vscode.RelativePattern(
                vscode.Uri.file(sessionWorkspaceRoot),
                '**/*'
            );
            const fileWatcher = vscode.workspace.createFileSystemWatcher(worktreePattern);

            const handleFileChange = (uri: vscode.Uri, eventType: 'create' | 'change') => {
                const relativePath = path.relative(sessionWorkspaceRoot, uri.fsPath);

                // Skip .git directory
                if (relativePath.includes('.git')) {
                    return;
                }

                // Skip gitignored files early (whitelist watcher handles those separately)
                if (this.gitignore.ignores(relativePath) && !this.includePatterns.ignores(relativePath)) {
                    return;
                }

                this.log(`[Worktree:FSW] Event: ${relativePath}, session: ${terminalId}, type: ${eventType}`);

                // Add to batch collector
                if (watcher.batchCollector) {
                    watcher.batchCollector.addEvent({
                        uri: { fsPath: uri.fsPath },
                        type: eventType,
                        timestamp: Date.now(),
                        source: 'git'
                    });
                }
            };

            fileWatcher.onDidChange((uri) => handleFileChange(uri, 'change'));
            fileWatcher.onDidCreate((uri) => handleFileChange(uri, 'create'));

            watcher.fileWatcher = fileWatcher;

            this.log(`[Worktree] FileSystemWatcher created for ${sessionWorkspaceRoot}`);
        } catch (error) {
            this.logError('registerSessionWorkspace:FileSystemWatcher', error);
        }

        // Setup git HEAD watcher for this worktree
        const gitPattern = new vscode.RelativePattern(
            sessionWorkspaceRoot,
            '.git/{HEAD,refs/**,index}'
        );
        watcher.headWatcher = vscode.workspace.createFileSystemWatcher(gitPattern);

        const handleGitChange = async () => {
            const currentCommit = await this.getHeadCommitForPath(sessionWorkspaceRoot);
            if (currentCommit && currentCommit !== watcher.lastHeadCommit) {
                this.log(`[Worktree] Git commit detected in ${sessionWorkspaceRoot}: ${watcher.lastHeadCommit?.slice(0, 7)} -> ${currentCommit.slice(0, 7)}`);
                watcher.lastHeadCommit = currentCommit;

                // Flush pending batch events BEFORE processing commit
                // This prevents race condition where pending file changes
                // would re-add files that handleWorktreeCommit removes
                if (watcher.batchCollector && watcher.batchCollector.pendingCount > 0) {
                    this.log(`[Worktree:Commit] Flushing ${watcher.batchCollector.pendingCount} pending events before commit handling`);
                    await watcher.batchCollector.flush();
                }

                await this.handleWorktreeCommit(terminalId);
            }
        };

        watcher.headWatcher.onDidChange(handleGitChange);
        watcher.headWatcher.onDidCreate(handleGitChange);

        // Initialize last commit hash
        watcher.lastHeadCommit = await this.getHeadCommitForPath(sessionWorkspaceRoot);

        // Setup whitelist watchers for this worktree
        this.setupWorktreeWhitelistWatchers(watcher, sessionWorkspaceRoot, terminalId);

        this.sessionWorktreeWatchers.set(terminalId, watcher);
        this.log(`[Worktree] Session ${terminalId} registered successfully`);
    }

    /**
     * Setup whitelist watchers for a specific worktree session.
     * These watch for changes to files matching whitelist patterns in the worktree directory.
     */
    private setupWorktreeWhitelistWatchers(
        watcher: SessionWorktreeWatcher,
        sessionWorkspaceRoot: string,
        terminalId: string
    ): void {
        // Clear existing whitelist watchers for this session
        for (const w of watcher.whitelistWatchers) {
            w.dispose();
        }
        watcher.whitelistWatchers = [];

        // Get all whitelist patterns (global + current thread patterns)
        const config = vscode.workspace.getConfiguration('codeSquad');
        const globalPatterns = config.get<string[]>('includeFiles', []);
        const allPatterns = [...new Set([...globalPatterns, ...(this.sessions?.get(terminalId)?.threadState?.whitelistPatterns ?? [])])];

        if (allPatterns.length === 0) {
            this.log(`[Worktree] No whitelist patterns for session ${terminalId}`);
            return;
        }

        this.log(`[Worktree] Setting up ${allPatterns.length} whitelist watcher(s) for ${sessionWorkspaceRoot}`);

        for (const pattern of allPatterns) {
            const relativePattern = new vscode.RelativePattern(
                vscode.Uri.file(sessionWorkspaceRoot),
                pattern
            );
            const patternWatcher = vscode.workspace.createFileSystemWatcher(relativePattern);

            patternWatcher.onDidChange((uri) => {
                this.handleWorktreeWhitelistFileChange(terminalId, uri, sessionWorkspaceRoot, 'change');
            });
            patternWatcher.onDidCreate((uri) => {
                this.handleWorktreeWhitelistFileChange(terminalId, uri, sessionWorkspaceRoot, 'create');
            });

            watcher.whitelistWatchers.push(patternWatcher);
            this.log(`[Worktree] Whitelist watcher: ${pattern} for ${sessionWorkspaceRoot}`);
        }
    }

    /**
     * Handle whitelist file change in a worktree session.
     * Uses batch collector for efficient batching of multiple file changes.
     */
    private handleWorktreeWhitelistFileChange(
        terminalId: string,
        uri: vscode.Uri,
        sessionWorkspaceRoot: string,
        eventType: 'create' | 'change' = 'change'
    ): void {
        const relativePath = path.relative(sessionWorkspaceRoot, uri.fsPath);
        this.log(`[Worktree:Whitelist] Event: ${relativePath}, session: ${terminalId}, type: ${eventType}`);

        const watcher = this.sessionWorktreeWatchers.get(terminalId);
        if (!watcher) return;

        // Add to batch collector instead of debouncing
        if (watcher.batchCollector) {
            watcher.batchCollector.addEvent({
                uri: { fsPath: uri.fsPath },
                type: eventType,
                timestamp: Date.now(),
                source: 'whitelist'
            });
        }
    }

    /**
     * Unregister a session's workspaceRoot watchers.
     */
    unregisterSessionWorkspace(terminalId: string): void {
        const watcher = this.sessionWorktreeWatchers.get(terminalId);
        if (!watcher) {
            return;
        }

        this.log(`[Worktree] Unregistering session ${terminalId}`);

        // Dispose resources
        watcher.headWatcher?.dispose();
        watcher.fileWatcher?.dispose();
        watcher.batchCollector?.dispose();

        // Dispose whitelist watchers
        for (const w of watcher.whitelistWatchers) {
            w.dispose();
        }

        this.sessionWorktreeWatchers.delete(terminalId);
        // Clean up grace period tracking
        this.lastWorktreeCommitTimes.delete(terminalId);
        this.log(`[Worktree] Session ${terminalId} unregistered`);
    }

    /**
     * Process a batch of file change events from a worktree session.
     * Called by BatchEventCollector when batch is ready.
     */
    private async processWorktreeBatch(
        terminalId: string,
        events: FileChangeEvent[],
        sessionWorkspaceRoot: string
    ): Promise<void> {
        const startTime = Date.now();
        const coalesced = coalesceFileEvents(events);

        if (coalesced.length === 0) {
            this.log(`[Worktree:Batch] Empty batch after coalescing for session ${terminalId}`);
            return;
        }

        this.log(`[Worktree:Batch] Processing ${coalesced.length} files (from ${events.length} events) for session ${terminalId}`);

        const session = this.sessions?.get(terminalId);
        if (!session) {
            this.log(`[Worktree:Batch] Skip: session ${terminalId} not found`);
            return;
        }

        // Skip if within commit grace period for this worktree session
        const lastCommitTime = this.lastWorktreeCommitTimes.get(terminalId) ?? 0;
        const now = Date.now();
        if (now - lastCommitTime < FileWatchController.COMMIT_GRACE_PERIOD_MS) {
            this.log(`[Worktree:Batch] Skip: within commit grace period (${now - lastCommitTime}ms since commit) for session ${terminalId}`);
            return;
        }

        try {
            // Collect FileInfo for batch update
            const fileInfos: FileInfo[] = [];

            for (const event of coalesced) {
                const relativePath = path.relative(sessionWorkspaceRoot, event.uri.fsPath);
                const fileName = path.basename(event.uri.fsPath);

                // Skip if path is outside worktree
                if (relativePath.startsWith('..')) {
                    continue;
                }

                const isWhitelisted = this.isWhitelisted(relativePath, session);

                // Skip gitignored files only when not whitelisted
                if (this.gitignore.ignores(relativePath) && !isWhitelisted) {
                    continue;
                }

                // Map event type to file status
                const status = event.type === 'create' ? 'added'
                             : event.type === 'delete' ? 'deleted'
                             : 'modified';

                fileInfos.push({
                    path: relativePath,
                    name: fileName,
                    status,
                });
            }

            if (fileInfos.length === 0) {
                this.log(`[Worktree:Batch] No valid files after filtering for session ${terminalId}`);
                return;
            }

            // Use batch update for single render
            session.stateManager.updateSessionFilesBatch(fileInfos);

            // Auto-mount diff for the focused worktree session
            await this.maybeAutoMountDiffForFocusedSession(session, terminalId, fileInfos, 'Worktree:Batch');

            // Track file ownership for this worktree session
            if (session.threadState?.threadId && this.trackFileOwnershipUseCase) {
                for (const fileInfo of fileInfos) {
                    if (fileInfo.status !== 'deleted') {
                        await this.trackFileOwnershipUseCase.execute({
                            filePath: fileInfo.path,
                            threadId: session.threadState.threadId
                        });
                    }
                }
            }

            const totalTime = Date.now() - startTime;
            this.log(`[Worktree:Batch] Completed: ${fileInfos.length} files in ${totalTime}ms for session ${terminalId}`);

            if (totalTime > 200) {
                this.log(`[Worktree:Batch] ⚠️ Slow batch processing: ${totalTime}ms total`);
            }
        } catch (error) {
            this.logError('processWorktreeBatch', error);
        }
    }

    /**
     * Handle file change in worktree (via FileSystemWatcher).
     * @deprecated Use processWorktreeBatch for batch processing
     */
    private async handleWorktreeFileChange(terminalId: string, uri: vscode.Uri): Promise<void> {
        const watcher = this.sessionWorktreeWatchers.get(terminalId);
        if (!watcher || !this.gitPort) return;

        const session = this.sessions?.get(terminalId);
        if (!session) return;

        try {
            const relativePath = path.relative(watcher.workspaceRoot, uri.fsPath);
            const fileName = path.basename(relativePath);

            // Skip if path is outside worktree
            if (relativePath.startsWith('..')) {
                return;
            }

            const isWhitelisted = this.isWhitelisted(relativePath, session);

            // Skip gitignored files only when not whitelisted
            if (this.gitignore.ignores(relativePath) && !isWhitelisted) {
                return;
            }

            this.log(`[Worktree:FSW] File change detected: ${relativePath} (session=${terminalId})`);

            // Get git status for this file
            const status = await this.gitPort.getFileStatus(watcher.workspaceRoot, relativePath);

            // Notify session
            await this.notifyFileChange(session, relativePath, fileName, status);

            // Track file ownership for this worktree session
            if (session.threadState?.threadId && this.trackFileOwnershipUseCase) {
                await this.trackFileOwnershipUseCase.execute({
                    filePath: relativePath,
                    threadId: session.threadState.threadId
                });
                this.log(`[Worktree:FSW] Tracked ownership: ${relativePath} -> ${session.threadState.name}`);
            }
        } catch (error) {
            this.logError('handleWorktreeFileChange', error);
        }
    }

    /**
     * Handle git commit for a specific worktree session.
     */
    private async handleWorktreeCommit(terminalId: string): Promise<void> {
        const watcher = this.sessionWorktreeWatchers.get(terminalId);
        if (!watcher) return;

        const session = this.sessions?.get(terminalId);
        if (!session || !this.gitPort) return;

        // Set grace period timestamp for this worktree session
        this.lastWorktreeCommitTimes.set(terminalId, Date.now());
        this.log(`[Worktree] Refreshing session ${terminalId} files after commit...`);

        const { stateManager } = session;
        const currentState = stateManager.getState();

        // Get current uncommitted files from git
        const uncommittedFiles = await this.gitPort.getUncommittedFilesWithStatus(watcher.workspaceRoot);
        const uncommittedPaths = new Set(uncommittedFiles.map(f => f.path));

        // Find files that were committed
        // Check both global and per-session whitelist
        const filesToRemove = currentState.sessionFiles.filter(f => {
            const isUncommitted = uncommittedPaths.has(f.path);
            const isInWhitelist = this.isWhitelisted(f.path, session);
            return !isUncommitted || isInWhitelist;
        });

        // Remove files from session
        for (const file of filesToRemove) {
            const reason = this.isWhitelisted(file.path, session) ? 'whitelist' : 'committed';
            this.log(`[Worktree] Removing ${reason} file: ${file.path}`);
            stateManager.removeSessionFile(file.path);
        }

        // Update baseline
        const baselineFiles: FileInfo[] = uncommittedFiles.map(f => ({
            path: f.path,
            name: path.basename(f.path),
            status: f.status,
        }));
        stateManager.setBaseline(baselineFiles);

        this.log(`[Worktree] Session ${terminalId}: removed ${filesToRemove.length} files`);
    }

    /**
     * Determines if a diff should be auto-mounted for the focused session and performs the mount.
     */
    private async maybeAutoMountDiffForFocusedSession(
        sessionContext: SessionContext,
        terminalId: string,
        fileInfos: FileInfo[],
        logPrefix: string
    ): Promise<void> {
        if (terminalId !== this.currentThreadId || fileInfos.length === 0) {
            return;
        }

        const currentState = sessionContext.stateManager.getState();
        const firstChange = fileInfos.find(f => f.status !== 'deleted');

        // Auto-mount first diff if:
        // 1. No file is currently selected, and there's a file change.
        // 2. The currently selected file was modified.
        const shouldAutoMount =
            (!currentState.selectedFile && firstChange) ||
            fileInfos.some(f => f.path === currentState.selectedFile && f.status !== 'deleted');

        if (shouldAutoMount) {
            const fileToMount = currentState.selectedFile || firstChange?.path;
            if (fileToMount) {
                this.log(`[${logPrefix}] Auto-mounting diff for focused session: ${fileToMount}`);
                await this.autoMountDiff(sessionContext, fileToMount);
            }
        }
    }

    /**
     * Auto-mount diff for a file in the given session.
     * Generates diff and displays it in the panel.
     */
    private async autoMountDiff(
        sessionContext: SessionContext,
        filePath: string
    ): Promise<void> {
        const { stateManager, generateDiffUseCase, workspaceRoot } = sessionContext;

        try {
            const diffResult = await generateDiffUseCase.execute(filePath);
            if (diffResult) {
                const effectiveRoot = workspaceRoot || this.workspaceRoot;
                const displayState = await this.createDiffDisplayState(
                    diffResult,
                    filePath,
                    effectiveRoot
                );
                stateManager.showDiff(displayState);
                this.log(`[AutoMount] Successfully mounted diff for: ${filePath}`);
            } else {
                this.log(`[AutoMount] No diff result for: ${filePath}`);
            }
        } catch (error) {
            this.logError('autoMountDiff', error);
        }
    }

    /**
     * Get HEAD commit hash for a specific path.
     */
    private getHeadCommitForPath(workspaceRoot: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git rev-parse HEAD`,
                { maxBuffer: 1024 },
                (error: Error | null, stdout: string) => {
                    if (error) {
                        resolve(undefined);
                    } else {
                        resolve(stdout.trim());
                    }
                }
            );
        });
    }
}
