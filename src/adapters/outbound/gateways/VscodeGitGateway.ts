import { exec } from 'child_process';
import { IGitPort, FileStatus } from '../../../application/ports/outbound/IGitPort';

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

    async createWorktree(path: string, branch: string, workspaceRoot: string): Promise<void> {
        return new Promise((resolve, reject) => {
            exec(
                `cd "${workspaceRoot}" && git worktree add "${path}" -b "${branch}"`,
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
}
