import * as assert from 'assert';
import { TrackFileOwnershipUseCase } from '../../../application/useCases/TrackFileOwnershipUseCase';
import { IFileThreadMappingRepository } from '../../../application/ports/outbound/IFileThreadMappingRepository';
import { FileThreadMapping } from '../../../domain/entities/FileThreadMapping';

class MockFileThreadMappingRepository implements IFileThreadMappingRepository {
    public savedMappings: FileThreadMapping[] = [];

    async save(mapping: FileThreadMapping): Promise<void> {
        this.savedMappings.push(mapping);
    }

    async findByFilePath(_filePath: string): Promise<FileThreadMapping | null> {
        return null;
    }

    async findByThreadId(_threadId: string): Promise<FileThreadMapping[]> {
        return [];
    }

    async findAll(): Promise<FileThreadMapping[]> {
        return [];
    }

    async delete(_filePath: string): Promise<boolean> {
        return false;
    }

    async clear(): Promise<void> {
        this.savedMappings = [];
    }
}

suite('TrackFileOwnershipUseCase', () => {
    let useCase: TrackFileOwnershipUseCase;
    let mockRepository: MockFileThreadMappingRepository;

    setup(() => {
        mockRepository = new MockFileThreadMappingRepository();
        useCase = new TrackFileOwnershipUseCase(mockRepository);
    });

    suite('TS1: Happy Path', () => {
        test('should save file-thread mapping', async () => {
            // Arrange
            const input = { filePath: 'src/app.ts', threadId: 'tid-a' };

            // Act
            await useCase.execute(input);

            // Assert
            assert.strictEqual(mockRepository.savedMappings.length, 1);
            const saved = mockRepository.savedMappings[0];
            assert.strictEqual(saved.filePath, 'src/app.ts');
            assert.strictEqual(saved.threadId, 'tid-a');
            assert.ok(typeof saved.lastModifiedAt === 'number');
        });
    });

    suite('TS2: Overwrite Existing Mapping', () => {
        test('should save new mapping (repository handles overwrite)', async () => {
            // Arrange - use real InMemory repository behavior
            const input = { filePath: 'src/app.ts', threadId: 'new-tid' };

            // Act
            await useCase.execute(input);

            // Assert
            assert.strictEqual(mockRepository.savedMappings.length, 1);
            const saved = mockRepository.savedMappings[0];
            assert.strictEqual(saved.threadId, 'new-tid');
        });
    });

    suite('Edge Cases', () => {
        test('should skip when threadId is empty', async () => {
            // Arrange
            const input = { filePath: 'src/app.ts', threadId: '' };

            // Act
            await useCase.execute(input);

            // Assert
            assert.strictEqual(mockRepository.savedMappings.length, 0);
        });

        test('should handle multiple different files', async () => {
            // Arrange & Act
            await useCase.execute({ filePath: 'src/a.ts', threadId: 'tid-a' });
            await useCase.execute({ filePath: 'src/b.ts', threadId: 'tid-b' });

            // Assert
            assert.strictEqual(mockRepository.savedMappings.length, 2);
        });
    });
});
