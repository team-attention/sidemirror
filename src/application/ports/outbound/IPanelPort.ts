import { Comment } from '../../../domain/entities/Comment';

export interface IPanelPort {
    show(): void;
    updateFileChanged(file: string): void;
    updateCommentAdded(comment: Comment): void;
    updateAIType(aiType: string): void;
    postDiff(file: string, diff: string): void;
    removeFile(file: string): void;
}
