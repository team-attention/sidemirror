import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IFileSystemPort } from '../../../application/ports/outbound/IFileSystemPort';

export class VscodeFileSystemGateway implements IFileSystemPort {
    private workspaceRoot: string | undefined;

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        }
    }

    async readFile(absolutePath: string): Promise<string> {
        return fs.promises.readFile(absolutePath, 'utf8');
    }

    async fileExists(absolutePath: string): Promise<boolean> {
        try {
            await fs.promises.access(absolutePath);
            return true;
        } catch {
            return false;
        }
    }

    async isFile(absolutePath: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(absolutePath);
            return stat.isFile();
        } catch {
            return false;
        }
    }

    getWorkspaceRoot(): string | undefined {
        return this.workspaceRoot;
    }

    toAbsolutePath(relativePath: string): string {
        if (!this.workspaceRoot) return relativePath;
        return path.join(this.workspaceRoot, relativePath);
    }

    toRelativePath(absolutePath: string): string {
        if (!this.workspaceRoot) return absolutePath;
        return path.relative(this.workspaceRoot, absolutePath);
    }

    async copyFile(source: string, dest: string): Promise<void> {
        await fs.promises.copyFile(source, dest);
    }

    async ensureDir(dirPath: string): Promise<void> {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
}
