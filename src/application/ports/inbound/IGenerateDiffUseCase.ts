import { DiffResult } from '../../../domain/entities/Diff';

export interface IGenerateDiffUseCase {
    execute(relativePath: string): Promise<DiffResult | null>;
}
