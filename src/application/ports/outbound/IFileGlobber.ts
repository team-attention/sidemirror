export interface IFileGlobber {
    glob(pattern: string, cwd: string): Promise<string[]>;
}
