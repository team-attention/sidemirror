import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import ignore, { Ignore } from 'ignore';
import { SessionContext } from '../../../application/ports/outbound/SessionContext';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';
import { DiffDisplayState, ChunkDisplayInfo, FileInfo } from '../../../application/ports/outbound/PanelState';
import { DiffResult } from '../../../domain/entities/Diff';
import { GitExtension, GitAPI, Repository, Change, Status } from '../../../types/git';
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';

/** Pending debounced event data */
interface DebouncedEventData {
    uri: vscode.Uri;
    relativePath: string;
    fileName: string;
    timestamp: number;
}

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
    repository: Repository | undefined;
    stateSubscription: vscode.Disposable | undefined;
    headWatcher: vscode.FileSystemWatcher | undefined;
    lastHeadCommit: string | undefined;
    /** FileSystemWatcher for worktree directory (fallback when git extension unavailable) */
    fileWatcher: vscode.FileSystemWatcher | undefined;
    /** Debounce timer for file watcher events */
    fileWatcherDebounceTimer: NodeJS.Timeout | undefined;
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

    // ===== Git Extension API =====
    private gitAPI: GitAPI | undefined;
    private repository: Repository | undefined;
    private repositoryStateSubscription: vscode.Disposable | undefined;
    private gitExtensionAvailable: boolean = false;
    /** Deduplication map for rapid git state events */
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

    // ===== Debounce =====
    /** Per-file debounce timers */
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    /** Stored event data for pending debounced events */
    private pendingEventData: Map<string, DebouncedEventData> = new Map();
    /** Current debounce delay in ms (0 = disabled) */
    private debounceMs: number = 300;

    // ===== Thread tracking =====
    /** Current thread's terminal ID (null = no thread selected) */
    private currentThreadId: string | null = null;
    /** Current thread's whitelist patterns */
    private currentThreadPatterns: string[] = [];
    /** Current thread's state ID (for repository operations) */
    private currentThreadStateId: string | undefined;
    /** Repository for persisting thread state changes */
    private threadStateRepository: IThreadStateRepository | undefined;

    constructor() {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    private log(message: string): void {
        if (!this.debugChannel) return;
        try {
            const timestamp = new Date().toISOString().substring(11, 23);
            this.debugChannel.appendLine(`[Sidecar] [${timestamp}] ${message}`);
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
        const config = vscode.workspace.getConfiguration('sidecar');
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

        const config = vscode.workspace.getConfiguration('sidecar');
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
    }

    /**
     * Get the current file watch mode.
     */
    getWatchMode(): 'git+whitelist' | 'whitelist-only' {
        return this.gitExtensionAvailable ? 'git+whitelist' : 'whitelist-only';
    }

    private initialize(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        this.loadGitignore();
        this.loadIncludePatterns();
        this.loadDebounceConfig();
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
            'sidecar-comments.json'
        ]);
    }

    private loadIncludePatterns(): void {
        // Delegate to rebuildIncludePatterns to handle both global and thread patterns
        this.rebuildIncludePatterns();
    }

    private loadDebounceConfig(): void {
        const config = vscode.workspace.getConfiguration('sidecar');
        const configValue = config.get<number>('fileWatchDebounceMs', 300);
        // Clamp to valid range
        this.debounceMs = Math.max(0, Math.min(2000, configValue));
        this.log(`Debounce config loaded: ${this.debounceMs}ms`);
    }

    /**
     * Initialize Git Extension API for efficient file change tracking.
     * Falls back to whitelist-only mode if git extension unavailable.
     */
    private async initGitExtension(): Promise<void> {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

        if (!gitExtension) {
            this.gitExtensionAvailable = false;
            this.log('Git extension not found, using whitelist-only mode');
            return;
        }

        if (!gitExtension.isActive) {
            try {
                await gitExtension.activate();
            } catch (error) {
                this.gitExtensionAvailable = false;
                this.log('Failed to activate git extension, using whitelist-only mode');
                this.logError('initGitExtension', error);
                return;
            }
        }

        this.gitAPI = gitExtension.exports.getAPI(1);

        if (!this.gitAPI) {
            this.gitExtensionAvailable = false;
            this.log('Git API not available, using whitelist-only mode');
            return;
        }

        // Find repository for workspace
        this.repository = this.gitAPI.repositories.find(
            repo => repo.rootUri.fsPath === this.workspaceRoot
        );

        if (!this.repository) {
            this.gitExtensionAvailable = false;
            this.log(`No git repository found for: ${this.workspaceRoot}`);
            this.log('Using whitelist-only mode');
            // Listen for repository to be opened later
            this.gitAPI.onDidOpenRepository(repo => {
                if (repo.rootUri.fsPath === this.workspaceRoot) {
                    this.repository = repo;
                    this.gitExtensionAvailable = true;
                    this.setupGitStateWatcher();
                    this.log('Git repository detected, enabled git-based file watching');
                }
            });
            return;
        }

        this.gitExtensionAvailable = true;
        this.log(`Git extension initialized: ${this.repository.rootUri.fsPath}`);
    }

    /**
     * Subscribe to repository state changes for efficient file change tracking.
     */
    private setupGitStateWatcher(context?: vscode.ExtensionContext): void {
        if (!this.repository) return;

        this.repositoryStateSubscription = this.repository.state.onDidChange(() => {
            this.handleGitStateChange();
        });

        if (context) {
            context.subscriptions.push(this.repositoryStateSubscription);
        }
        this.log('Git state watcher subscribed');
    }

    /**
     * Handle git repository state change - process changed files.
     * Deduplicates files that appear in both workingTreeChanges and indexChanges.
     */
    private async handleGitStateChange(): Promise<void> {
        if (!this.repository) return;

        const state = this.repository.state;
        const changes = [...state.workingTreeChanges, ...state.indexChanges];

        // Deduplicate by file path
        const uniqueChanges = new Map<string, Change>();
        for (const change of changes) {
            const fsPath = change.uri.fsPath;
            if (!uniqueChanges.has(fsPath)) {
                uniqueChanges.set(fsPath, change);
            }
        }

        if (uniqueChanges.size === 0) {
            return;
        }

        this.log(`[Git] State change: ${uniqueChanges.size} unique files`);

        // Process each changed file
        for (const [fsPath, change] of uniqueChanges) {
            // Skip if recently processed (dedup rapid git events)
            const now = Date.now();
            const lastProcessed = this.lastProcessedChanges.get(fsPath);
            if (lastProcessed && now - lastProcessed < 100) {
                continue;
            }
            this.lastProcessedChanges.set(fsPath, now);

            const relativePath = vscode.workspace.asRelativePath(change.uri);
            const fileName = path.basename(relativePath);

            this.eventCount++;
            this.eventCountWindow.push(now);

            this.log(`[Git] Event #${this.eventCount}: ${relativePath} (status=${Status[change.status]})`);
            this.logStats();

            // Process immediately (git already batches)
            this.pendingEvents++;
            this.maxPendingEvents = Math.max(this.maxPendingEvents, this.pendingEvents);
            try {
                await this.processFileChange({
                    uri: change.uri,
                    relativePath,
                    fileName,
                    timestamp: now
                });
            } finally {
                this.pendingEvents--;
            }
        }

        // Cleanup old entries from lastProcessedChanges (older than 5 seconds)
        const cutoff = Date.now() - 5000;
        for (const [filePath, timestamp] of this.lastProcessedChanges) {
            if (timestamp < cutoff) {
                this.lastProcessedChanges.delete(filePath);
            }
        }
    }

    /**
     * Setup per-pattern file watchers for whitelisted files.
     * Only these patterns will trigger events when git extension is unavailable.
     */
    private setupWhitelistWatchers(context: vscode.ExtensionContext): void {
        // Clear existing watchers
        this.disposeWhitelistWatchers();

        const config = vscode.workspace.getConfiguration('sidecar');
        const includeFiles = config.get<string[]>('includeFiles', []);

        if (includeFiles.length === 0) {
            this.log('No whitelist patterns configured');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this.log('No workspace folder, cannot setup whitelist watchers');
            return;
        }

        this.log(`Setting up ${includeFiles.length} whitelist watcher(s)`);

        for (const pattern of includeFiles) {
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
     * Applies debounce logic to prevent rapid event processing.
     */
    private handleWhitelistFileChange(uri: vscode.Uri): void {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const fileName = path.basename(relativePath);

        this.eventCount++;
        this.eventCountWindow.push(Date.now());

        this.log(`[Whitelist] Event #${this.eventCount}: ${relativePath}`);
        this.logStats();

        // Apply debouncing for whitelist files
        if (this.debounceMs === 0) {
            this.pendingEvents++;
            this.maxPendingEvents = Math.max(this.maxPendingEvents, this.pendingEvents);
            this.processFileChange({ uri, relativePath, fileName, timestamp: Date.now() })
                .finally(() => this.pendingEvents--);
            return;
        }

        // Existing debounce logic
        const existingTimer = this.debounceTimers.get(relativePath);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.log(`[Debounce] Coalesced: ${relativePath}`);
        } else {
            this.log(`[Debounce] Scheduled: ${relativePath} (delay=${this.debounceMs}ms)`);
        }

        this.pendingEventData.set(relativePath, {
            uri,
            relativePath,
            fileName,
            timestamp: Date.now()
        });

        const timer = setTimeout(async () => {
            const eventData = this.pendingEventData.get(relativePath);
            this.debounceTimers.delete(relativePath);
            this.pendingEventData.delete(relativePath);

            if (eventData) {
                this.log(`[Debounce] Fired: ${relativePath} (pending=${this.debounceTimers.size})`);
                this.pendingEvents++;
                this.maxPendingEvents = Math.max(this.maxPendingEvents, this.pendingEvents);
                try {
                    await this.processFileChange(eventData);
                } finally {
                    this.pendingEvents--;
                }
            }
        }, this.debounceMs);

        this.debounceTimers.set(relativePath, timer);
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
     * Cleanup all debounce timers, watchers, and pending data.
     * Called when extension deactivates.
     */
    dispose(): void {
        const timerCount = this.debounceTimers.size;

        // Clear all pending debounce timers
        for (const [filePath, timer] of this.debounceTimers) {
            clearTimeout(timer);
            this.log(`[Debounce] Cleanup: ${filePath}`);
        }
        this.debounceTimers.clear();
        this.pendingEventData.clear();

        // Dispose whitelist watchers
        this.disposeWhitelistWatchers();

        // Clear git state tracking
        this.lastProcessedChanges.clear();

        // Clear git references (subscriptions auto-disposed via context)
        this.gitAPI = undefined;
        this.repository = undefined;
        this.gitExtensionAvailable = false;

        if (timerCount > 0) {
            this.log(`Disposed: cleared ${timerCount} pending debounce timers`);
        }

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
     * Process a file change event (after debouncing).
     * Files reaching this point are already filtered by git extension or whitelist watchers.
     */
    private async processFileChange(data: DebouncedEventData): Promise<void> {
        const startTime = Date.now();
        const { uri, relativePath, fileName } = data;

        // Check file exists and is not a directory
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type === vscode.FileType.Directory) {
                this.log(`  Skip: directory`);
                return;
            }
        } catch {
            this.log(`  Skip: file not found or inaccessible`);
            return;
        }

        // Skip internal/excluded files
        if (relativePath.includes('sidecar-comments.json') ||
            relativePath.startsWith('.git/') ||
            relativePath.startsWith('.git\\')) {
            this.log(`  Skip: excluded file`);
            return;
        }

        // Skip if no active sessions
        if (!this.sessions || this.sessions.size === 0) {
            this.log(`  Skip: no sessions (size=${this.sessions?.size ?? 'undefined'})`);
            return;
        }

        this.log(`  Processing: ${relativePath} (sessions=${this.sessions.size})`);

        try {
            // Git status query (once)
            const gitStart = Date.now();
            let status: 'added' | 'modified' | 'deleted' = 'modified';
            if (this.gitPort && this.workspaceRoot) {
                status = await this.gitPort.getFileStatus(this.workspaceRoot, relativePath);
            }
            const gitTime = Date.now() - gitStart;
            if (gitTime > 100) {
                this.log(`  ⚠️ Slow git status: ${gitTime}ms`);
            }

            // Notify all active sessions
            for (const [terminalId, sessionContext] of this.sessions) {
                const notifyStart = Date.now();
                await this.notifyFileChange(sessionContext, relativePath, fileName, status);
                const notifyTime = Date.now() - notifyStart;
                if (notifyTime > 100) {
                    this.log(`  ⚠️ Slow notifyFileChange for ${terminalId}: ${notifyTime}ms`);
                }
            }

            this.processedCount++;
            const totalTime = Date.now() - startTime;
            if (totalTime > 200) {
                this.log(`  ⚠️ Slow event processing: ${totalTime}ms total`);
            }
        } catch (error) {
            this.logError('processFileChange', error);
        }
    }

    activate(context: vscode.ExtensionContext): void {
        this.extensionContext = context;
        this.debugChannel = vscode.window.createOutputChannel('Sidecar FileWatch');
        context.subscriptions.push(this.debugChannel);

        this.log('Activating file watch with hybrid approach (Git Extension + Whitelist)');

        // Initialize Git Extension for efficient file change tracking (async, non-blocking)
        this.initGitExtension().then(() => {
            if (this.repository) {
                this.setupGitStateWatcher(context);
                this.log('Git-based file watching enabled');
            } else {
                this.log('No git repository, using whitelist-only mode');
            }
        });

        // Setup whitelist watchers (always active, regardless of git extension)
        this.setupWhitelistWatchers(context);

        // Watch for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('sidecar.includeFiles')) {
                    this.log('includeFiles configuration changed');
                    this.loadIncludePatterns();
                    this.setupWhitelistWatchers(context);
                }
                if (e.affectsConfiguration('sidecar.fileWatchDebounceMs')) {
                    this.log('fileWatchDebounceMs configuration changed');
                    this.loadDebounceConfig();
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

        this.log('Refreshing session files after commit...');

        // Get current uncommitted files from git
        const uncommittedFiles = await this.gitPort.getUncommittedFilesWithStatus(this.workspaceRoot);
        const uncommittedPaths = new Set(uncommittedFiles.map(f => f.path));

        // Update each session
        for (const [terminalId, sessionContext] of this.sessions) {
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
            repository: undefined,
            stateSubscription: undefined,
            headWatcher: undefined,
            lastHeadCommit: undefined,
            fileWatcher: undefined,
            fileWatcherDebounceTimer: undefined,
        };

        // Find git repository for this worktree
        let useFileWatcher = true;
        if (this.gitAPI) {
            watcher.repository = this.gitAPI.repositories.find(
                repo => repo.rootUri.fsPath === sessionWorkspaceRoot
            );

            if (watcher.repository) {
                this.log(`[Worktree] Found repository for ${sessionWorkspaceRoot}`);
                // Subscribe to repository state changes
                watcher.stateSubscription = watcher.repository.state.onDidChange(() => {
                    this.handleWorktreeGitStateChange(terminalId);
                });
                useFileWatcher = false;
            } else {
                this.log(`[Worktree] No repository found for ${sessionWorkspaceRoot}, using FileSystemWatcher fallback`);
            }
        }

        // Use FileSystemWatcher if git extension doesn't recognize the repository
        if (useFileWatcher) {
            this.log(`[Worktree] Setting up FileSystemWatcher for ${sessionWorkspaceRoot}`);
            // Watch all files in the worktree directory
            const filePattern = new vscode.RelativePattern(sessionWorkspaceRoot, '**/*');
            watcher.fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern);

            const handleFileChange = (uri: vscode.Uri) => {
                // Skip .git directory
                if (uri.fsPath.includes('/.git/') || uri.fsPath.includes('\\.git\\')) {
                    return;
                }
                // Debounce file changes (300ms)
                if (watcher.fileWatcherDebounceTimer) {
                    clearTimeout(watcher.fileWatcherDebounceTimer);
                }
                watcher.fileWatcherDebounceTimer = setTimeout(() => {
                    this.handleWorktreeFileChange(terminalId, uri);
                }, 300);
            };

            watcher.fileWatcher.onDidChange(handleFileChange);
            watcher.fileWatcher.onDidCreate(handleFileChange);
            watcher.fileWatcher.onDidDelete(handleFileChange);
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
                await this.handleWorktreeCommit(terminalId);
            }
        };

        watcher.headWatcher.onDidChange(handleGitChange);
        watcher.headWatcher.onDidCreate(handleGitChange);

        // Initialize last commit hash
        watcher.lastHeadCommit = await this.getHeadCommitForPath(sessionWorkspaceRoot);

        this.sessionWorktreeWatchers.set(terminalId, watcher);
        this.log(`[Worktree] Session ${terminalId} registered successfully`);
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
        watcher.stateSubscription?.dispose();
        watcher.headWatcher?.dispose();
        watcher.fileWatcher?.dispose();
        if (watcher.fileWatcherDebounceTimer) {
            clearTimeout(watcher.fileWatcherDebounceTimer);
        }

        this.sessionWorktreeWatchers.delete(terminalId);
        this.log(`[Worktree] Session ${terminalId} unregistered`);
    }

    /**
     * Handle file change in worktree (via FileSystemWatcher).
     */
    private async handleWorktreeFileChange(terminalId: string, uri: vscode.Uri): Promise<void> {
        const watcher = this.sessionWorktreeWatchers.get(terminalId);
        if (!watcher || !this.gitPort) return;

        const session = this.sessions?.get(terminalId);
        if (!session) return;

        try {
            const relativePath = path.relative(watcher.workspaceRoot, uri.fsPath);
            const fileName = path.basename(relativePath);

            // Skip if path is outside worktree or is gitignored
            if (relativePath.startsWith('..') || this.gitignore.ignores(relativePath)) {
                return;
            }

            this.log(`[Worktree:FSW] File change detected: ${relativePath} (session=${terminalId})`);

            // Get git status for this file
            const status = await this.gitPort.getFileStatus(watcher.workspaceRoot, relativePath);

            // Notify session
            await this.notifyFileChange(session, relativePath, fileName, status);
        } catch (error) {
            this.logError('handleWorktreeFileChange', error);
        }
    }

    /**
     * Handle git state change for a specific worktree session.
     */
    private async handleWorktreeGitStateChange(terminalId: string): Promise<void> {
        const watcher = this.sessionWorktreeWatchers.get(terminalId);
        if (!watcher?.repository) return;

        const session = this.sessions?.get(terminalId);
        if (!session) return;

        const state = watcher.repository.state;
        const changes = [...state.workingTreeChanges, ...state.indexChanges];

        // Deduplicate by file path
        const uniqueChanges = new Map<string, Change>();
        for (const change of changes) {
            const fsPath = change.uri.fsPath;
            if (!uniqueChanges.has(fsPath)) {
                uniqueChanges.set(fsPath, change);
            }
        }

        if (uniqueChanges.size === 0) {
            return;
        }

        this.log(`[Worktree] Session ${terminalId} git state change: ${uniqueChanges.size} unique files`);

        // Process each changed file for this specific session
        for (const [fsPath, change] of uniqueChanges) {
            // Skip if recently processed
            const now = Date.now();
            const dedupeKey = `${terminalId}:${fsPath}`;
            const lastProcessed = this.lastProcessedChanges.get(dedupeKey);
            if (lastProcessed && now - lastProcessed < 100) {
                continue;
            }
            this.lastProcessedChanges.set(dedupeKey, now);

            // Calculate relative path from session's workspaceRoot
            const relativePath = path.relative(watcher.workspaceRoot, fsPath);
            const fileName = path.basename(relativePath);

            this.eventCount++;
            this.eventCountWindow.push(now);

            this.log(`[Worktree] Event #${this.eventCount}: ${relativePath} (session=${terminalId}, status=${Status[change.status]})`);

            // Get git status
            let status: 'added' | 'modified' | 'deleted' = 'modified';
            if (this.gitPort) {
                status = await this.gitPort.getFileStatus(watcher.workspaceRoot, relativePath);
            }

            // Notify only this session
            await this.notifyFileChange(session, relativePath, fileName, status);
        }

        // Cleanup old dedup entries
        const cutoff = Date.now() - 5000;
        for (const [key, timestamp] of this.lastProcessedChanges) {
            if (timestamp < cutoff) {
                this.lastProcessedChanges.delete(key);
            }
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
