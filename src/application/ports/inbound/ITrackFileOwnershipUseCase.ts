export interface TrackFileOwnershipInput {
    filePath: string;
    threadId: string;
}

export interface ITrackFileOwnershipUseCase {
    execute(input: TrackFileOwnershipInput): Promise<void>;
}
