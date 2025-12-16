import * as path from 'path';
import { ThreadState } from '../../domain/entities/ThreadState';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { ITerminalPort } from '../ports/outbound/ITerminalPort';
import { IGitPort } from '../ports/outbound/IGitPort';
import { IFileSystemPort } from '../ports/outbound/IFileSystemPort';
import { IFileGlobber } from '../ports/outbound/IFileGlobber';
import {
    ICreateThreadUseCase,
    CreateThreadInput,
    CreateThreadOutput,
} from '../ports/inbound/ICreateThreadUseCase';

export class CreateThreadUseCase implements ICreateThreadUseCase {
    constructor(
        private readonly threadStateRepository: IThreadStateRepository,
        private readonly terminalPort: ITerminalPort,
        private readonly gitPort: IGitPort,
        private readonly fileSystemPort: IFileSystemPort,
        private readonly fileGlobber: IFileGlobber
    ) {}

    async execute(input: CreateThreadInput): Promise<CreateThreadOutput> {
        const { name, isolationMode, branchName, worktreePath: customWorktreePath, workspaceRoot } = input;
        const effectiveBranchName = branchName ?? name;

        let workingDir = workspaceRoot;
        let branch: string | undefined;
        let worktreePath: string | undefined;

        if (isolationMode === 'worktree') {
            if (customWorktreePath) {
                // Resolve relative path to absolute path based on workspaceRoot
                worktreePath = path.resolve(workspaceRoot, customWorktreePath);
            } else {
                const workspaceName = path.basename(workspaceRoot);
                const worktreeBaseDir = path.join(path.dirname(workspaceRoot), `${workspaceName}.worktree`);
                worktreePath = path.join(worktreeBaseDir, effectiveBranchName);
            }
            await this.gitPort.createWorktree(worktreePath, effectiveBranchName, workspaceRoot);
            workingDir = worktreePath;
            branch = effectiveBranchName;

            // Copy gitignored files to worktree
            await this.copyWorktreeFiles(
                workspaceRoot,
                worktreePath,
                input.worktreeCopyPatterns ?? []
            );
        }

        const terminalId = await this.terminalPort.createTerminal(name, workingDir);

        const threadState = ThreadState.create({
            name,
            terminalId,
            workingDir,
            branch,
            worktreePath,
            whitelistPatterns: [],
        });

        await this.threadStateRepository.save(threadState);

        return { threadState };
    }

    private async copyWorktreeFiles(
        sourceRoot: string,
        destRoot: string,
        patterns: string[]
    ): Promise<void> {
        if (patterns.length === 0) return;

        for (const pattern of patterns) {
            try {
                const files = await this.fileGlobber.glob(pattern, sourceRoot);
                for (const absolutePath of files) {
                    await this.copySingleFile(absolutePath, sourceRoot, destRoot);
                }
            } catch (error) {
                console.warn(`[Code Squad] Failed to glob pattern "${pattern}":`, error);
            }
        }
    }

    private async copySingleFile(
        absolutePath: string,
        sourceRoot: string,
        destRoot: string
    ): Promise<void> {
        try {
            const relativePath = path.relative(sourceRoot, absolutePath);
            const destPath = path.join(destRoot, relativePath);
            const destDir = path.dirname(destPath);

            await this.fileSystemPort.ensureDir(destDir);
            await this.fileSystemPort.copyFile(absolutePath, destPath);
        } catch (error) {
            console.warn(`[Code Squad] Failed to copy "${absolutePath}":`, error);
        }
    }
}
