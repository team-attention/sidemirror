import { FileSnapshot } from '../../../domain/entities/FileSnapshot';

export interface SnapshotStats {
    count: number;
    totalSize: number;
}

export interface ISnapshotRepository {
    save(snapshot: FileSnapshot): Promise<boolean>;
    findByPath(relativePath: string): Promise<FileSnapshot | undefined>;
    has(relativePath: string): boolean;
    clear(): void;
    getAll(): Map<string, FileSnapshot>;
    getStats(): SnapshotStats;
}
