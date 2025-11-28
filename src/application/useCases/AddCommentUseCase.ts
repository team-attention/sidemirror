import { Comment } from '../../domain/entities/Comment';
import { ICommentRepository } from '../ports/outbound/ICommentRepository';
import { IAddCommentUseCase, AddCommentInput } from '../ports/inbound/IAddCommentUseCase';

export class AddCommentUseCase implements IAddCommentUseCase {
    constructor(
        private readonly commentRepository: ICommentRepository
    ) {}

    async execute(input: AddCommentInput): Promise<Comment> {
        const comment = Comment.create({
            file: input.file,
            line: input.line,
            endLine: input.endLine,
            text: input.text,
            codeContext: input.codeContext,
        });

        await this.commentRepository.save(comment);

        return comment;
    }
}
