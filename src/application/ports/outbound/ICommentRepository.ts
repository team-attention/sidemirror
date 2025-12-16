import { Comment } from '../../../domain/entities/Comment';

export interface ICommentRepository {
    save(comment: Comment): Promise<void>;
    findAll(): Promise<Comment[]>;
    findActive(): Promise<Comment[]>;
    findByThreadId(threadId: string): Promise<Comment[]>;
    findActiveByThreadId(threadId: string): Promise<Comment[]>;
    markAsSubmitted(ids: string[]): Promise<void>;
    update(id: string, text: string): Promise<Comment | null>;
    delete(id: string): Promise<boolean>;
    /**
     * Delete all comments associated with a thread.
     * Used during thread cleanup.
     *
     * @param threadId - Thread ID to delete comments for
     * @returns Number of comments deleted
     */
    deleteByThreadId(threadId: string): Promise<number>;
}
