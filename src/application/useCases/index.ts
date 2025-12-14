export { AddCommentUseCase } from './AddCommentUseCase';
export { SubmitCommentsUseCase } from './SubmitCommentsUseCase';
export { GenerateDiffUseCase } from './GenerateDiffUseCase';
export { GenerateScopedDiffUseCase } from './GenerateScopedDiffUseCase';
export { CaptureSnapshotsUseCase } from './CaptureSnapshotsUseCase';
export { EditCommentUseCase } from './EditCommentUseCase';
export { DeleteCommentUseCase } from './DeleteCommentUseCase';
export { FetchHNStoriesUseCase } from './FetchHNStoriesUseCase';
export { TrackFileOwnershipUseCase } from './TrackFileOwnershipUseCase';

// Re-export from ports for backward compatibility
export { AddCommentInput } from '../ports/inbound/IAddCommentUseCase';
export { IFileGlobber } from '../ports/outbound/IFileGlobber';
export { FetchHNStoriesResult } from '../ports/inbound/IFetchHNStoriesUseCase';
