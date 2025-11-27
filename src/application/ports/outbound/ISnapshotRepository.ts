import { FileSnapshot } from '../../../domain/entities/FileSnapshot';

export interface ISnapshotRepository {
    save(snapshot: FileSnapshot): Promise<void>;
    findByPath(relativePath: string): Promise<FileSnapshot | undefined>;
    has(relativePath: string): boolean;
    clear(): void;
    getAll(): Map<string, FileSnapshot>;
}
