import * as assert from 'assert';
import { SubmitCommentsUseCase } from '../../../application/useCases/SubmitCommentsUseCase';
import { ICommentRepository } from '../../../application/ports/outbound/ICommentRepository';
import { ITerminalPort } from '../../../application/ports/outbound/ITerminalPort';
import { INotificationPort } from '../../../application/ports/outbound/INotificationPort';
import { IFileThreadMappingRepository } from '../../../application/ports/outbound/IFileThreadMappingRepository';
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';
import { Comment } from '../../../domain/entities/Comment';
import { FileThreadMapping } from '../../../domain/entities/FileThreadMapping';
import { ThreadState } from '../../../domain/entities/ThreadState';
import { AISession } from '../../../domain/entities/AISession';

class MockCommentRepository implements ICommentRepository {
    private comments: Comment[] = [];

    setComments(comments: Comment[]): void {
        this.comments = comments;
    }

    async save(_comment: Comment): Promise<void> {}
    async findAll(): Promise<Comment[]> { return this.comments; }
    async findActive(): Promise<Comment[]> { return this.comments.filter(c => !c.isSubmitted); }
    async findByThreadId(_threadId: string): Promise<Comment[]> { return []; }
    async findActiveByThreadId(_threadId: string): Promise<Comment[]> { return []; }
    async markAsSubmitted(_ids: string[]): Promise<void> {}
    async update(_id: string, _text: string): Promise<Comment | null> { return null; }
    async delete(_id: string): Promise<boolean> { return false; }
    async deleteByThreadId(_threadId: string): Promise<number> { return 0; }
}

class MockTerminalPort implements ITerminalPort {
    public sentMessages: { terminalId: string; text: string }[] = [];

    initialize(): void {}
    sendText(terminalId: string, text: string): void {
        this.sentMessages.push({ terminalId, text });
    }
    showTerminal(_terminalId: string): void {}
    async createTerminal(_name: string, _cwd?: string): Promise<string> { return 'mock-terminal'; }
    onTerminalActivity(_callback: (terminalId: string, hasActivity: boolean) => void): void {}
    onTerminalOutput(_callback: (terminalId: string, data: string) => void): void {}
    onCommandExecuted(_callback: (terminalId: string, command: string) => void): void {}
    onCommandEnded(_callback: (terminalId: string, command: string) => void): void {}
    closeTerminal(_terminalId: string): void {}
    updateTerminalName(_terminalId: string, _newName: string): void {}
    getDisplayName(_terminalId: string): string | undefined { return undefined; }
}

class MockNotificationPort implements INotificationPort {
    public infoMessages: string[] = [];
    public warningMessages: string[] = [];

    showInfo(message: string): void {
        this.infoMessages.push(message);
    }
    showWarning(message: string): void {
        this.warningMessages.push(message);
    }
    showError(_message: string): void {}
    showSystemNotification(_title: string, _message: string, _onClick?: () => void): void {}
}

class MockFileThreadMappingRepository implements IFileThreadMappingRepository {
    private mappings = new Map<string, FileThreadMapping>();

    setMapping(filePath: string, threadId: string): void {
        this.mappings.set(filePath, FileThreadMapping.create(filePath, threadId));
    }

    async save(_mapping: FileThreadMapping): Promise<void> {}
    async findByFilePath(filePath: string): Promise<FileThreadMapping | null> {
        return this.mappings.get(filePath) ?? null;
    }
    async findByThreadId(_threadId: string): Promise<FileThreadMapping[]> { return []; }
    async findAll(): Promise<FileThreadMapping[]> { return []; }
    async delete(_filePath: string): Promise<boolean> { return false; }
    async clear(): Promise<void> {}
}

class MockThreadStateRepository implements IThreadStateRepository {
    private threads = new Map<string, ThreadState>();

    setThread(threadId: string, name: string): void {
        const thread = ThreadState.fromData({
            threadId,
            name,
            terminalId: `terminal-${threadId}`,
            workingDir: '/workspace',
            whitelistPatterns: [],
            createdAt: Date.now()
        });
        this.threads.set(threadId, thread);
    }

    async save(_state: ThreadState): Promise<void> {}
    async findAll(): Promise<ThreadState[]> { return Array.from(this.threads.values()); }
    async findById(threadId: string): Promise<ThreadState | null> {
        return this.threads.get(threadId) ?? null;
    }
    async findByTerminalId(_terminalId: string): Promise<ThreadState | null> { return null; }
    async delete(_threadId: string): Promise<boolean> { return false; }
    async updateWhitelist(_threadId: string, _patterns: string[]): Promise<void> {}
}

function createComment(id: string, filePath: string, text: string): Comment {
    return new Comment({
        id,
        file: filePath,
        line: 10,
        text,
        codeContext: 'code',
        isSubmitted: false,
        timestamp: Date.now()
    });
}

function createSession(terminalId: string, threadId?: string, threadName?: string): AISession & { threadState?: ThreadState } {
    const session = AISession.create('claude', terminalId) as AISession & { threadState?: ThreadState };
    if (threadId && threadName) {
        const threadState = ThreadState.fromData({
            threadId,
            name: threadName,
            terminalId,
            workingDir: '/workspace',
            whitelistPatterns: [],
            createdAt: Date.now()
        });
        session.threadState = threadState;
    }
    return session;
}

suite('SubmitCommentsUseCase - Routing', () => {
    let useCase: SubmitCommentsUseCase;
    let commentRepo: MockCommentRepository;
    let terminalPort: MockTerminalPort;
    let notificationPort: MockNotificationPort;
    let mappingRepo: MockFileThreadMappingRepository;
    let threadRepo: MockThreadStateRepository;

    setup(() => {
        commentRepo = new MockCommentRepository();
        terminalPort = new MockTerminalPort();
        notificationPort = new MockNotificationPort();
        mappingRepo = new MockFileThreadMappingRepository();
        threadRepo = new MockThreadStateRepository();
        useCase = new SubmitCommentsUseCase(
            commentRepo,
            terminalPort,
            notificationPort,
            mappingRepo,
            threadRepo
        );
    });

    suite('TS3: Multi-Thread Routing', () => {
        test('should route comments to their owner threads', async () => {
            // Arrange
            const comments = [
                createComment('c1', 'src/app.ts', 'Fix this'),
                createComment('c2', 'src/util.ts', 'Refactor')
            ];
            commentRepo.setComments(comments);

            mappingRepo.setMapping('src/app.ts', 'tid-a');
            mappingRepo.setMapping('src/util.ts', 'tid-b');

            threadRepo.setThread('tid-a', 'Thread A');
            threadRepo.setThread('tid-b', 'Thread B');

            const focusedSession = createSession('terminal-1', 'tid-focused', 'Focused');

            // Act
            await useCase.executeWithRouting(focusedSession);

            // Assert
            assert.strictEqual(terminalPort.sentMessages.length, 2);

            const threadAMessage = terminalPort.sentMessages.find(m => m.terminalId === 'terminal-tid-a');
            assert.ok(threadAMessage, 'Should have message for Thread A');
            assert.ok(threadAMessage.text.includes('Fix this'), 'Thread A should receive app.ts comment');

            const threadBMessage = terminalPort.sentMessages.find(m => m.terminalId === 'terminal-tid-b');
            assert.ok(threadBMessage, 'Should have message for Thread B');
            assert.ok(threadBMessage.text.includes('Refactor'), 'Thread B should receive util.ts comment');

            // Check notification mentions both threads
            assert.strictEqual(notificationPort.infoMessages.length, 1);
            const notification = notificationPort.infoMessages[0];
            assert.ok(notification.includes('Thread A') || notification.includes('Thread B'),
                'Notification should mention thread names');
        });
    });

    suite('TS4: Fallback to Focused Thread', () => {
        test('should use focused thread when no mapping exists', async () => {
            // Arrange
            const comments = [
                createComment('c1', 'src/new.ts', 'New file')
            ];
            commentRepo.setComments(comments);
            // No mapping for src/new.ts

            const focusedSession = createSession('terminal-focused', 'tid-focused', 'Focused');

            // Act
            await useCase.executeWithRouting(focusedSession);

            // Assert
            assert.strictEqual(terminalPort.sentMessages.length, 1);
            assert.strictEqual(terminalPort.sentMessages[0].terminalId, 'terminal-focused');
            assert.ok(terminalPort.sentMessages[0].text.includes('New file'));
        });
    });

    suite('TS5: No Target Thread', () => {
        test('should show warning when no mapping and no focused session', async () => {
            // Arrange
            const comments = [
                createComment('c1', 'src/new.ts', 'Review')
            ];
            commentRepo.setComments(comments);
            // No mapping for src/new.ts

            // Act
            const result = await useCase.executeWithRouting(undefined);

            // Assert
            assert.strictEqual(result, null);
            assert.strictEqual(notificationPort.warningMessages.length, 1);
            assert.ok(notificationPort.warningMessages[0].includes('No active thread'));
        });
    });

    suite('Edge Cases', () => {
        test('should return null when no comments', async () => {
            // Arrange
            commentRepo.setComments([]);
            const focusedSession = createSession('terminal-1', 'tid-1', 'Thread 1');

            // Act
            const result = await useCase.executeWithRouting(focusedSession);

            // Assert
            assert.strictEqual(result, null);
        });

        test('should group multiple comments for same file', async () => {
            // Arrange
            const comments = [
                createComment('c1', 'src/app.ts', 'Fix this'),
                createComment('c2', 'src/app.ts', 'Also this')
            ];
            commentRepo.setComments(comments);
            mappingRepo.setMapping('src/app.ts', 'tid-a');
            threadRepo.setThread('tid-a', 'Thread A');

            const focusedSession = createSession('terminal-1');

            // Act
            await useCase.executeWithRouting(focusedSession);

            // Assert
            assert.strictEqual(terminalPort.sentMessages.length, 1);
            const message = terminalPort.sentMessages[0];
            assert.ok(message.text.includes('Fix this'));
            assert.ok(message.text.includes('Also this'));
        });
    });
});
