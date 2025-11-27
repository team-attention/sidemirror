export interface ICaptureSnapshotsUseCase {
    execute(includePatterns: string[]): Promise<number>;
}
