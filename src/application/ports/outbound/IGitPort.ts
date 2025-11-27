export interface IGitPort {
    getDiff(workspaceRoot: string, relativePath: string): Promise<string>;
    isGitRepository(workspaceRoot: string): Promise<boolean>;
}
