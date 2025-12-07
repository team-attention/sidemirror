import * as assert from 'assert';
import { ScopeMappingService } from '../../../domain/services/ScopeMappingService';
import { DiffResult } from '../../../domain/entities/Diff';

suite('ScopeMappingService', () => {
    let service: ScopeMappingService;

    setup(() => {
        service = new ScopeMappingService();
    });

    /**
     * Helper to generate file content from line count
     */
    function generateFileContent(lineCount: number): string {
        return Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');
    }

    suite('mapDiffToScopes', () => {
        test('TS-2.1: should map single change to single scope with full file content', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -15,3 +15,4 @@',
                        oldStart: 15,
                        newStart: 15,
                        lines: [
                            { type: 'context', content: 'line 15', newLineNumber: 15 },
                            { type: 'addition', content: 'new line', newLineNumber: 16 },
                            { type: 'context', content: 'line 17', newLineNumber: 17 },
                            { type: 'context', content: 'line 18', newLineNumber: 18 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                ],
                stats: { additions: 1, deletions: 0 },
            };

            const scopes = [
                { name: 'myFunction', kind: 'function', startLine: 10, endLine: 25 },
            ];

            const fileContent = generateFileContent(30);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            assert.strictEqual(result.file, 'test.ts');
            assert.strictEqual(result.hasScopeData, true);
            assert.strictEqual(result.root.length, 1);
            assert.strictEqual(result.root[0].scope.name, 'myFunction');
            assert.strictEqual(result.root[0].hasChanges, true);
            // Scope has all lines from 10-25 (16 lines)
            assert.strictEqual(result.root[0].lines.length, 16);
            // Lines outside scope (1-9, 26-30) go to orphan
            assert.ok(result.orphanLines.length > 0);
        });

        test('TS-2.2: should map change to nested scope (innermost)', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -15,2 +15,3 @@',
                        oldStart: 15,
                        newStart: 15,
                        lines: [
                            { type: 'context', content: 'line 15', newLineNumber: 15 },
                            { type: 'addition', content: 'new line', newLineNumber: 16 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                ],
                stats: { additions: 1, deletions: 0 },
            };

            const scopes = [
                { name: 'MyClass', kind: 'class', startLine: 1, endLine: 50 },
                { name: 'myMethod', kind: 'method', startLine: 10, endLine: 25, containerName: 'MyClass' },
            ];

            const fileContent = generateFileContent(55);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            assert.strictEqual(result.root.length, 1);
            assert.strictEqual(result.root[0].scope.name, 'MyClass');
            assert.strictEqual(result.root[0].children.length, 1);
            assert.strictEqual(result.root[0].children[0].scope.name, 'myMethod');
            assert.strictEqual(result.root[0].children[0].hasChanges, true);
            // Parent should also show hasChanges due to child
            assert.strictEqual(result.root[0].hasChanges, true);
        });

        test('TS-2.3: should handle multiple changes in different scopes', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -15,2 +15,3 @@',
                        oldStart: 15,
                        newStart: 15,
                        lines: [
                            { type: 'addition', content: 'change 1', newLineNumber: 16 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                    {
                        header: '@@ -40,2 +40,3 @@',
                        oldStart: 40,
                        newStart: 40,
                        lines: [
                            { type: 'addition', content: 'change 2', newLineNumber: 41 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                ],
                stats: { additions: 2, deletions: 0 },
            };

            const scopes = [
                { name: 'scopeA', kind: 'function', startLine: 10, endLine: 25 },
                { name: 'scopeB', kind: 'function', startLine: 35, endLine: 50 },
            ];

            const fileContent = generateFileContent(60);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            assert.strictEqual(result.root.length, 2);
            assert.strictEqual(result.root[0].scope.name, 'scopeA');
            assert.strictEqual(result.root[0].hasChanges, true);
            assert.strictEqual(result.root[1].scope.name, 'scopeB');
            assert.strictEqual(result.root[1].hasChanges, true);
        });

        test('TS-2.4: should mark orphan lines with changes', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -5,2 +5,3 @@',
                        oldStart: 5,
                        newStart: 5,
                        lines: [
                            { type: 'addition', content: 'orphan line', newLineNumber: 6 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                ],
                stats: { additions: 1, deletions: 0 },
            };

            const scopes = [
                { name: 'myFunction', kind: 'function', startLine: 20, endLine: 50 },
            ];

            const fileContent = generateFileContent(55);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            // orphanLines includes lines outside scopes (1-19)
            const changedOrphan = result.orphanLines.find(l => l.type === 'addition');
            assert.ok(changedOrphan);
            assert.strictEqual(result.root[0].hasChanges, false);
        });

        test('TS-2.5: should handle empty diff with existing scopes', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [],
                stats: { additions: 0, deletions: 0 },
            };

            const scopes = [
                { name: 'myFunction', kind: 'function', startLine: 10, endLine: 25 },
            ];

            const fileContent = generateFileContent(30);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            assert.strictEqual(result.hasScopeData, true);
            assert.strictEqual(result.root.length, 1);
            assert.strictEqual(result.root[0].hasChanges, false);
            // Scope has all lines (16 lines from 10-25)
            assert.strictEqual(result.root[0].lines.length, 16);
        });

        test('TS-2.6: should return hasScopeData=false when no scopes', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -5,2 +5,3 @@',
                        oldStart: 5,
                        newStart: 5,
                        lines: [
                            { type: 'addition', content: 'some line', newLineNumber: 6 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                ],
                stats: { additions: 1, deletions: 0 },
            };

            const fileContent = generateFileContent(10);
            const result = service.mapDiffToScopes(diff, [], fileContent);

            assert.strictEqual(result.hasScopeData, false);
            assert.strictEqual(result.root.length, 0);
            // All file lines go to orphan (10 lines + 1 addition)
            assert.ok(result.orphanLines.length > 0);
        });

        test('TS-2.7: should calculate scope statistics correctly', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -15,4 +15,4 @@',
                        oldStart: 15,
                        newStart: 15,
                        lines: [
                            { type: 'addition', content: 'added 1', newLineNumber: 15 },
                            { type: 'addition', content: 'added 2', newLineNumber: 16 },
                            { type: 'deletion', content: 'deleted 1', oldLineNumber: 17 },
                            { type: 'context', content: 'context', newLineNumber: 18 },
                        ],
                        stats: { additions: 2, deletions: 1 },
                    },
                ],
                stats: { additions: 2, deletions: 1 },
            };

            const scopes = [
                { name: 'myFunction', kind: 'function', startLine: 10, endLine: 25 },
            ];

            const fileContent = generateFileContent(30);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            assert.strictEqual(result.root[0].stats.additions, 2);
            assert.strictEqual(result.root[0].stats.deletions, 1);
        });

        test('TS-2.8: should show all scope lines not just diff lines', () => {
            const diff: DiffResult = {
                file: 'test.ts',
                chunks: [
                    {
                        header: '@@ -15,2 +15,3 @@',
                        oldStart: 15,
                        newStart: 15,
                        lines: [
                            { type: 'addition', content: 'new line', newLineNumber: 15 },
                        ],
                        stats: { additions: 1, deletions: 0 },
                    },
                ],
                stats: { additions: 1, deletions: 0 },
            };

            const scopes = [
                { name: 'myFunction', kind: 'function', startLine: 10, endLine: 20 },
            ];

            const fileContent = generateFileContent(25);
            const result = service.mapDiffToScopes(diff, scopes, fileContent);

            // Scope lines should include ALL lines from 10-20 (11 lines)
            assert.strictEqual(result.root[0].lines.length, 11);
            // Verify types: most should be context, one should be addition
            const additions = result.root[0].lines.filter(l => l.type === 'addition');
            const contexts = result.root[0].lines.filter(l => l.type === 'context');
            assert.strictEqual(additions.length, 1);
            assert.strictEqual(contexts.length, 10);
        });
    });

    suite('buildScopeTree', () => {
        test('TS-2.8: should build hierarchical tree from flat list', () => {
            const scopes = [
                { name: 'MyClass', kind: 'class', startLine: 1, endLine: 50 },
                { name: 'methodA', kind: 'method', startLine: 5, endLine: 15, containerName: 'MyClass' },
                { name: 'methodB', kind: 'method', startLine: 20, endLine: 30, containerName: 'MyClass' },
            ];

            const tree = service.buildScopeTree(scopes);

            assert.strictEqual(tree.length, 1);
            assert.strictEqual(tree[0].name, 'MyClass');
            assert.strictEqual(tree[0].children.length, 2);
            assert.strictEqual(tree[0].children[0].name, 'methodA');
            assert.strictEqual(tree[0].children[1].name, 'methodB');
        });

        test('should handle multiple top-level scopes', () => {
            const scopes = [
                { name: 'functionA', kind: 'function', startLine: 1, endLine: 10 },
                { name: 'functionB', kind: 'function', startLine: 15, endLine: 25 },
            ];

            const tree = service.buildScopeTree(scopes);

            assert.strictEqual(tree.length, 2);
            assert.strictEqual(tree[0].name, 'functionA');
            assert.strictEqual(tree[1].name, 'functionB');
        });

        test('should handle deeply nested scopes', () => {
            const scopes = [
                { name: 'Module', kind: 'module', startLine: 1, endLine: 100 },
                { name: 'Class', kind: 'class', startLine: 5, endLine: 80, containerName: 'Module' },
                { name: 'method', kind: 'method', startLine: 10, endLine: 30, containerName: 'Class' },
            ];

            const tree = service.buildScopeTree(scopes);

            assert.strictEqual(tree.length, 1);
            assert.strictEqual(tree[0].name, 'Module');
            assert.strictEqual(tree[0].children.length, 1);
            assert.strictEqual(tree[0].children[0].name, 'Class');
            assert.strictEqual(tree[0].children[0].children.length, 1);
            assert.strictEqual(tree[0].children[0].children[0].name, 'method');
        });
    });
});
