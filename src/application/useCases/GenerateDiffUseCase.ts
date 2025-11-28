import { DiffService } from '../../domain/services/DiffService';
import { DiffResult } from '../../domain/entities/Diff';
import { ISnapshotRepository } from '../ports/outbound/ISnapshotRepository';
import { IFileSystemPort } from '../ports/outbound/IFileSystemPort';
import { IGitPort } from '../ports/outbound/IGitPort';
import { IGenerateDiffUseCase } from '../ports/inbound/IGenerateDiffUseCase';

export class GenerateDiffUseCase implements IGenerateDiffUseCase {
    constructor(
        private readonly snapshotRepository: ISnapshotRepository,
        private readonly fileSystemPort: IFileSystemPort,
        private readonly gitPort: IGitPort,
        private readonly diffService: DiffService
    ) {}

    async execute(relativePath: string): Promise<DiffResult | null> {
        const workspaceRoot = this.fileSystemPort.getWorkspaceRoot();
        if (!workspaceRoot) return null;

        let diffResult: DiffResult;

        if (this.snapshotRepository.has(relativePath)) {
            diffResult = await this.generateSnapshotDiff(relativePath);
        } else {
            const rawDiff = await this.gitPort.getDiff(workspaceRoot, relativePath);
            diffResult = this.diffService.parseUnifiedDiff(relativePath, rawDiff);
        }

        if (diffResult.hunks.length === 0) {
            return null;
        }

        return diffResult;
    }

    private async generateSnapshotDiff(relativePath: string): Promise<DiffResult> {
        const snapshot = await this.snapshotRepository.findByPath(relativePath);
        const absolutePath = this.fileSystemPort.toAbsolutePath(relativePath);

        let currentContent = '';
        try {
            if (await this.fileSystemPort.fileExists(absolutePath)) {
                currentContent = await this.fileSystemPort.readFile(absolutePath);
            }
        } catch {
            return { file: relativePath, hunks: [], stats: { additions: 0, deletions: 0 } };
        }

        if (snapshot === undefined) {
            if (!currentContent) {
                return { file: relativePath, hunks: [], stats: { additions: 0, deletions: 0 } };
            }
            return this.diffService.generateNewFileStructuredDiff(relativePath, currentContent);
        }

        return this.diffService.generateStructuredDiff(relativePath, snapshot.content, currentContent);
    }
}
