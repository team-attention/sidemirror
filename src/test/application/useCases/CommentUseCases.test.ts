import * as assert from 'assert';
import { AddCommentUseCase } from '../../../application/useCases/AddCommentUseCase';
import { EditCommentUseCase } from '../../../application/useCases/EditCommentUseCase';
import { DeleteCommentUseCase } from '../../../application/useCases/DeleteCommentUseCase';
import { ICommentRepository } from '../../../application/ports/outbound/ICommentRepository';
import { Comment } from '../../../domain/entities/Comment';

class MockCommentRepository implements ICommentRepository {
    private comments = new Map<string, Comment>();
    public saveCalled = false;
    public lastSavedComment: Comment | null = null;

    async save(comment: Comment): Promise<void> {
        this.saveCalled = true;
        this.lastSavedComment = comment;
        this.comments.set(comment.id, comment);
    }

    async findAll(): Promise<Comment[]> {
        return Array.from(this.comments.values());
    }

    async findActive(): Promise<Comment[]> {
        return Array.from(this.comments.values()).filter(c => !c.isSubmitted);
    }

    async findByThreadId(threadId: string): Promise<Comment[]> {
        return Array.from(this.comments.values()).filter(c => c.threadId === threadId);
    }

    async findActiveByThreadId(threadId: string): Promise<Comment[]> {
        return Array.from(this.comments.values()).filter(c => c.threadId === threadId && !c.isSubmitted);
    }

    async markAsSubmitted(ids: string[]): Promise<void> {
        ids.forEach(id => {
            const comment = this.comments.get(id);
            if (comment) {
                comment.markAsSubmitted();
            }
        });
    }

    async update(id: string, text: string): Promise<Comment | null> {
        const comment = this.comments.get(id);
        if (!comment) return null;
        const updated = comment.withText(text);
        this.comments.set(id, updated);
        return updated;
    }

    async delete(id: string): Promise<boolean> {
        return this.comments.delete(id);
    }

    async deleteByThreadId(threadId: string): Promise<number> {
        const initial = this.comments.size;
        const toDelete = Array.from(this.comments.values()).filter(c => c.threadId === threadId);
        toDelete.forEach(c => this.comments.delete(c.id));
        return initial - this.comments.size;
    }

    // Test helpers
    addComment(comment: Comment): void {
        this.comments.set(comment.id, comment);
    }

    clear(): void {
        this.comments.clear();
        this.saveCalled = false;
        this.lastSavedComment = null;
    }
}

suite('AddCommentUseCase', () => {
    let useCase: AddCommentUseCase;
    let repository: MockCommentRepository;

    setup(() => {
        repository = new MockCommentRepository();
        useCase = new AddCommentUseCase(repository);
    });

    test('should create and save comment with all fields', async () => {
        const input = {
            file: 'src/test.ts',
            line: 10,
            endLine: 15,
            text: 'This needs refactoring',
            codeContext: 'function test() {}'
        };

        const result = await useCase.execute(input);

        assert.ok(result);
        assert.strictEqual(result.file, input.file);
        assert.strictEqual(result.line, input.line);
        assert.strictEqual(result.endLine, input.endLine);
        assert.strictEqual(result.text, input.text);
        assert.strictEqual(result.codeContext, input.codeContext);
        assert.strictEqual(result.isSubmitted, false);
        assert.ok(result.id);
        assert.ok(result.timestamp);
    });

    test('should save comment to repository', async () => {
        const input = {
            file: 'src/test.ts',
            line: 10,
            text: 'Comment text',
            codeContext: 'code'
        };

        await useCase.execute(input);

        assert.strictEqual(repository.saveCalled, true);
        assert.ok(repository.lastSavedComment);
        assert.strictEqual(repository.lastSavedComment.text, input.text);
    });

    test('should create comment without endLine (single line)', async () => {
        const input = {
            file: 'src/test.ts',
            line: 5,
            text: 'Single line comment',
            codeContext: 'const x = 1;'
        };

        const result = await useCase.execute(input);

        assert.strictEqual(result.line, 5);
        assert.strictEqual(result.endLine, undefined);
        assert.strictEqual(result.lineRange, '5');
    });

    test('should create comment with line range', async () => {
        const input = {
            file: 'src/test.ts',
            line: 5,
            endLine: 10,
            text: 'Range comment',
            codeContext: 'multiple lines'
        };

        const result = await useCase.execute(input);

        assert.strictEqual(result.lineRange, '5-10');
    });
});

suite('EditCommentUseCase', () => {
    let useCase: EditCommentUseCase;
    let repository: MockCommentRepository;

    setup(() => {
        repository = new MockCommentRepository();
        useCase = new EditCommentUseCase(repository);
    });

    test('should update comment text', async () => {
        const existingComment = Comment.create({
            file: 'test.ts',
            line: 1,
            text: 'Original text',
            codeContext: 'code'
        });
        repository.addComment(existingComment);

        const result = await useCase.execute({
            id: existingComment.id,
            text: 'Updated text'
        });

        assert.ok(result);
        assert.strictEqual(result.text, 'Updated text');
        assert.strictEqual(result.id, existingComment.id);
    });

    test('should return null for empty text', async () => {
        const existingComment = Comment.create({
            file: 'test.ts',
            line: 1,
            text: 'Original',
            codeContext: 'code'
        });
        repository.addComment(existingComment);

        const result = await useCase.execute({
            id: existingComment.id,
            text: ''
        });

        assert.strictEqual(result, null);
    });

    test('should return null for whitespace-only text', async () => {
        const existingComment = Comment.create({
            file: 'test.ts',
            line: 1,
            text: 'Original',
            codeContext: 'code'
        });
        repository.addComment(existingComment);

        const result = await useCase.execute({
            id: existingComment.id,
            text: '   \n\t  '
        });

        assert.strictEqual(result, null);
    });

    test('should trim whitespace from text', async () => {
        const existingComment = Comment.create({
            file: 'test.ts',
            line: 1,
            text: 'Original',
            codeContext: 'code'
        });
        repository.addComment(existingComment);

        const result = await useCase.execute({
            id: existingComment.id,
            text: '  Trimmed text  '
        });

        assert.ok(result);
        assert.strictEqual(result.text, 'Trimmed text');
    });

    test('should return null for non-existent comment', async () => {
        const result = await useCase.execute({
            id: 'non-existent-id',
            text: 'New text'
        });

        assert.strictEqual(result, null);
    });
});

suite('DeleteCommentUseCase', () => {
    let useCase: DeleteCommentUseCase;
    let repository: MockCommentRepository;

    setup(() => {
        repository = new MockCommentRepository();
        useCase = new DeleteCommentUseCase(repository);
    });

    test('should delete existing comment', async () => {
        const existingComment = Comment.create({
            file: 'test.ts',
            line: 1,
            text: 'To be deleted',
            codeContext: 'code'
        });
        repository.addComment(existingComment);

        const result = await useCase.execute({ id: existingComment.id });

        assert.strictEqual(result, true);

        const remaining = await repository.findAll();
        assert.strictEqual(remaining.length, 0);
    });

    test('should return false for non-existent comment', async () => {
        const result = await useCase.execute({ id: 'non-existent-id' });

        assert.strictEqual(result, false);
    });

    test('should only delete specified comment', async () => {
        // Use explicit IDs to avoid Date.now() collision
        const comment1 = new Comment({
            id: 'comment-1',
            file: 'test.ts',
            line: 1,
            text: 'Comment 1',
            codeContext: 'code',
            isSubmitted: false,
            timestamp: Date.now()
        });
        const comment2 = new Comment({
            id: 'comment-2',
            file: 'test.ts',
            line: 2,
            text: 'Comment 2',
            codeContext: 'code',
            isSubmitted: false,
            timestamp: Date.now()
        });
        repository.addComment(comment1);
        repository.addComment(comment2);

        await useCase.execute({ id: comment1.id });

        const remaining = await repository.findAll();
        assert.strictEqual(remaining.length, 1);
        assert.strictEqual(remaining[0].id, comment2.id);
    });
});
