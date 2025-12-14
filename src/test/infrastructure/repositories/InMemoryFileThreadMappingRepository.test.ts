import * as assert from 'assert';
import { InMemoryFileThreadMappingRepository } from '../../../infrastructure/repositories/InMemoryFileThreadMappingRepository';
import { FileThreadMapping } from '../../../domain/entities/FileThreadMapping';

suite('InMemoryFileThreadMappingRepository', () => {
    let repository: InMemoryFileThreadMappingRepository;

    setup(() => {
        repository = new InMemoryFileThreadMappingRepository();
    });

    suite('TS8: Save and Find', () => {
        test('should save and find mapping by file path', async () => {
            // Arrange
            const mapping = FileThreadMapping.create('src/app.ts', 'tid-a');

            // Act
            await repository.save(mapping);
            const result = await repository.findByFilePath('src/app.ts');

            // Assert
            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.threadId, 'tid-a');
            assert.strictEqual(result!.filePath, 'src/app.ts');
        });

        test('should return null for non-existent file path', async () => {
            const result = await repository.findByFilePath('non-existent.ts');
            assert.strictEqual(result, null);
        });

        test('should overwrite existing mapping for same file', async () => {
            // Arrange
            const mapping1 = FileThreadMapping.create('src/app.ts', 'tid-a');
            const mapping2 = FileThreadMapping.create('src/app.ts', 'tid-b');

            // Act
            await repository.save(mapping1);
            await repository.save(mapping2);
            const result = await repository.findByFilePath('src/app.ts');

            // Assert
            assert.notStrictEqual(result, null);
            assert.strictEqual(result!.threadId, 'tid-b');
        });
    });

    suite('TS9: Clear All', () => {
        test('should clear all mappings', async () => {
            // Arrange
            const mapping1 = FileThreadMapping.create('src/app.ts', 'tid-a');
            const mapping2 = FileThreadMapping.create('src/util.ts', 'tid-b');
            await repository.save(mapping1);
            await repository.save(mapping2);

            // Act
            await repository.clear();
            const result = await repository.findAll();

            // Assert
            assert.strictEqual(result.length, 0);
        });
    });

    suite('findByThreadId', () => {
        test('should find all mappings for a thread', async () => {
            // Arrange
            await repository.save(FileThreadMapping.create('src/a.ts', 'tid-a'));
            await repository.save(FileThreadMapping.create('src/b.ts', 'tid-a'));
            await repository.save(FileThreadMapping.create('src/c.ts', 'tid-b'));

            // Act
            const result = await repository.findByThreadId('tid-a');

            // Assert
            assert.strictEqual(result.length, 2);
            assert.ok(result.every(m => m.threadId === 'tid-a'));
        });

        test('should return empty array for non-existent thread', async () => {
            const result = await repository.findByThreadId('non-existent');
            assert.strictEqual(result.length, 0);
        });
    });

    suite('findAll', () => {
        test('should return all mappings', async () => {
            // Arrange
            await repository.save(FileThreadMapping.create('src/a.ts', 'tid-a'));
            await repository.save(FileThreadMapping.create('src/b.ts', 'tid-b'));

            // Act
            const result = await repository.findAll();

            // Assert
            assert.strictEqual(result.length, 2);
        });

        test('should return empty array when no mappings', async () => {
            const result = await repository.findAll();
            assert.strictEqual(result.length, 0);
        });
    });

    suite('delete', () => {
        test('should delete existing mapping', async () => {
            // Arrange
            await repository.save(FileThreadMapping.create('src/app.ts', 'tid-a'));

            // Act
            const deleted = await repository.delete('src/app.ts');
            const result = await repository.findByFilePath('src/app.ts');

            // Assert
            assert.strictEqual(deleted, true);
            assert.strictEqual(result, null);
        });

        test('should return false when deleting non-existent mapping', async () => {
            const deleted = await repository.delete('non-existent.ts');
            assert.strictEqual(deleted, false);
        });
    });
});
