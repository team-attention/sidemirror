import { ThreadState } from '../../../domain/entities/ThreadState';

export interface SwitchThreadBranchInput {
    threadId: string;
    targetBranch: string;
    stashChanges?: boolean;  // default: true
}

export interface SwitchThreadBranchOutput {
    success: boolean;
    threadState: ThreadState | null;
    previousBranch: string | null;
    changesStashed: boolean;
}

export interface ISwitchThreadBranchUseCase {
    execute(input: SwitchThreadBranchInput): Promise<SwitchThreadBranchOutput>;
}
