import * as assert from 'assert';
import { CaptureSnapshotsUseCase } from '../../../application/useCases/CaptureSnapshotsUseCase';
import { ISnapshotRepository } from '../../../application/ports/outbound/ISnapshotRepository';
import { IFileSystemPort } from '../../../application/ports/outbound/IFileSystemPort';
import { IFileGlobber } from '../../../application/ports/outbound/IFileGlobber';
import { FileSnapshot } from '../../../domain/entities/FileSnapshot';

class MockSnapshotRepository implements ISnapshotRepository {
    private snapshots = new Map<string, FileSnapshot>();
    public clearCalled = false;
    public savedSnapshots: FileSnapshot[] = [];

    async save(snapshot: FileSnapshot): Promise<boolean> {
        this.snapshots.set(snapshot.relativePath, snapshot);
        this.savedSnapshots.push(snapshot);
        return true;
    }

    async findByPath(relativePath: string): Promise<FileSnapshot | undefined> {
        return this.snapshots.get(relativePath);
    }

    has(relativePath: string): boolean {
        return this.snapshots.has(relativePath);
    }

    clear(): void {
        this.clearCalled = true;
        this.snapshots.clear();
        this.savedSnapshots = [];
    }

    getAll(): Map<string, FileSnapshot> {
        return new Map(this.snapshots);
    }

    getStats(): { count: number; totalSize: number } {
        return { count: this.snapshots.size, totalSize: 0 };
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

    async copyFile(_source: string, _dest: string): Promise<void> {
        // Not needed for CaptureSnapshotsUseCase tests
    }

    async ensureDir(_dirPath: string): Promise<void> {
        // Not needed for CaptureSnapshotsUseCase tests
    }

    // Test helpers
    setFile(absolutePath: string, content: string): void {
        this.files.set(absolutePath, content);
    }

    setWorkspaceRoot(root: string | undefined): void {
        this.workspaceRoot = root;
    }
}

class MockFileGlobber implements IFileGlobber {
    private patterns = new Map<string, string[]>();

    async glob(pattern: string, _cwd: string): Promise<string[]> {
        return this.patterns.get(pattern) || [];
    }

    // Test helper
    setPattern(pattern: string, files: string[]): void {
        this.patterns.set(pattern, files);
    }
}

suite('CaptureSnapshotsUseCase', () => {
    let useCase: CaptureSnapshotsUseCase;
    let snapshotRepo: MockSnapshotRepository;
    let fileSystem: MockFileSystemPort;
    let fileGlobber: MockFileGlobber;

    setup(() => {
        snapshotRepo = new MockSnapshotRepository();
        fileSystem = new MockFileSystemPort();
        fileGlobber = new MockFileGlobber();
        useCase = new CaptureSnapshotsUseCase(snapshotRepo, fileSystem, fileGlobber);
    });

    suite('execute', () => {
        test('should return 0 when no workspace root', async () => {
            fileSystem.setWorkspaceRoot(undefined);

            const result = await useCase.execute(['**/*.ts']);

            assert.strictEqual(result, 0);
        });

        test('should return 0 for empty patterns', async () => {
            const result = await useCase.execute([]);

            assert.strictEqual(result, 0);
        });

        test('should clear existing snapshots before capturing', async () => {
            fileGlobber.setPattern('**/*.ts', []);

            await useCase.execute(['**/*.ts']);

            assert.strictEqual(snapshotRepo.clearCalled, true);
        });

        test('should capture single file', async () => {
            const filePath = '/workspace/src/test.ts';
            fileGlobber.setPattern('**/*.ts', [filePath]);
            fileSystem.setFile(filePath, 'const x = 1;');

            const result = await useCase.execute(['**/*.ts']);

            assert.strictEqual(result, 1);
            assert.strictEqual(snapshotRepo.savedSnapshots.length, 1);
            assert.strictEqual(snapshotRepo.savedSnapshots[0].relativePath, 'src/test.ts');
            assert.strictEqual(snapshotRepo.savedSnapshots[0].content, 'const x = 1;');
        });

        test('should capture multiple files from single pattern', async () => {
            fileGlobber.setPattern('**/*.ts', [
                '/workspace/src/a.ts',
                '/workspace/src/b.ts'
            ]);
            fileSystem.setFile('/workspace/src/a.ts', 'file a');
            fileSystem.setFile('/workspace/src/b.ts', 'file b');

            const result = await useCase.execute(['**/*.ts']);

            assert.strictEqual(result, 2);
        });

        test('should capture files from multiple patterns', async () => {
            fileGlobber.setPattern('**/*.ts', ['/workspace/src/app.ts']);
            fileGlobber.setPattern('**/*.json', ['/workspace/package.json']);
            fileSystem.setFile('/workspace/src/app.ts', 'ts content');
            fileSystem.setFile('/workspace/package.json', '{}');

            const result = await useCase.execute(['**/*.ts', '**/*.json']);

            assert.strictEqual(result, 2);
        });

        test('should skip non-existent files', async () => {
            fileGlobber.setPattern('**/*.ts', [
                '/workspace/exists.ts',
                '/workspace/not-exists.ts'
            ]);
            fileSystem.setFile('/workspace/exists.ts', 'content');
            // not-exists.ts is not added to fileSystem

            const result = await useCase.execute(['**/*.ts']);

            assert.strictEqual(result, 1);
        });

        test('should handle file read errors gracefully', async () => {
            fileGlobber.setPattern('**/*.ts', ['/workspace/error.ts']);
            // Create a custom fileSystem that throws on readFile
            const errorFileSystem = new MockFileSystemPort();
            errorFileSystem.fileExists = async () => true;
            errorFileSystem.isFile = async () => true;
            errorFileSystem.readFile = async () => { throw new Error('Read error'); };

            const errorUseCase = new CaptureSnapshotsUseCase(
                snapshotRepo,
                errorFileSystem,
                fileGlobber
            );

            const result = await errorUseCase.execute(['**/*.ts']);

            assert.strictEqual(result, 0);
        });

        test('should skip directories (isFile = false)', async () => {
            fileGlobber.setPattern('**/*', ['/workspace/src']);
            const dirFileSystem = new MockFileSystemPort();
            dirFileSystem.fileExists = async () => true;
            dirFileSystem.isFile = async () => false;

            const dirUseCase = new CaptureSnapshotsUseCase(
                snapshotRepo,
                dirFileSystem,
                fileGlobber
            );

            const result = await dirUseCase.execute(['**/*']);

            assert.strictEqual(result, 0);
        });

        test('should handle empty glob results', async () => {
            fileGlobber.setPattern('**/*.xyz', []);

            const result = await useCase.execute(['**/*.xyz']);

            assert.strictEqual(result, 0);
            assert.strictEqual(snapshotRepo.clearCalled, true);
        });
    });
});
