import { FileSnapshot } from '../../domain/entities/FileSnapshot';
import { ISnapshotRepository, SnapshotStats } from '../../application/ports/outbound/ISnapshotRepository';

const MAX_SNAPSHOT_COUNT = 100;
const MAX_SNAPSHOT_SIZE = 100 * 1024; // 100KB

export class InMemorySnapshotRepository implements ISnapshotRepository {
    private snapshots = new Map<string, FileSnapshot>();
    private accessOrder: string[] = []; // LRU tracking

    private updateAccessOrder(path: string): void {
        const index = this.accessOrder.indexOf(path);
        if (index !== -1) {
            this.accessOrder.splice(index, 1);
        }
        this.accessOrder.push(path);
    }

    private evictOldest(): void {
        if (this.accessOrder.length > 0) {
            const oldest = this.accessOrder.shift()!;
            this.snapshots.delete(oldest);
        }
    }

    async save(snapshot: FileSnapshot): Promise<boolean> {
        // Check size limit
        const contentSize = Buffer.byteLength(snapshot.content, 'utf8');
        if (contentSize > MAX_SNAPSHOT_SIZE) {
            console.warn(
                `[Snapshot] Skipping ${snapshot.relativePath}: size ${contentSize} exceeds limit ${MAX_SNAPSHOT_SIZE}`
            );
            return false;
        }

        // Evict if at capacity (and not updating existing)
        if (!this.snapshots.has(snapshot.relativePath) && this.snapshots.size >= MAX_SNAPSHOT_COUNT) {
            this.evictOldest();
        }

        this.snapshots.set(snapshot.relativePath, snapshot);
        this.updateAccessOrder(snapshot.relativePath);
        return true;
    }

    async findByPath(relativePath: string): Promise<FileSnapshot | undefined> {
        const snapshot = this.snapshots.get(relativePath);
        if (snapshot) {
            this.updateAccessOrder(relativePath);
        }
        return snapshot;
    }

    has(relativePath: string): boolean {
        return this.snapshots.has(relativePath);
    }

    clear(): void {
        this.snapshots.clear();
        this.accessOrder = [];
    }

    getAll(): Map<string, FileSnapshot> {
        return new Map(this.snapshots);
    }

    getStats(): SnapshotStats {
        let totalSize = 0;
        for (const snapshot of this.snapshots.values()) {
            totalSize += Buffer.byteLength(snapshot.content, 'utf8');
        }
        return {
            count: this.snapshots.size,
            totalSize,
        };
    }
}
