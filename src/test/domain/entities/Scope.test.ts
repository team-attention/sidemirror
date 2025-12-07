import * as assert from 'assert';
import { Scope } from '../../../domain/entities/Scope';

suite('Scope', () => {
    suite('containsLine', () => {
        test('should return true when line is within scope range', () => {
            // TS-1.1: Scope contains line
            const scope = new Scope({
                name: 'testMethod',
                kind: 'method',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.containsLine(15), true);
            assert.strictEqual(scope.containsLine(10), true); // boundary
            assert.strictEqual(scope.containsLine(20), true); // boundary
        });

        test('should return false when line is outside scope range', () => {
            // TS-1.2: Scope does not contain line
            const scope = new Scope({
                name: 'testMethod',
                kind: 'method',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.containsLine(25), false);
            assert.strictEqual(scope.containsLine(5), false);
            assert.strictEqual(scope.containsLine(9), false);
            assert.strictEqual(scope.containsLine(21), false);
        });
    });

    suite('containsRange', () => {
        test('should return true when range is fully contained', () => {
            // TS-1.3: Scope contains range (fully)
            const scope = new Scope({
                name: 'testMethod',
                kind: 'method',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.containsRange(12, 18), true);
        });

        test('should return true for partial overlap', () => {
            // TS-1.4: Scope contains range (partial overlap)
            const scope = new Scope({
                name: 'testMethod',
                kind: 'method',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.containsRange(15, 25), true); // overlaps at end
            assert.strictEqual(scope.containsRange(5, 15), true); // overlaps at start
            assert.strictEqual(scope.containsRange(5, 25), true); // scope fully within range
        });

        test('should return false when no overlap', () => {
            const scope = new Scope({
                name: 'testMethod',
                kind: 'method',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.containsRange(25, 30), false);
            assert.strictEqual(scope.containsRange(1, 5), false);
        });
    });

    suite('fullName', () => {
        test('should return containerName.name when containerName exists', () => {
            // TS-1.5: Scope full name with container
            const scope = new Scope({
                name: 'methodName',
                kind: 'method',
                startLine: 10,
                endLine: 20,
                containerName: 'ClassName',
            });

            assert.strictEqual(scope.fullName, 'ClassName.methodName');
        });

        test('should return just name when no containerName', () => {
            // TS-1.6: Scope full name without container
            const scope = new Scope({
                name: 'functionName',
                kind: 'function',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.fullName, 'functionName');
        });
    });

    suite('displayName', () => {
        test('should add () suffix for methods', () => {
            const scope = new Scope({
                name: 'doSomething',
                kind: 'method',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.displayName, 'doSomething()');
        });

        test('should add () suffix for functions', () => {
            const scope = new Scope({
                name: 'processData',
                kind: 'function',
                startLine: 10,
                endLine: 20,
            });

            assert.strictEqual(scope.displayName, 'processData()');
        });

        test('should not add suffix for classes', () => {
            const scope = new Scope({
                name: 'MyClass',
                kind: 'class',
                startLine: 10,
                endLine: 100,
            });

            assert.strictEqual(scope.displayName, 'MyClass');
        });
    });

    suite('children', () => {
        test('should properly store nested children as Scope instances', () => {
            // TS-1.7: Nested children
            const scope = new Scope({
                name: 'ParentClass',
                kind: 'class',
                startLine: 1,
                endLine: 50,
                children: [
                    {
                        name: 'methodA',
                        kind: 'method',
                        startLine: 5,
                        endLine: 15,
                        containerName: 'ParentClass',
                    },
                    {
                        name: 'methodB',
                        kind: 'method',
                        startLine: 20,
                        endLine: 30,
                        containerName: 'ParentClass',
                    },
                ],
            });

            assert.strictEqual(scope.children.length, 2);
            assert.ok(scope.children[0] instanceof Scope);
            assert.strictEqual(scope.children[0].name, 'methodA');
            assert.strictEqual(scope.children[1].name, 'methodB');
        });

        test('should handle empty children array', () => {
            const scope = new Scope({
                name: 'standalone',
                kind: 'function',
                startLine: 1,
                endLine: 10,
            });

            assert.strictEqual(scope.children.length, 0);
        });
    });

    suite('toData', () => {
        test('should convert back to plain data object', () => {
            const originalData = {
                name: 'MyClass',
                kind: 'class',
                startLine: 1,
                endLine: 50,
                containerName: 'Module',
                children: [
                    {
                        name: 'method',
                        kind: 'method',
                        startLine: 5,
                        endLine: 10,
                        containerName: 'MyClass',
                    },
                ],
            };

            const scope = new Scope(originalData);
            const data = scope.toData();

            assert.strictEqual(data.name, 'MyClass');
            assert.strictEqual(data.kind, 'class');
            assert.strictEqual(data.startLine, 1);
            assert.strictEqual(data.endLine, 50);
            assert.strictEqual(data.containerName, 'Module');
            assert.strictEqual(data.children!.length, 1);
            assert.strictEqual(data.children![0].name, 'method');
        });
    });
});
