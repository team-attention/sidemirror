import { Comment } from '../../domain/entities/Comment';
import { AISession } from '../../domain/entities/AISession';
import { ICommentRepository } from '../ports/outbound/ICommentRepository';
import { ITerminalPort } from '../ports/outbound/ITerminalPort';
import { INotificationPort } from '../ports/outbound/INotificationPort';
import { IFileThreadMappingRepository } from '../ports/outbound/IFileThreadMappingRepository';
import { IThreadStateRepository } from '../ports/outbound/IThreadStateRepository';
import { ISubmitCommentsUseCase, SubmitCommentsResult } from '../ports/inbound/ISubmitCommentsUseCase';

export class SubmitCommentsUseCase implements ISubmitCommentsUseCase {
    constructor(
        private readonly commentRepository: ICommentRepository,
        private readonly terminalPort: ITerminalPort,
        private readonly notificationPort: INotificationPort,
        private readonly mappingRepository?: IFileThreadMappingRepository,
        private readonly threadStateRepository?: IThreadStateRepository
    ) {}

    async execute(session: AISession | undefined): Promise<SubmitCommentsResult | null> {
        if (!session) {
            this.notificationPort.showWarning('No active AI session detected (Claude Code, Codex, or Gemini)');
            return null;
        }

        const comments = await this.commentRepository.findActive();
        if (comments.length === 0) {
            this.notificationPort.showInfo('No new comments to send');
            return null;
        }

        const prompt = this.formatCommentsAsPrompt(comments);

        this.terminalPort.showTerminal(session.terminalId);
        this.terminalPort.sendText(session.terminalId, prompt + '\n');

        const ids = comments.map(c => c.id);
        await this.commentRepository.markAsSubmitted(ids);

        this.notificationPort.showInfo(
            `Sent ${comments.length} comments to ${session.displayName}`
        );

        return {
            submittedIds: ids,
            count: comments.length,
        };
    }

    private formatCommentsAsPrompt(comments: Comment[]): string {
        const grouped: { [key: string]: Comment[] } = {};
        comments.forEach(c => {
            if (!grouped[c.file]) grouped[c.file] = [];
            grouped[c.file].push(c);
        });

        const parts: string[] = [
            'Here are my comments on your work. Read content at specific line and respond based on the content and my comment. you must first locate and identify exact content before respond',
        ];

        for (const [file, fileComments] of Object.entries(grouped)) {
            parts.push(`\nFile: ${file}`);
            for (const c of fileComments) {
                parts.push(`Line ${c.lineRange}: ${c.text}`);
            }
        }

        return parts.join('\n');
    }

    async executeWithRouting(focusedSession: AISession | undefined): Promise<SubmitCommentsResult | null> {
        const comments = await this.commentRepository.findActive();
        if (comments.length === 0) {
            this.notificationPort.showInfo('No new comments to send');
            return null;
        }

        // Group comments by file
        const byFile = this.groupByFile(comments);

        // Group comments by owner thread
        const focusedThreadId = (focusedSession as { threadState?: { threadId: string } })?.threadState?.threadId;
        const focusedTerminalId = focusedSession?.terminalId;
        const byThread = await this.groupByOwnerThread(byFile, focusedThreadId, focusedTerminalId);

        // Check if we have any routable comments
        if (byThread.size === 0) {
            this.notificationPort.showWarning('No active thread to receive comments');
            return null;
        }

        // Send comments to each thread's terminal
        const threadNames: string[] = [];
        for (const [terminalId, threadComments] of byThread) {
            const prompt = this.formatCommentsAsPrompt(threadComments);
            this.terminalPort.showTerminal(terminalId);
            this.terminalPort.sendText(terminalId, prompt + '\n');

            // Get thread name for notification
            const threadId = await this.getThreadIdForTerminal(terminalId, threadComments);
            if (threadId && this.threadStateRepository) {
                const threadState = await this.threadStateRepository.findById(threadId);
                if (threadState) {
                    threadNames.push(threadState.name);
                }
            }
        }

        // Mark all comments as submitted
        const ids = comments.map(c => c.id);
        await this.commentRepository.markAsSubmitted(ids);

        // Build notification message
        const message = this.buildNotificationMessage(comments.length, threadNames);
        this.notificationPort.showInfo(message);

        return {
            submittedIds: ids,
            count: comments.length,
        };
    }

    private groupByFile(comments: Comment[]): Map<string, Comment[]> {
        const byFile = new Map<string, Comment[]>();
        for (const comment of comments) {
            const existing = byFile.get(comment.file) || [];
            existing.push(comment);
            byFile.set(comment.file, existing);
        }
        return byFile;
    }

    private async groupByOwnerThread(
        byFile: Map<string, Comment[]>,
        focusedThreadId?: string,
        focusedTerminalId?: string
    ): Promise<Map<string, Comment[]>> {
        const byThread = new Map<string, Comment[]>();

        for (const [filePath, fileComments] of byFile) {
            let terminalId: string | undefined;

            // Try to find owner thread from mapping
            if (this.mappingRepository) {
                const mapping = await this.mappingRepository.findByFilePath(filePath);
                if (mapping && this.threadStateRepository) {
                    const threadState = await this.threadStateRepository.findById(mapping.threadId);
                    if (threadState) {
                        terminalId = threadState.terminalId;
                    }
                }
            }

            // Fallback to focused session's terminal
            if (!terminalId && focusedTerminalId) {
                terminalId = focusedTerminalId;
            }

            // Skip if no target terminal
            if (!terminalId) {
                continue;
            }

            const existing = byThread.get(terminalId) || [];
            existing.push(...fileComments);
            byThread.set(terminalId, existing);
        }

        return byThread;
    }

    private async getThreadIdForTerminal(terminalId: string, comments: Comment[]): Promise<string | undefined> {
        // First try to get from mapping
        if (this.mappingRepository && comments.length > 0) {
            const mapping = await this.mappingRepository.findByFilePath(comments[0].file);
            if (mapping) {
                return mapping.threadId;
            }
        }
        return undefined;
    }

    private buildNotificationMessage(count: number, threadNames: string[]): string {
        if (threadNames.length === 0) {
            return `Sent ${count} comments`;
        }
        if (threadNames.length === 1) {
            return `Sent ${count} comments to ${threadNames[0]}`;
        }
        return `Sent ${count} comments to ${threadNames.join(', ')}`;
    }
}
