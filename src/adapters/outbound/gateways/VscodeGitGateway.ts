import { exec } from 'child_process';
import { IGitPort } from '../../../application/ports/outbound/IGitPort';

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
}
