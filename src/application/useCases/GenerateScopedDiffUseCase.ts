import { IGenerateScopedDiffUseCase } from '../ports/inbound/IGenerateScopedDiffUseCase';
import { IGenerateDiffUseCase } from '../ports/inbound/IGenerateDiffUseCase';
import { ISymbolPort, ScopeInfo } from '../ports/outbound/ISymbolPort';
import { IFileSystemPort } from '../ports/outbound/IFileSystemPort';
import { ScopeMappingService } from '../../domain/services/ScopeMappingService';
import { ScopedDiffResult } from '../../domain/entities/ScopedDiff';

export class GenerateScopedDiffUseCase implements IGenerateScopedDiffUseCase {
    constructor(
        private readonly generateDiffUseCase: IGenerateDiffUseCase,
        private readonly symbolPort: ISymbolPort,
        private readonly fileSystemPort: IFileSystemPort,
        private readonly scopeMappingService: ScopeMappingService
    ) {}

    async execute(relativePath: string): Promise<ScopedDiffResult | null> {
        const diff = await this.generateDiffUseCase.execute(relativePath);
        if (!diff) {
            return null;
        }

        const absolutePath = this.fileSystemPort.toAbsolutePath(relativePath);

        // Read current file content for full scope display
        let fileContent: string | undefined;
        try {
            fileContent = await this.fileSystemPort.readFile(absolutePath);
        } catch (error) {
            console.warn('[Sidecar] Failed to read file content:', error);
        }

        // Get scope information from LSP
        let scopes: ScopeInfo[] = [];
        try {
            scopes = await this.symbolPort.getAllFileSymbols(absolutePath);
        } catch (error) {
            // LSP failed, will fall back to chunk-based view
            console.warn('[Sidecar] Symbol extraction failed:', error);
        }

        return this.scopeMappingService.mapDiffToScopes(diff, scopes, fileContent);
    }
}
