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

    constructor() {
        this.gitignore = ignore();
        this.includePatterns = ignore();
        this.initialize();
    }

    private log(message: string): void {
        if (!this.debugChannel) return;
        const timestamp = new Date().toISOString().substring(11, 23);
        this.debugChannel.appendLine(`[Sidecar] [${timestamp}] ${message}`);
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
        const config = vscode.workspace.getConfiguration('sidecar');
        const includeFiles = config.get<string[]>('includeFiles', []);

        if (includeFiles.length > 0) {
            this.includePatterns.add(includeFiles);
        }
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
            const committedFiles = currentState.sessionFiles.filter(
                f => !uncommittedPaths.has(f.path)
            );

            // Remove committed files from session
            for (const file of committedFiles) {
                this.log(`  Removing committed file: ${file.path}`);
                stateManager.removeSessionFile(file.path);
            }

            // Update baseline with current uncommitted files
            const baselineFiles: FileInfo[] = uncommittedFiles.map(f => ({
                path: f.path,
                name: path.basename(f.path),
                status: f.status,
            }));
            stateManager.setBaseline(baselineFiles);

            this.log(`  Session ${terminalId}: removed ${committedFiles.length} committed files`);
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
                const displayState = await this.createDiffDisplayState(diffResult, relativePath);
                stateManager.showDiff(displayState);
            }
        }
    }

    private async createDiffDisplayState(diff: DiffResult, filePath: string): Promise<DiffDisplayState> {
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
        const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown') || filePath.endsWith('.mdx');
        if (isMarkdown && this.workspaceRoot) {
            const fullContent = await this.readFullFileContent(filePath);
            if (fullContent !== null) {
                displayState.newFileContent = fullContent;
                displayState.changedLineNumbers = this.extractChangedLineNumbers(diff);
                displayState.deletions = this.extractDeletions(diff);
            }
        }

        return displayState;
    }

    private async readFullFileContent(relativePath: string): Promise<string | null> {
        if (!this.workspaceRoot) return null;
        try {
            const absolutePath = path.join(this.workspaceRoot, relativePath);
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
}
