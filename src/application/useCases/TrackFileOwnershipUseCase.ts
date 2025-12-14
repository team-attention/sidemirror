import { FileThreadMapping } from '../../domain/entities/FileThreadMapping';
import { IFileThreadMappingRepository } from '../ports/outbound/IFileThreadMappingRepository';
import { ITrackFileOwnershipUseCase, TrackFileOwnershipInput } from '../ports/inbound/ITrackFileOwnershipUseCase';

export class TrackFileOwnershipUseCase implements ITrackFileOwnershipUseCase {
    constructor(
        private readonly mappingRepository: IFileThreadMappingRepository
    ) {}

    async execute(input: TrackFileOwnershipInput): Promise<void> {
        if (!input.threadId) {
            return;
        }

        const mapping = FileThreadMapping.create(input.filePath, input.threadId);
        await this.mappingRepository.save(mapping);
    }
}
