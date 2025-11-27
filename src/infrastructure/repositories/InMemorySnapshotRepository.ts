import { FileSnapshot } from '../../domain/entities/FileSnapshot';
import { ISnapshotRepository } from '../../application/ports/outbound/ISnapshotRepository';

export class InMemorySnapshotRepository implements ISnapshotRepository {
    private snapshots = new Map<string, FileSnapshot>();

    async save(snapshot: FileSnapshot): Promise<void> {
        this.snapshots.set(snapshot.relativePath, snapshot);
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
}
