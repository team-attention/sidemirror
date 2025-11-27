export { AddCommentUseCase } from './AddCommentUseCase';
export { SubmitCommentsUseCase } from './SubmitCommentsUseCase';
export { GenerateDiffUseCase } from './GenerateDiffUseCase';
export { CaptureSnapshotsUseCase } from './CaptureSnapshotsUseCase';

// Re-export from ports for backward compatibility
export { AddCommentInput } from '../ports/inbound/IAddCommentUseCase';
export { IFileGlobber } from '../ports/outbound/IFileGlobber';
