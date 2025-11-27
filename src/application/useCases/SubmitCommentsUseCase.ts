import { Comment } from '../../domain/entities/Comment';
import { AISession } from '../../domain/entities/AISession';
import { ICommentRepository } from '../../domain/repositories/ICommentRepository';
import { ITerminalPort } from '../ports/ITerminalPort';
import { INotificationPort } from '../ports/INotificationPort';

export class SubmitCommentsUseCase {
    constructor(
        private readonly commentRepository: ICommentRepository,
        private readonly terminalPort: ITerminalPort,
        private readonly notificationPort: INotificationPort
    ) {}

    async execute(session: AISession | undefined): Promise<void> {
        if (!session) {
            this.notificationPort.showWarning('No active AI session detected (Claude Code, Codex, or Gemini)');
            return;
        }

        const comments = await this.commentRepository.findActive();
        if (comments.length === 0) {
            this.notificationPort.showInfo('No new comments to send');
            return;
        }

        const prompt = this.formatCommentsAsPrompt(comments);

        this.terminalPort.showTerminal(session.terminalId);
        this.terminalPort.sendText(session.terminalId, prompt + '\n');

        const ids = comments.map(c => c.id);
        await this.commentRepository.markAsSubmitted(ids);

        this.notificationPort.showInfo(
            `Sent ${comments.length} comments to ${session.displayName}`
        );
    }

    private formatCommentsAsPrompt(comments: Comment[]): string {
        const grouped: { [key: string]: Comment[] } = {};
        comments.forEach(c => {
            if (!grouped[c.file]) grouped[c.file] = [];
            grouped[c.file].push(c);
        });

        const parts: string[] = ['Here are my comments and questions based on the changes. Please review and respond:'];

        for (const [file, fileComments] of Object.entries(grouped)) {
            parts.push(`\nFile: ${file}`);
            for (const c of fileComments) {
                parts.push(`Line ${c.lineRange}: ${c.text}`);
            }
        }

        return parts.join('\n');
    }
}
