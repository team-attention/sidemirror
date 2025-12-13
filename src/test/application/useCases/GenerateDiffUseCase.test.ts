import * as assert from 'assert';
import { GenerateDiffUseCase } from '../../../application/useCases/GenerateDiffUseCase';
import { DiffService } from '../../../domain/services/DiffService';
import { ISnapshotRepository } from '../../../application/ports/outbound/ISnapshotRepository';
import { IFileSystemPort } from '../../../application/ports/outbound/IFileSystemPort';
import { IGitPort, FileStatus } from '../../../application/ports/outbound/IGitPort';
import { FileSnapshot } from '../../../domain/entities/FileSnapshot';

class MockSnapshotRepository implements ISnapshotRepository {
    private snapshots = new Map<string, FileSnapshot>();

    async save(snapshot: FileSnapshot): Promise<boolean> {
        this.snapshots.set(snapshot.relativePath, snapshot);
        return true;
    }

    async findByPath(relativePath: string): Promise<FileSnapshot | undefined> {
        return this.snapshots.get(relativePath);
    }

    has(relativePath: string): boolean {
        return this.snapshots.has(relativePath);
    }

    clear(): void {
        this.snapshots.clear();
    }

    getAll(): Map<string, FileSnapshot> {
        return new Map(this.snapshots);
    }

    getStats(): { count: number; totalSize: number } {
        return { count: this.snapshots.size, totalSize: 0 };
    }

    setSnapshot(path: string, content: string): void {
        this.snapshots.set(path, FileSnapshot.create(path, content));
    }
}

class MockFileSystemPort implements IFileSystemPort {
    private files = new Map<string, string>();
    private workspaceRoot: string | undefined = '/workspace';

    getWorkspaceRoot(): string | undefined {
        return this.workspaceRoot;
    }

    toAbsolutePath(relativePath: string): string {
        return `${this.workspaceRoot}/${relativePath}`;
    }

    toRelativePath(absolutePath: string): string {
        return absolutePath.replace(`${this.workspaceRoot}/`, '');
    }

    async readFile(absolutePath: string): Promise<string> {
        const content = this.files.get(absolutePath);
        if (content === undefined) {
            throw new Error(`File not found: ${absolutePath}`);
        }
        return content;
    }

    async fileExists(absolutePath: string): Promise<boolean> {
        return this.files.has(absolutePath);
    }

    async isFile(absolutePath: string): Promise<boolean> {
        return this.files.has(absolutePath);
    }

    setFile(relativePath: string, content: string): void {
        this.files.set(`${this.workspaceRoot}/${relativePath}`, content);
    }

    deleteFile(relativePath: string): void {
        this.files.delete(`${this.workspaceRoot}/${relativePath}`);
    }

    setWorkspaceRoot(root: string | undefined): void {
        this.workspaceRoot = root;
    }
}

class MockGitPort implements IGitPort {
    private diffs = new Map<string, string>();

    async getDiff(_workspaceRoot: string, relativePath: string): Promise<string> {
        return this.diffs.get(relativePath) || '';
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

    async createWorktree(_path: string, _branch: string, _workspaceRoot: string): Promise<void> {
        // Mock implementation
    }

    async getWorktreeRoot(_workspaceRoot: string): Promise<string | null> {
        return null;
    }

    setDiff(relativePath: string, diff: string): void {
        this.diffs.set(relativePath, diff);
    }
}

suite('GenerateDiffUseCase', () => {
    let useCase: GenerateDiffUseCase;
    let snapshotRepo: MockSnapshotRepository;
    let fileSystem: MockFileSystemPort;
    let gitPort: MockGitPort;
    let diffService: DiffService;

    setup(() => {
        snapshotRepo = new MockSnapshotRepository();
        fileSystem = new MockFileSystemPort();
        gitPort = new MockGitPort();
        diffService = new DiffService();
        useCase = new GenerateDiffUseCase(snapshotRepo, fileSystem, gitPort, diffService);
    });

    suite('execute with git diff', () => {
        test('should return null when no workspace root', async () => {
            fileSystem.setWorkspaceRoot(undefined);
            const result = await useCase.execute('test.ts');
            assert.strictEqual(result, null);
        });

        test('should return null for empty git diff', async () => {
            gitPort.setDiff('test.ts', '');
            const result = await useCase.execute('test.ts');
            assert.strictEqual(result, null);
        });

        test('should parse git diff correctly', async () => {
            const diff = `@@ -1,2 +1,3 @@
 line1
+added
 line2`;
            gitPort.setDiff('test.ts', diff);
            const result = await useCase.execute('test.ts');

            assert.ok(result);
            assert.strictEqual(result.file, 'test.ts');
            assert.strictEqual(result.stats.additions, 1);
        });
    });

    suite('execute with snapshot diff', () => {
        test('should detect new file when no snapshot exists', async () => {
            snapshotRepo.setSnapshot('other.ts', 'content');
            fileSystem.setFile('test.ts', 'new content');

            // Mark as having snapshot tracking enabled
            snapshotRepo.setSnapshot('test.ts', '');
            snapshotRepo['snapshots'].delete('test.ts');

            // Actually set up the scenario properly
            const customRepo = new MockSnapshotRepository();
            const customUseCase = new GenerateDiffUseCase(
                customRepo,
                fileSystem,
                gitPort,
                diffService
            );

            // Manually override has() to return true but findByPath to return undefined
            customRepo.has = () => true;
            customRepo.findByPath = async () => undefined;

            const result = await customUseCase.execute('test.ts');
            assert.ok(result);
            assert.strictEqual(result.stats.additions, 1);
            assert.strictEqual(result.stats.deletions, 0);
        });

        test('should detect file modification', async () => {
            snapshotRepo.setSnapshot('test.ts', 'old content');
            fileSystem.setFile('test.ts', 'new content');

            const result = await useCase.execute('test.ts');

            assert.ok(result);
            assert.strictEqual(result.stats.additions, 1);
            assert.strictEqual(result.stats.deletions, 1);
        });

        test('should detect file deletion', async () => {
            snapshotRepo.setSnapshot('test.ts', 'deleted content');
            // File does not exist in filesystem

            const result = await useCase.execute('test.ts');

            assert.ok(result);
            assert.strictEqual(result.stats.additions, 0);
            assert.strictEqual(result.stats.deletions, 1);
        });

        test('should detect multi-line file deletion', async () => {
            snapshotRepo.setSnapshot('test.ts', 'line1\nline2\nline3');
            // File does not exist in filesystem

            const result = await useCase.execute('test.ts');

            assert.ok(result);
            assert.strictEqual(result.stats.additions, 0);
            assert.strictEqual(result.stats.deletions, 3);
        });

        test('should return null when snapshot and current content are identical', async () => {
            snapshotRepo.setSnapshot('test.ts', 'same content');
            fileSystem.setFile('test.ts', 'same content');

            const result = await useCase.execute('test.ts');
            assert.strictEqual(result, null);
        });

        test('should handle file with empty content after snapshot', async () => {
            snapshotRepo.setSnapshot('test.ts', 'original content');
            fileSystem.setFile('test.ts', '');

            const result = await useCase.execute('test.ts');

            assert.ok(result);
            assert.strictEqual(result.stats.deletions, 1);
        });
    });

    suite('edge cases', () => {
        test('should handle read error gracefully', async () => {
            snapshotRepo.setSnapshot('test.ts', 'content');
            // File exists check will pass but read will fail
            const customFs = new MockFileSystemPort();
            customFs.fileExists = async () => true;
            customFs.readFile = async () => { throw new Error('Read error'); };

            const customUseCase = new GenerateDiffUseCase(
                snapshotRepo,
                customFs,
                gitPort,
                diffService
            );

            const result = await customUseCase.execute('test.ts');
            // Read error returns empty result (null after filtering empty chunks)
            assert.strictEqual(result, null);
        });

        test('should prefer snapshot diff over git diff when snapshot exists', async () => {
            // Set up both git diff and snapshot
            gitPort.setDiff('test.ts', '@@ -1 +1 @@\n-git\n+diff');
            snapshotRepo.setSnapshot('test.ts', 'snapshot old');
            fileSystem.setFile('test.ts', 'snapshot new');

            const result = await useCase.execute('test.ts');

            // Should use snapshot diff, not git diff
            assert.ok(result);
            // Verify it's the snapshot diff by checking the content
            const hasSnapshotContent = result.chunks.some(chunk =>
                chunk.lines.some(line =>
                    line.content.includes('snapshot')
                )
            );
            assert.ok(hasSnapshotContent, 'Should use snapshot diff');
        });
    });
});
