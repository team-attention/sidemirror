import { ScopedDiffResult } from '../../../domain/entities/ScopedDiff';

export interface IGenerateScopedDiffUseCase {
    execute(relativePath: string): Promise<ScopedDiffResult | null>;
}
