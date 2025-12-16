export interface DeleteThreadInput {
    threadId: string;
    workspaceRoot: string;
    closeTerminal?: boolean;    // default: true
    removeWorktree?: boolean;   // default: true for worktree threads
}

export interface DeleteThreadOutput {
    success: boolean;
    deletedThreadId: string;
    deletedCommentsCount: number;
    worktreeRemoved: boolean;
    terminalClosed: boolean;
}

export interface IDeleteThreadUseCase {
    execute(input: DeleteThreadInput): Promise<DeleteThreadOutput>;
}
