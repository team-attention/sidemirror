import { ThreadState } from '../../../domain/entities/ThreadState';

export interface RenameThreadInput {
    threadId: string;
    newName: string;
}

export interface RenameThreadOutput {
    success: boolean;
    threadState: ThreadState | null;
    previousName: string | null;
}

export interface IRenameThreadUseCase {
    execute(input: RenameThreadInput): Promise<RenameThreadOutput>;
}
