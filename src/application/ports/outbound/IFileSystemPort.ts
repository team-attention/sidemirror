export interface IFileSystemPort {
    readFile(absolutePath: string): Promise<string>;
    fileExists(absolutePath: string): Promise<boolean>;
    isFile(absolutePath: string): Promise<boolean>;
    getWorkspaceRoot(): string | undefined;
    toAbsolutePath(relativePath: string): string;
    toRelativePath(absolutePath: string): string;
}
