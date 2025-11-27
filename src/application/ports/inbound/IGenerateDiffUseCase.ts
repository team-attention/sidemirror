export interface IGenerateDiffUseCase {
    execute(relativePath: string): Promise<void>;
}
