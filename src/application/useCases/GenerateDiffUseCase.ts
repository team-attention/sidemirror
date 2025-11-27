import { DiffService } from '../../domain/services/DiffService';
import { ISnapshotRepository } from '../ports/outbound/ISnapshotRepository';
import { IFileSystemPort } from '../ports/outbound/IFileSystemPort';
import { IGitPort } from '../ports/outbound/IGitPort';
import { IPanelPort } from '../ports/outbound/IPanelPort';
import { IGenerateDiffUseCase } from '../ports/inbound/IGenerateDiffUseCase';

export class GenerateDiffUseCase implements IGenerateDiffUseCase {
    constructor(
        private readonly snapshotRepository: ISnapshotRepository,
        private readonly fileSystemPort: IFileSystemPort,
        private readonly gitPort: IGitPort,
        private readonly panelPort: IPanelPort,
        private readonly diffService: DiffService
    ) {}

    async execute(relativePath: string): Promise<void> {
        const workspaceRoot = this.fileSystemPort.getWorkspaceRoot();
        if (!workspaceRoot) return;

        let diff = '';

        if (this.snapshotRepository.has(relativePath)) {
            diff = await this.generateSnapshotDiff(relativePath);
        } else {
            diff = await this.gitPort.getDiff(workspaceRoot, relativePath);
        }

        if (!diff || diff.trim() === '') {
            this.panelPort.removeFile(relativePath);
            return;
        }

        this.panelPort.postDiff(relativePath, diff);
    }

    private async generateSnapshotDiff(relativePath: string): Promise<string> {
        const snapshot = await this.snapshotRepository.findByPath(relativePath);
        const absolutePath = this.fileSystemPort.toAbsolutePath(relativePath);

        let currentContent = '';
        try {
            if (await this.fileSystemPort.fileExists(absolutePath)) {
                currentContent = await this.fileSystemPort.readFile(absolutePath);
            }
        } catch {
            return '';
        }

        if (snapshot === undefined) {
            if (!currentContent) return '';
            return this.diffService.generateNewFileDiff(currentContent);
        }

        return this.diffService.generateUnifiedDiff(snapshot.content, currentContent);
    }
}
