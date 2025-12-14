import { FileThreadMapping } from '../../domain/entities/FileThreadMapping';
import { IFileThreadMappingRepository } from '../../application/ports/outbound/IFileThreadMappingRepository';

export class InMemoryFileThreadMappingRepository implements IFileThreadMappingRepository {
    private mappings = new Map<string, FileThreadMapping>();

    async save(mapping: FileThreadMapping): Promise<void> {
        this.mappings.set(mapping.filePath, mapping);
    }

    async findByFilePath(filePath: string): Promise<FileThreadMapping | null> {
        return this.mappings.get(filePath) ?? null;
    }

    async findByThreadId(threadId: string): Promise<FileThreadMapping[]> {
        const results: FileThreadMapping[] = [];
        for (const mapping of this.mappings.values()) {
            if (mapping.threadId === threadId) {
                results.push(mapping);
            }
        }
        return results;
    }

    async findAll(): Promise<FileThreadMapping[]> {
        return Array.from(this.mappings.values());
    }

    async delete(filePath: string): Promise<boolean> {
        return this.mappings.delete(filePath);
    }

    async clear(): Promise<void> {
        this.mappings.clear();
    }
}
