import { IDeleteThreadUseCase, DeleteThreadInput, DeleteThreadOutput } from '../ports/inbound/IDeleteThreadUseCase';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { ITerminalPort } from '../ports/outbound/ITerminalPort';
import { IGitPort } from '../ports/outbound/IGitPort';
import { ICommentRepository } from '../ports/outbound/ICommentRepository';
import { IDetectThreadStatusUseCase } from '../ports/inbound/IDetectThreadStatusUseCase';

export class DeleteThreadUseCase implements IDeleteThreadUseCase {
    constructor(
        private readonly threadStateRepository: IThreadStateRepository,
        private readonly terminalPort: ITerminalPort,
        private readonly gitPort: IGitPort,
        private readonly commentRepository: ICommentRepository,
        private readonly detectStatusUseCase: IDetectThreadStatusUseCase
    ) {}

    async execute(input: DeleteThreadInput): Promise<DeleteThreadOutput> {
        const { threadId, workspaceRoot, closeTerminal = true, removeWorktree = true } = input;

        // 1. Find thread state
        const threadState = await this.threadStateRepository.findById(threadId);
        if (!threadState) {
            return {
                success: false,
                deletedThreadId: threadId,
                deletedCommentsCount: 0,
                worktreeRemoved: false,
                terminalClosed: false
            };
        }

        let terminalClosed = false;
        let worktreeRemoved = false;
        let deletedCommentsCount = 0;

        // 2. Close terminal if requested
        if (closeTerminal && threadState.terminalId) {
            this.terminalPort.closeTerminal(threadState.terminalId);
            terminalClosed = true;
        }

        // 3. Clear status detection state
        this.detectStatusUseCase.clear(threadState.terminalId);

        // 4. Delete thread-scoped comments
        deletedCommentsCount = await this.commentRepository.deleteByThreadId(threadId);

        // 5. Remove worktree if applicable and requested
        if (removeWorktree && threadState.worktreePath) {
            try {
                await this.gitPort.removeWorktree(threadState.worktreePath, workspaceRoot, true);
                worktreeRemoved = true;

                // 5.1. Delete branch after worktree is removed
                if (threadState.branch) {
                    try {
                        await this.gitPort.deleteBranch(threadState.branch, workspaceRoot, true);
                    } catch (branchError) {
                        // Log but don't fail - branch might be in use elsewhere
                        console.error('[Code Squad] Failed to delete branch:', branchError);
                    }
                }
            } catch (error) {
                // Log but don't fail - worktree might already be gone
                console.error('[Code Squad] Failed to remove worktree:', error);
            }
        }

        // 6. Delete thread state
        await this.threadStateRepository.delete(threadId);

        return {
            success: true,
            deletedThreadId: threadId,
            deletedCommentsCount,
            worktreeRemoved,
            terminalClosed
        };
    }
}
