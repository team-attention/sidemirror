import * as assert from 'assert';
import { GenerateScopedDiffUseCase } from '../../../application/useCases/GenerateScopedDiffUseCase';
import { ScopeMappingService } from '../../../domain/services/ScopeMappingService';
import { IGenerateDiffUseCase } from '../../../application/ports/inbound/IGenerateDiffUseCase';
import { ISymbolPort, ScopeInfo } from '../../../application/ports/outbound/ISymbolPort';
import { IFileSystemPort } from '../../../application/ports/outbound/IFileSystemPort';
import { DiffResult } from '../../../domain/entities/Diff';

class MockGenerateDiffUseCase implements IGenerateDiffUseCase {
    private result: DiffResult | null = null;

    async execute(_relativePath: string): Promise<DiffResult | null> {
        return this.result;
    }

    setResult(result: DiffResult | null): void {
        this.result = result;
    }
}

class MockSymbolPort implements ISymbolPort {
    private symbols: ScopeInfo[] = [];
    private shouldThrow = false;

    async getEnclosingScope(_filePath: string, _line: number): Promise<ScopeInfo | null> {
        return null;
    }

    async getScopesForRange(
        _filePath: string,
        _startLine: number,
        _endLine: number
    ): Promise<ScopeInfo[]> {
        return [];
    }

    async getAllFileSymbols(_filePath: string): Promise<ScopeInfo[]> {
        if (this.shouldThrow) {
            throw new Error('LSP error');
        }
        return this.symbols;
    }

    setSymbols(symbols: ScopeInfo[]): void {
        this.symbols = symbols;
    }

    setShouldThrow(should: boolean): void {
        this.shouldThrow = should;
    }
}

class MockFileSystemPort implements IFileSystemPort {
    private workspaceRoot: string | undefined = '/workspace';
    private fileContent: string = '';

    getWorkspaceRoot(): string | undefined {
        return this.workspaceRoot;
    }

    toAbsolutePath(relativePath: string): string {
        return `${this.workspaceRoot}/${relativePath}`;
    }

    toRelativePath(absolutePath: string): string {
        return absolutePath.replace(`${this.workspaceRoot}/`, '');
    }

    async readFile(_absolutePath: string): Promise<string> {
        return this.fileContent;
    }

    async fileExists(_absolutePath: string): Promise<boolean> {
        return true;
    }

    async isFile(_absolutePath: string): Promise<boolean> {
        return true;
    }

    setFileContent(content: string): void {
        this.fileContent = content;
    }

    /**
     * Helper to generate file content from line count
     */
    generateFileContent(lineCount: number): void {
        this.fileContent = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');
    }
}

suite('GenerateScopedDiffUseCase', () => {
    let useCase: GenerateScopedDiffUseCase;
    let mockDiffUseCase: MockGenerateDiffUseCase;
    let mockSymbolPort: MockSymbolPort;
    let mockFileSystem: MockFileSystemPort;
    let scopeMappingService: ScopeMappingService;

    setup(() => {
        mockDiffUseCase = new MockGenerateDiffUseCase();
        mockSymbolPort = new MockSymbolPort();
        mockFileSystem = new MockFileSystemPort();
        scopeMappingService = new ScopeMappingService();
        useCase = new GenerateScopedDiffUseCase(
            mockDiffUseCase,
            mockSymbolPort,
            mockFileSystem,
            scopeMappingService
        );
    });

    test('TS-3.1: should generate scoped diff with symbols', async () => {
        const diff: DiffResult = {
            file: 'test.ts',
            chunks: [
                {
                    header: '@@ -15,2 +15,3 @@',
                    oldStart: 15,
                    newStart: 15,
                    lines: [
                        { type: 'addition', content: 'new line', newLineNumber: 16 },
                    ],
                    stats: { additions: 1, deletions: 0 },
                },
            ],
            stats: { additions: 1, deletions: 0 },
        };
        mockDiffUseCase.setResult(diff);
        mockFileSystem.generateFileContent(30);

        const symbols: ScopeInfo[] = [
            { name: 'myFunction', kind: 'function', startLine: 10, endLine: 25 },
        ];
        mockSymbolPort.setSymbols(symbols);

        const result = await useCase.execute('test.ts');

        assert.ok(result);
        assert.strictEqual(result.file, 'test.ts');
        assert.strictEqual(result.hasScopeData, true);
        assert.strictEqual(result.root.length, 1);
        assert.strictEqual(result.root[0].scope.name, 'myFunction');
        assert.strictEqual(result.root[0].hasChanges, true);
        // Scope has all 16 lines (10-25)
        assert.strictEqual(result.root[0].lines.length, 16);
    });

    test('TS-3.2: should fallback when no symbols available', async () => {
        const diff: DiffResult = {
            file: 'test.txt',
            chunks: [
                {
                    header: '@@ -1,1 +1,2 @@',
                    oldStart: 1,
                    newStart: 1,
                    lines: [
                        { type: 'addition', content: 'new line', newLineNumber: 1 },
                    ],
                    stats: { additions: 1, deletions: 0 },
                },
            ],
            stats: { additions: 1, deletions: 0 },
        };
        mockDiffUseCase.setResult(diff);
        mockFileSystem.generateFileContent(5);
        mockSymbolPort.setSymbols([]);

        const result = await useCase.execute('test.txt');

        assert.ok(result);
        assert.strictEqual(result.hasScopeData, false);
        assert.strictEqual(result.root.length, 0);
        // All 5 lines go to orphan
        assert.ok(result.orphanLines.length > 0);
    });

    test('TS-3.3: should return null when no diff', async () => {
        mockDiffUseCase.setResult(null);

        const result = await useCase.execute('unchanged.ts');

        assert.strictEqual(result, null);
    });

    test('TS-3.4: should handle LSP error gracefully', async () => {
        const diff: DiffResult = {
            file: 'test.ts',
            chunks: [
                {
                    header: '@@ -1,1 +1,2 @@',
                    oldStart: 1,
                    newStart: 1,
                    lines: [
                        { type: 'addition', content: 'new line', newLineNumber: 1 },
                    ],
                    stats: { additions: 1, deletions: 0 },
                },
            ],
            stats: { additions: 1, deletions: 0 },
        };
        mockDiffUseCase.setResult(diff);
        mockFileSystem.generateFileContent(5);
        mockSymbolPort.setShouldThrow(true);

        const result = await useCase.execute('test.ts');

        assert.ok(result);
        assert.strictEqual(result.hasScopeData, false);
        // Should still have orphan lines (fallback behavior)
        assert.ok(result.orphanLines.length > 0);
    });

    test('should include nested scopes from symbols', async () => {
        const diff: DiffResult = {
            file: 'test.ts',
            chunks: [
                {
                    header: '@@ -15,2 +15,3 @@',
                    oldStart: 15,
                    newStart: 15,
                    lines: [
                        { type: 'addition', content: 'new line', newLineNumber: 16 },
                    ],
                    stats: { additions: 1, deletions: 0 },
                },
            ],
            stats: { additions: 1, deletions: 0 },
        };
        mockDiffUseCase.setResult(diff);
        mockFileSystem.generateFileContent(55);

        const symbols: ScopeInfo[] = [
            { name: 'MyClass', kind: 'class', startLine: 1, endLine: 50 },
            { name: 'myMethod', kind: 'method', startLine: 10, endLine: 25, containerName: 'MyClass' },
        ];
        mockSymbolPort.setSymbols(symbols);

        const result = await useCase.execute('test.ts');

        assert.ok(result);
        assert.strictEqual(result.hasScopeData, true);
        assert.strictEqual(result.root.length, 1);
        assert.strictEqual(result.root[0].scope.name, 'MyClass');
        assert.strictEqual(result.root[0].children.length, 1);
        assert.strictEqual(result.root[0].children[0].scope.name, 'myMethod');
    });
});
