import { FileSnapshot } from '../../domain/entities/FileSnapshot';
import { ISnapshotRepository } from '../ports/outbound/ISnapshotRepository';
import { IFileSystemPort } from '../ports/outbound/IFileSystemPort';
import { IFileGlobber } from '../ports/outbound/IFileGlobber';
import { ICaptureSnapshotsUseCase } from '../ports/inbound/ICaptureSnapshotsUseCase';

export class CaptureSnapshotsUseCase implements ICaptureSnapshotsUseCase {
    constructor(
        private readonly snapshotRepository: ISnapshotRepository,
        private readonly fileSystemPort: IFileSystemPort,
        private readonly fileGlobber: IFileGlobber
    ) {}

    async execute(includePatterns: string[]): Promise<number> {
        const workspaceRoot = this.fileSystemPort.getWorkspaceRoot();
        if (!workspaceRoot) return 0;

        this.snapshotRepository.clear();

        if (includePatterns.length === 0) {
            return 0;
        }

        let count = 0;
        for (const pattern of includePatterns) {
            const files = await this.fileGlobber.glob(pattern, workspaceRoot);
            for (const absolutePath of files) {
                const captured = await this.captureFile(absolutePath, workspaceRoot);
                if (captured) count++;
            }
        }

        return count;
    }

    private async captureFile(absolutePath: string, workspaceRoot: string): Promise<boolean> {
        try {
            const exists = await this.fileSystemPort.fileExists(absolutePath);
            const isFile = await this.fileSystemPort.isFile(absolutePath);

            if (exists && isFile) {
                const content = await this.fileSystemPort.readFile(absolutePath);
                const relativePath = this.fileSystemPort.toRelativePath(absolutePath);
                const snapshot = FileSnapshot.create(relativePath, content);
                await this.snapshotRepository.save(snapshot);
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }
}
