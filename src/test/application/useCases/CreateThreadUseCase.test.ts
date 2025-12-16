import * as assert from 'assert';
import { CreateThreadUseCase } from '../../../application/useCases/CreateThreadUseCase';
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';
import { ITerminalPort, TerminalActivityCallback, TerminalOutputCallback, TerminalCommandCallback } from '../../../application/ports/outbound/ITerminalPort';
import { IGitPort, FileStatus } from '../../../application/ports/outbound/IGitPort';
import { IFileSystemPort } from '../../../application/ports/outbound/IFileSystemPort';
import { IFileGlobber } from '../../../application/ports/outbound/IFileGlobber';
import { ThreadState } from '../../../domain/entities/ThreadState';

class MockThreadStateRepository implements IThreadStateRepository {
    public savedStates: ThreadState[] = [];

    async save(state: ThreadState): Promise<void> {
        this.savedStates.push(state);
    }

    async findAll(): Promise<ThreadState[]> {
        return this.savedStates;
    }

    async findById(_threadId: string): Promise<ThreadState | null> {
        return null;
    }

    async findByTerminalId(_terminalId: string): Promise<ThreadState | null> {
        return null;
    }

    async delete(_threadId: string): Promise<boolean> {
        return true;
    }

    async updateWhitelist(_threadId: string, _patterns: string[]): Promise<void> {
        // Not needed for tests
    }
}

class MockTerminalPort implements ITerminalPort {
    private terminalCounter = 0;

    initialize(): void {
        // Not needed for tests
    }

    sendText(_terminalId: string, _text: string): void {
        // Not needed for tests
    }

    showTerminal(_terminalId: string): void {
        // Not needed for tests
    }

    async createTerminal(_name: string, _cwd?: string, _openInPanel?: boolean): Promise<string> {
        return `mock-terminal-${++this.terminalCounter}`;
    }

    onTerminalActivity(_callback: TerminalActivityCallback): void {
        // Not needed for tests
    }

    onTerminalOutput(_callback: TerminalOutputCallback): void {
        // Not needed for tests
    }

    onCommandExecuted(_callback: TerminalCommandCallback): void {
        // Not needed for tests
    }

    onCommandEnded(_callback: TerminalCommandCallback): void {
        // Not needed for tests
    }

    closeTerminal(_terminalId: string): void {
        // Not needed for tests
    }

    updateTerminalName(_terminalId: string, _newName: string): void {
        // Not needed for tests
    }

    getDisplayName(_terminalId: string): string | undefined {
        return undefined;
    }
}

class MockGitPort implements IGitPort {
    public createdWorktrees: Array<{ path: string; branch: string }> = [];

    async getDiff(_workspaceRoot: string, _relativePath: string): Promise<string> {
        return '';
    }

    async isGitRepository(_workspaceRoot: string): Promise<boolean> {
        return true;
    }

    async getUncommittedFiles(_workspaceRoot: string): Promise<string[]> {
        return [];
    }

    async getFileStatus(_workspaceRoot: string, _relativePath: string): Promise<FileStatus> {
        return 'modified';
    }

    async getUncommittedFilesWithStatus(_workspaceRoot: string): Promise<Array<{ path: string; status: FileStatus }>> {
        return [];
    }

    async getCurrentBranch(_workspaceRoot: string): Promise<string> {
        return 'main';
    }

    async createWorktree(path: string, branch: string, _workspaceRoot: string): Promise<void> {
        this.createdWorktrees.push({ path, branch });
    }

    async getWorktreeRoot(_workspaceRoot: string): Promise<string | null> {
        return null;
    }

    async listWorktrees(_workspaceRoot: string): Promise<Array<{ path: string; branch: string; head: string }>> {
        return [];
    }

    async isValidWorktree(_path: string, _workspaceRoot: string): Promise<boolean> {
        return false;
    }

    async getWorktreeBranch(_worktreePath: string): Promise<string> {
        return 'main';
    }

    async removeWorktree(_worktreePath: string, _workspaceRoot: string, _force?: boolean): Promise<void> {
        // Not needed for tests
    }

    async switchBranch(_workingDir: string, _targetBranch: string): Promise<void> {
        // Not needed for tests
    }

    async listBranches(_workspaceRoot: string): Promise<string[]> {
        return ['main'];
    }

    async hasUncommittedChanges(_workingDir: string): Promise<boolean> {
        return false;
    }

    async stashChanges(_workingDir: string): Promise<void> {
        // Not needed for tests
    }
}

class MockFileSystemPort implements IFileSystemPort {
    public copiedFiles: Array<{ source: string; dest: string }> = [];
    public createdDirs: string[] = [];
    public failOnFile?: string;

    async readFile(_path: string): Promise<string> {
        return '';
    }

    async fileExists(_path: string): Promise<boolean> {
        return true;
    }

    async isFile(_path: string): Promise<boolean> {
        return true;
    }

    getWorkspaceRoot(): string | undefined {
        return '/workspace';
    }

    toAbsolutePath(relativePath: string): string {
        return `/workspace/${relativePath}`;
    }

    toRelativePath(absolutePath: string): string {
        return absolutePath.replace('/workspace/', '');
    }

    async copyFile(source: string, dest: string): Promise<void> {
        if (this.failOnFile === source) {
            throw new Error('Copy failed');
        }
        this.copiedFiles.push({ source, dest });
    }

    async ensureDir(dirPath: string): Promise<void> {
        this.createdDirs.push(dirPath);
    }
}

class MockFileGlobber implements IFileGlobber {
    private results = new Map<string, string[]>();

    setPattern(pattern: string, files: string[]): void {
        this.results.set(pattern, files);
    }

    async glob(pattern: string, _cwd: string): Promise<string[]> {
        return this.results.get(pattern) ?? [];
    }
}

suite('CreateThreadUseCase', () => {
    let useCase: CreateThreadUseCase;
    let mockThreadRepo: MockThreadStateRepository;
    let mockTerminal: MockTerminalPort;
    let mockGit: MockGitPort;
    let mockFileSystem: MockFileSystemPort;
    let mockGlobber: MockFileGlobber;

    setup(() => {
        mockThreadRepo = new MockThreadStateRepository();
        mockTerminal = new MockTerminalPort();
        mockGit = new MockGitPort();
        mockFileSystem = new MockFileSystemPort();
        mockGlobber = new MockFileGlobber();

        useCase = new CreateThreadUseCase(
            mockThreadRepo,
            mockTerminal,
            mockGit,
            mockFileSystem,
            mockGlobber
        );
    });

    suite('worktree file copy', () => {
        test('TS1: copies files matching patterns after worktree creation', async () => {
            mockGlobber.setPattern('.env*', ['/workspace/.env', '/workspace/.env.local']);
            mockGlobber.setPattern('config/local.json', ['/workspace/config/local.json']);

            await useCase.execute({
                name: 'test-thread',
                isolationMode: 'worktree',
                workspaceRoot: '/workspace',
                worktreeCopyPatterns: ['.env*', 'config/local.json'],
            });

            assert.strictEqual(mockFileSystem.copiedFiles.length, 3);
            assert.ok(mockFileSystem.createdDirs.some(d => d.includes('config')));
        });

        test('TS2: no copy when patterns empty', async () => {
            await useCase.execute({
                name: 'test-thread',
                isolationMode: 'worktree',
                workspaceRoot: '/workspace',
                worktreeCopyPatterns: [],
            });

            assert.strictEqual(mockFileSystem.copiedFiles.length, 0);
        });

        test('TS3: no error when pattern matches no files', async () => {
            mockGlobber.setPattern('.env*', []);

            await useCase.execute({
                name: 'test-thread',
                isolationMode: 'worktree',
                workspaceRoot: '/workspace',
                worktreeCopyPatterns: ['.env*'],
            });

            assert.strictEqual(mockFileSystem.copiedFiles.length, 0);
        });

        test('TS4: continues copying after failure', async () => {
            mockGlobber.setPattern('.env', ['/workspace/.env']);
            mockGlobber.setPattern('config.json', ['/workspace/config.json']);
            mockFileSystem.failOnFile = '/workspace/.env';

            await useCase.execute({
                name: 'test-thread',
                isolationMode: 'worktree',
                workspaceRoot: '/workspace',
                worktreeCopyPatterns: ['.env', 'config.json'],
            });

            assert.strictEqual(mockFileSystem.copiedFiles.length, 1);
            assert.ok(mockFileSystem.copiedFiles[0].source.includes('config.json'));
        });

        test('TS5: no copy when not worktree mode', async () => {
            mockGlobber.setPattern('.env', ['/workspace/.env']);

            await useCase.execute({
                name: 'test-thread',
                isolationMode: 'none',
                workspaceRoot: '/workspace',
                worktreeCopyPatterns: ['.env'],
            });

            assert.strictEqual(mockFileSystem.copiedFiles.length, 0);
        });

        test('TS6: preserves directory structure', async () => {
            mockGlobber.setPattern('secrets/**/*.json', ['/workspace/secrets/api/keys.json']);

            await useCase.execute({
                name: 'test-thread',
                isolationMode: 'worktree',
                workspaceRoot: '/workspace',
                worktreeCopyPatterns: ['secrets/**/*.json'],
            });

            assert.strictEqual(mockFileSystem.copiedFiles.length, 1);
            assert.ok(mockFileSystem.copiedFiles[0].dest.includes('secrets/api/keys.json'));
            assert.ok(mockFileSystem.createdDirs.some(d => d.includes('secrets/api')));
        });
    });

    suite('basic thread creation', () => {
        test('creates thread with terminal in non-worktree mode', async () => {
            const result = await useCase.execute({
                name: 'simple-thread',
                isolationMode: 'none',
                workspaceRoot: '/workspace',
            });

            assert.ok(result.threadState);
            assert.strictEqual(result.threadState.name, 'simple-thread');
            assert.strictEqual(mockThreadRepo.savedStates.length, 1);
        });

        test('creates worktree and terminal in worktree mode', async () => {
            const result = await useCase.execute({
                name: 'worktree-thread',
                isolationMode: 'worktree',
                workspaceRoot: '/workspace',
            });

            assert.ok(result.threadState);
            assert.strictEqual(mockGit.createdWorktrees.length, 1);
            assert.ok(mockGit.createdWorktrees[0].path.includes('worktree-thread'));
        });
    });
});
