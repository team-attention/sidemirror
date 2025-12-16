import { exec } from 'child_process';
import * as fs from 'fs';
import { IGitPort, FileStatus, WorktreeInfo } from '../../../application/ports/outbound/IGitPort';

export class VscodeGitGateway implements IGitPort {
    async isGitRepository(workspaceRoot: string): Promise<boolean> {
        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git rev-parse --git-dir`,
                { maxBuffer: 1024 * 1024 },
                (error) => {
                    resolve(!error);
                }
            );
        });
    }

    async getDiff(workspaceRoot: string, relativePath: string): Promise<string> {
        const isGit = await this.isGitRepository(workspaceRoot);
        if (!isGit) return '';

        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git diff HEAD -- "${relativePath}"`,
                { maxBuffer: 1024 * 1024 * 10 },
                (error, stdout) => {
                    if (!error && stdout.trim()) {
                        resolve(stdout);
                        return;
                    }

                    exec(
                        `cd "${workspaceRoot}" && git ls-files --others --exclude-standard -- "${relativePath}"`,
                        { maxBuffer: 1024 * 1024 },
                        (untrackedErr, untrackedOut) => {
                            if (!untrackedErr && untrackedOut.trim()) {
                                exec(
                                    `cd "${workspaceRoot}" && cat "${relativePath}"`,
                                    { maxBuffer: 1024 * 1024 * 10 },
                                    (_catErr, fileContent) => {
                                        if (fileContent) {
                                            const lines = fileContent.split('\n');
                                            const fakeDiff = lines.map((line) => `+${line}`).join('\n');
                                            resolve(`@@ -0,0 +1,${lines.length} @@ New file\n${fakeDiff}`);
                                        } else {
                                            resolve('');
                                        }
                                    }
                                );
                            } else {
                                // Final fallback: try reading file directly (for gitignored files)
                                exec(
                                    `cd "${workspaceRoot}" && cat "${relativePath}"`,
                                    { maxBuffer: 1024 * 1024 * 10 },
                                    (_catErr, fileContent) => {
                                        if (fileContent && fileContent.trim()) {
                                            const lines = fileContent.split('\n');
                                            const fakeDiff = lines.map((line) => `+${line}`).join('\n');
                                            resolve(`@@ -0,0 +1,${lines.length} @@ New file\n${fakeDiff}`);
                                        } else {
                                            resolve('');
                                        }
                                    }
                                );
                            }
                        }
                    );
                }
            );
        });
    }

    async getUncommittedFiles(workspaceRoot: string): Promise<string[]> {
        const isGit = await this.isGitRepository(workspaceRoot);
        if (!isGit) return [];

        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git status --porcelain`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        resolve([]);
                        return;
                    }

                    const files = stdout
                        .split('\n')
                        .filter((line) => line.trim())
                        .map((line) => line.substring(3).trim())
                        .filter((file) => file.length > 0);

                    resolve(files);
                }
            );
        });
    }

    async getFileStatus(workspaceRoot: string, relativePath: string): Promise<FileStatus> {
        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git status --porcelain -- "${relativePath}"`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error || !stdout.trim()) {
                        resolve('modified');
                        return;
                    }
                    const statusCode = stdout.substring(0, 2);
                    if (statusCode.includes('A') || statusCode === '??') {
                        resolve('added');
                    } else if (statusCode.includes('D')) {
                        resolve('deleted');
                    } else {
                        resolve('modified');
                    }
                }
            );
        });
    }

    async getUncommittedFilesWithStatus(workspaceRoot: string): Promise<Array<{ path: string; status: FileStatus }>> {
        const isGit = await this.isGitRepository(workspaceRoot);
        if (!isGit) return [];

        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git status --porcelain`,
                { maxBuffer: 1024 * 1024 },
                async (error, stdout) => {
                    if (error) {
                        resolve([]);
                        return;
                    }

                    const entries = stdout
                        .split('\n')
                        .filter((line) => line.trim())
                        .map((line) => {
                            const statusCode = line.substring(0, 2);
                            const filePath = line.substring(3).trim();
                            let status: FileStatus = 'modified';
                            if (statusCode.includes('A') || statusCode === '??') {
                                status = 'added';
                            } else if (statusCode.includes('D')) {
                                status = 'deleted';
                            }
                            return { path: filePath, status };
                        })
                        .filter((f) => f.path.length > 0);

                    // Expand directories to individual files
                    const expandedFiles: Array<{ path: string; status: FileStatus }> = [];

                    for (const entry of entries) {
                        if (entry.path.endsWith('/')) {
                            // It's a directory - list files inside
                            const dirFiles = await this.listFilesInDirectory(workspaceRoot, entry.path);
                            for (const file of dirFiles) {
                                expandedFiles.push({ path: file, status: entry.status });
                            }
                        } else {
                            expandedFiles.push(entry);
                        }
                    }

                    resolve(expandedFiles);
                }
            );
        });
    }

    async getCurrentBranch(workspaceRoot: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(
                `cd "${workspaceRoot}" && git rev-parse --abbrev-ref HEAD`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(stdout.trim());
                }
            );
        });
    }

    async createWorktree(worktreePath: string, branch: string, workspaceRoot: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Extract parent directory and create it if needed
            const parentDir = worktreePath.substring(0, worktreePath.lastIndexOf('/'));
            const mkdirCmd = parentDir ? `mkdir -p "${parentDir}" && ` : '';

            exec(
                `cd "${workspaceRoot}" && ${mkdirCmd}git worktree add "${worktreePath}" -b "${branch}"`,
                { maxBuffer: 1024 * 1024 },
                (error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    async getWorktreeRoot(workspaceRoot: string): Promise<string | null> {
        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git rev-parse --show-toplevel`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        resolve(null);
                        return;
                    }
                    resolve(stdout.trim());
                }
            );
        });
    }

    private listFilesInDirectory(workspaceRoot: string, dirPath: string): Promise<string[]> {
        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && find "${dirPath}" -type f 2>/dev/null`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error || !stdout.trim()) {
                        resolve([]);
                        return;
                    }
                    const files = stdout
                        .split('\n')
                        .filter((line) => line.trim())
                        .map((line) => line.trim());
                    resolve(files);
                }
            );
        });
    }

    async listWorktrees(workspaceRoot: string): Promise<WorktreeInfo[]> {
        return new Promise((resolve) => {
            exec(
                `cd "${workspaceRoot}" && git worktree list --porcelain`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        resolve([]);
                        return;
                    }

                    const worktrees: WorktreeInfo[] = [];
                    const lines = stdout.split('\n').filter(line => line.trim());

                    // Parse porcelain format: groups of 3 lines
                    // worktree /path
                    // HEAD sha
                    // branch refs/heads/name
                    let i = 0;
                    while (i < lines.length) {
                        const worktreeLine = lines[i];
                        const headLine = lines[i + 1];
                        const branchLine = lines[i + 2];

                        if (!worktreeLine || !headLine) {
                            i++;
                            continue;
                        }

                        const pathMatch = worktreeLine.match(/^worktree (.+)$/);
                        const headMatch = headLine.match(/^HEAD (.+)$/);
                        const branchMatch = branchLine?.match(/^branch refs\/heads\/(.+)$/);

                        if (pathMatch && headMatch) {
                            const path = pathMatch[1];
                            const head = headMatch[1];
                            const branch = branchMatch ? branchMatch[1] : 'HEAD';

                            // Skip main repository root (first entry)
                            if (path !== workspaceRoot) {
                                worktrees.push({ path, branch, head });
                            }
                        }

                        // Move to next worktree entry
                        i += 3;
                    }

                    resolve(worktrees);
                }
            );
        });
    }

    async isValidWorktree(path: string, workspaceRoot: string): Promise<boolean> {
        // Step 1: Check if path exists and is accessible
        try {
            await fs.promises.access(path, fs.constants.R_OK);
        } catch {
            return false;
        }

        // Step 2: Check if path is a valid git repository
        const isGitRepo = await new Promise<boolean>((resolve) => {
            exec(
                `cd "${path}" && git rev-parse --git-dir`,
                { maxBuffer: 1024 * 1024 },
                (error) => {
                    resolve(!error);
                }
            );
        });

        if (!isGitRepo) {
            return false;
        }

        // Step 3: Verify path is listed in main repo's worktree list
        const worktrees = await this.listWorktrees(workspaceRoot);
        return worktrees.some(wt => wt.path === path);
    }

    async getWorktreeBranch(worktreePath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            exec(
                `cd "${worktreePath}" && git rev-parse --abbrev-ref HEAD`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        reject(new Error(`Failed to get branch name: ${error.message}`));
                        return;
                    }
                    const branch = stdout.trim();
                    resolve(branch);
                }
            );
        });
    }

    async removeWorktree(worktreePath: string, workspaceRoot: string, force = false): Promise<void> {
        return new Promise((resolve, reject) => {
            const forceFlag = force ? ' --force' : '';
            exec(
                `cd "${workspaceRoot}" && git worktree remove "${worktreePath}"${forceFlag}`,
                { maxBuffer: 1024 * 1024 },
                (error) => {
                    if (error) {
                        reject(new Error(`Failed to remove worktree: ${error.message}`));
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    async switchBranch(workingDir: string, targetBranch: string): Promise<void> {
        return new Promise((resolve, reject) => {
            exec(
                `cd "${workingDir}" && git switch "${targetBranch}"`,
                { maxBuffer: 1024 * 1024 },
                (error) => {
                    if (error) {
                        reject(new Error(`Failed to switch branch: ${error.message}`));
                        return;
                    }
                    resolve();
                }
            );
        });
    }

    async listBranches(workspaceRoot: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            exec(
                `cd "${workspaceRoot}" && git branch -a --format='%(refname:short)'`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        reject(new Error(`Failed to list branches: ${error.message}`));
                        return;
                    }
                    const branches = stdout
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.length > 0);
                    resolve(branches);
                }
            );
        });
    }

    async hasUncommittedChanges(workingDir: string): Promise<boolean> {
        return new Promise((resolve) => {
            exec(
                `cd "${workingDir}" && git status --porcelain`,
                { maxBuffer: 1024 * 1024 },
                (error, stdout) => {
                    if (error) {
                        // On error, assume no changes
                        resolve(false);
                        return;
                    }
                    resolve(stdout.trim().length > 0);
                }
            );
        });
    }

    async stashChanges(workingDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            exec(
                `cd "${workingDir}" && git stash push -m "code-squad-auto"`,
                { maxBuffer: 1024 * 1024 },
                (error) => {
                    if (error) {
                        reject(new Error(`Failed to stash changes: ${error.message}`));
                        return;
                    }
                    resolve();
                }
            );
        });
    }
}
