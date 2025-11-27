import { Comment } from '../../../domain/entities/Comment';

export interface AddCommentInput {
    file: string;
    line: number;
    endLine?: number;
    text: string;
    codeContext: string;
}

export interface IAddCommentUseCase {
    execute(input: AddCommentInput): Promise<Comment>;
}
