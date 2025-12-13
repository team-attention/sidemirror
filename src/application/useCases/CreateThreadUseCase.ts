import * as path from 'path';
import { ThreadState } from '../../domain/entities/ThreadState';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { ITerminalPort } from '../ports/outbound/ITerminalPort';
import { IGitPort } from '../ports/outbound/IGitPort';
import {
    ICreateThreadUseCase,
    CreateThreadInput,
    CreateThreadOutput,
} from '../ports/inbound/ICreateThreadUseCase';

export class CreateThreadUseCase implements ICreateThreadUseCase {
    constructor(
        private readonly threadStateRepository: IThreadStateRepository,
        private readonly terminalPort: ITerminalPort,
        private readonly gitPort: IGitPort
    ) {}

    async execute(input: CreateThreadInput): Promise<CreateThreadOutput> {
        const { name, isolationMode, branchName, workspaceRoot } = input;
        const effectiveBranchName = branchName ?? name;

        let workingDir = workspaceRoot;
        let branch: string | undefined;
        let worktreePath: string | undefined;

        if (isolationMode === 'worktree') {
            worktreePath = path.join(path.dirname(workspaceRoot), effectiveBranchName);
            await this.gitPort.createWorktree(worktreePath, effectiveBranchName, workspaceRoot);
            workingDir = worktreePath;
            branch = effectiveBranchName;
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
}
