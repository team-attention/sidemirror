import { ISwitchThreadBranchUseCase, SwitchThreadBranchInput, SwitchThreadBranchOutput } from '../ports/inbound/ISwitchThreadBranchUseCase';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { IGitPort } from '../ports/outbound/IGitPort';

export class SwitchThreadBranchUseCase implements ISwitchThreadBranchUseCase {
    constructor(
        private readonly threadStateRepository: IThreadStateRepository,
        private readonly gitPort: IGitPort
    ) {}

    async execute(input: SwitchThreadBranchInput): Promise<SwitchThreadBranchOutput> {
        const { threadId, targetBranch, stashChanges = true } = input;

        // 1. Find thread state
        const threadState = await this.threadStateRepository.findById(threadId);
        if (!threadState) {
            return {
                success: false,
                threadState: null,
                previousBranch: null,
                changesStashed: false
            };
        }

        // 2. Verify this is a worktree thread
        if (!threadState.worktreePath) {
            throw new Error('Cannot switch branch: thread does not have a worktree');
        }

        const previousBranch = threadState.branch ?? null;
        let changesStashed = false;

        // 3. Check for uncommitted changes
        const hasChanges = await this.gitPort.hasUncommittedChanges(threadState.worktreePath);

        if (hasChanges) {
            if (stashChanges) {
                await this.gitPort.stashChanges(threadState.worktreePath);
                changesStashed = true;
            } else {
                throw new Error('Cannot switch branch: uncommitted changes exist. Set stashChanges=true to auto-stash.');
            }
        }

        // 4. Switch branch
        await this.gitPort.switchBranch(threadState.worktreePath, targetBranch);

        // 5. Update thread state with new branch
        const updatedState = threadState.withBranch(targetBranch);
        await this.threadStateRepository.save(updatedState);

        return {
            success: true,
            threadState: updatedState,
            previousBranch,
            changesStashed
        };
    }
}
