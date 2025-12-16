export type FileStatus = 'added' | 'modified' | 'deleted';

export interface WorktreeInfo {
    path: string;        // Absolute path to worktree directory
    branch: string;      // Branch name (e.g., "feature-x", "main")
    head: string;        // Commit SHA
}

export interface IGitPort {
    getDiff(workspaceRoot: string, relativePath: string): Promise<string>;
    isGitRepository(workspaceRoot: string): Promise<boolean>;
    getUncommittedFiles(workspaceRoot: string): Promise<string[]>;
    getFileStatus(workspaceRoot: string, relativePath: string): Promise<FileStatus>;
    getUncommittedFilesWithStatus(workspaceRoot: string): Promise<Array<{ path: string; status: FileStatus }>>;
    getCurrentBranch(workspaceRoot: string): Promise<string>;
    createWorktree(path: string, branch: string, workspaceRoot: string): Promise<void>;
    getWorktreeRoot(workspaceRoot: string): Promise<string | null>;

    /**
     * List all git worktrees in the repository.
     * Executes `git worktree list --porcelain` and parses output.
     * Excludes the main repository root (only returns linked worktrees).
     *
     * @param workspaceRoot - Root directory of the main repository
     * @returns Array of worktree information
     */
    listWorktrees(workspaceRoot: string): Promise<WorktreeInfo[]>;

    /**
     * Validate if a path is a valid git worktree.
     * Checks:
     * 1. Path exists and is accessible
     * 2. Path is a valid git repository
     * 3. Path is listed in `git worktree list` from main repo
     *
     * @param path - Path to validate
     * @param workspaceRoot - Root directory of the main repository
     * @returns True if path is a valid worktree
     */
    isValidWorktree(path: string, workspaceRoot: string): Promise<boolean>;

    /**
     * Get the branch name for a worktree.
     * Executes `git rev-parse --abbrev-ref HEAD` in the worktree directory.
     *
     * @param worktreePath - Absolute path to worktree
     * @returns Branch name (e.g., "feature-x") or "HEAD" for detached state
     */
    getWorktreeBranch(worktreePath: string): Promise<string>;

    /**
     * Remove a git worktree.
     * Executes `git worktree remove <path>`.
     *
     * @param worktreePath - Absolute path to worktree to remove
     * @param workspaceRoot - Root directory of main repository
     * @param force - Force removal even with uncommitted changes
     * @throws Error if worktree has uncommitted changes and force=false
     */
    removeWorktree(worktreePath: string, workspaceRoot: string, force?: boolean): Promise<void>;

    /**
     * Delete a git branch.
     * Executes `git branch -D <branchName>`.
     *
     * @param branchName - Name of branch to delete
     * @param workspaceRoot - Root directory of repository
     * @param force - Force deletion (use -D instead of -d)
     * @throws Error if branch doesn't exist or is currently checked out
     */
    deleteBranch(branchName: string, workspaceRoot: string, force?: boolean): Promise<void>;
}
