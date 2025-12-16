import * as fs from 'fs';
import * as path from 'path';
import { Comment, CommentData } from '../../domain/entities/Comment';
import { ICommentRepository } from '../../application/ports/outbound/ICommentRepository';

export class JsonCommentRepository implements ICommentRepository {
    private comments: Comment[] = [];
    private storagePath: string | undefined;

    constructor(workspaceRoot: string | undefined) {
        if (workspaceRoot) {
            const vscodeDir = path.join(workspaceRoot, '.vscode');
            if (!fs.existsSync(vscodeDir)) {
                fs.mkdirSync(vscodeDir);
            }
            const legacyPath = path.join(vscodeDir, 'sidemirror-comments.json');
            const newPath = path.join(vscodeDir, 'code-squad-comments.json');

            this.storagePath = newPath;

            // Migrate legacy comment store if present
            if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
                this.loadCommentsFrom(legacyPath);
                this.persistComments();
            } else {
                this.loadCommentsFrom(newPath);
            }
        }
    }

    async save(comment: Comment): Promise<void> {
        this.comments.push(comment);
        this.persistComments();
    }

    async findAll(): Promise<Comment[]> {
        return [...this.comments];
    }

    async findActive(): Promise<Comment[]> {
        return this.comments.filter(c => !c.isSubmitted);
    }

    async findByThreadId(threadId: string): Promise<Comment[]> {
        return this.comments.filter(c => c.threadId === threadId);
    }

    async findActiveByThreadId(threadId: string): Promise<Comment[]> {
        return this.comments.filter(c => c.threadId === threadId && !c.isSubmitted);
    }

    async markAsSubmitted(ids: string[]): Promise<void> {
        const idSet = new Set(ids);
        this.comments.forEach(c => {
            if (idSet.has(c.id)) {
                c.markAsSubmitted();
            }
        });
        this.persistComments();
    }

    async update(id: string, text: string): Promise<Comment | null> {
        const index = this.comments.findIndex(c => c.id === id);
        if (index === -1) {
            return null;
        }

        const existing = this.comments[index];
        const updated = existing.withText(text);
        this.comments[index] = updated;
        this.persistComments();
        return updated;
    }

    async delete(id: string): Promise<boolean> {
        const index = this.comments.findIndex(c => c.id === id);
        if (index === -1) {
            return false;
        }

        this.comments.splice(index, 1);
        this.persistComments();
        return true;
    }

    async deleteByThreadId(threadId: string): Promise<number> {
        const initialCount = this.comments.length;
        this.comments = this.comments.filter(c => c.threadId !== threadId);
        const deletedCount = initialCount - this.comments.length;

        if (deletedCount > 0) {
            this.persistComments();
        }

        return deletedCount;
    }

    private loadCommentsFrom(filePath: string): void {
        if (!fs.existsSync(filePath)) {
            return;
        }

        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const parsed: CommentData[] = JSON.parse(data);
            this.comments = parsed.map(d => new Comment(d));
        } catch (e) {
            console.error('[Code Squad] Failed to load comments', e);
        }
    }

    private persistComments(): void {
        if (this.storagePath) {
            try {
                const data = this.comments.map(c => c.toData());
                fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
            } catch (e) {
                console.error('[Code Squad] Failed to save comments', e);
            }
        }
    }
}
