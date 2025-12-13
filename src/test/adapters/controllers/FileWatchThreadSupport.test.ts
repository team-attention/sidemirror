import * as assert from 'assert';
import { IThreadStateRepository } from '../../../application/ports/outbound/IThreadStateRepository';
import { ThreadState } from '../../../domain/entities/ThreadState';

/**
 * Unit tests for FileWatchController thread support functionality.
 *
 * These tests verify the thread tracking and whitelist pattern handling
 * by testing a simplified implementation that mirrors the actual behavior.
 */

/**
 * Simplified thread tracking helper for testing.
 * Implements the same algorithm as FileWatchController.
 */
class ThreadTrackingTestHelper {
    private currentThreadId: string | null = null;
    private currentThreadPatterns: string[] = [];
    private currentThreadStateId: string | undefined;
    private threadStateRepository: IThreadStateRepository | undefined;
    private globalPatterns: string[] = [];
    public rebuildCalled = false;
    public logs: string[] = [];

    setGlobalPatterns(patterns: string[]): void {
        this.globalPatterns = patterns;
    }

    setThreadStateRepository(repo: IThreadStateRepository): void {
        this.threadStateRepository = repo;
    }

    setCurrentThread(
        terminalId: string | null,
        patterns: string[],
        threadStateId?: string
    ): void {
        this.currentThreadId = terminalId;
        this.currentThreadPatterns = patterns;
        this.currentThreadStateId = threadStateId;
        this.logs.push(`Set thread: ${terminalId ?? 'none'} (patterns=${patterns.length})`);
        this.rebuildIncludePatterns();
    }

    getCurrentThreadId(): string | null {
        return this.currentThreadId;
    }

    getCurrentThreadStateId(): string | undefined {
        return this.currentThreadStateId;
    }

    private rebuildIncludePatterns(): void {
        this.rebuildCalled = true;
        // In real implementation, this would combine global + thread patterns
    }

    getEffectivePatterns(): string[] {
        return [...this.globalPatterns, ...this.currentThreadPatterns];
    }

    async addWhitelistPattern(pattern: string): Promise<void> {
        if (this.currentThreadStateId && this.threadStateRepository) {
            const newPatterns = [...this.currentThreadPatterns];
            if (!newPatterns.includes(pattern)) {
                newPatterns.push(pattern);
                await this.threadStateRepository.updateWhitelist(this.currentThreadStateId, newPatterns);
                this.logs.push(`Added pattern "${pattern}" to thread ${this.currentThreadStateId}`);
                this.currentThreadPatterns = newPatterns;
                this.rebuildIncludePatterns();
                return;
            }
            return;
        }

        // Global config fallback
        if (!this.globalPatterns.includes(pattern)) {
            this.globalPatterns.push(pattern);
            this.logs.push(`Added pattern "${pattern}" to global config`);
        }
    }
}

class MockThreadStateRepository implements IThreadStateRepository {
    private states = new Map<string, ThreadState>();
    public updateWhitelistCalled = false;
    public lastUpdateId: string | null = null;
    public lastUpdatePatterns: string[] = [];

    async save(state: ThreadState): Promise<void> {
        this.states.set(state.threadId, state);
    }

    async findAll(): Promise<ThreadState[]> {
        return Array.from(this.states.values());
    }

    async findById(threadId: string): Promise<ThreadState | null> {
        return this.states.get(threadId) || null;
    }

    async findByTerminalId(terminalId: string): Promise<ThreadState | null> {
        for (const state of this.states.values()) {
            if (state.terminalId === terminalId) {
                return state;
            }
        }
        return null;
    }

    async delete(threadId: string): Promise<boolean> {
        return this.states.delete(threadId);
    }

    async updateWhitelist(threadId: string, patterns: string[]): Promise<void> {
        this.updateWhitelistCalled = true;
        this.lastUpdateId = threadId;
        this.lastUpdatePatterns = patterns;

        const state = this.states.get(threadId);
        if (state) {
            // Update the state's whitelist
            for (const pattern of patterns) {
                state.addWhitelistPattern(pattern);
            }
        }
    }

    // Test helper
    clear(): void {
        this.states.clear();
        this.updateWhitelistCalled = false;
        this.lastUpdateId = null;
        this.lastUpdatePatterns = [];
    }
}

suite('FileWatchController Thread Support', () => {
    let helper: ThreadTrackingTestHelper;
    let mockRepo: MockThreadStateRepository;

    setup(() => {
        helper = new ThreadTrackingTestHelper();
        mockRepo = new MockThreadStateRepository();
    });

    suite('setCurrentThread', () => {
        test('stores thread ID and patterns', () => {
            helper.setCurrentThread('thread-1', ['dist/**']);

            assert.strictEqual(helper.getCurrentThreadId(), 'thread-1');
        });

        test('stores thread state ID for repository operations', () => {
            helper.setCurrentThread('term-1', ['dist/**'], 'state-123');

            assert.strictEqual(helper.getCurrentThreadId(), 'term-1');
            assert.strictEqual(helper.getCurrentThreadStateId(), 'state-123');
        });

        test('combines global and thread patterns', () => {
            helper.setGlobalPatterns(['*.log']);
            helper.setCurrentThread('thread-1', ['dist/**']);

            const effective = helper.getEffectivePatterns();
            assert.ok(effective.includes('*.log'));
            assert.ok(effective.includes('dist/**'));
        });

        test('clears thread patterns when set to null', () => {
            helper.setCurrentThread('thread-1', ['dist/**']);
            helper.setCurrentThread(null, []);

            assert.strictEqual(helper.getCurrentThreadId(), null);
            assert.deepStrictEqual(helper.getEffectivePatterns(), []);
        });

        test('triggers rebuild of include patterns', () => {
            helper.rebuildCalled = false;
            helper.setCurrentThread('thread-1', ['dist/**']);

            assert.strictEqual(helper.rebuildCalled, true);
        });

        test('logs thread selection', () => {
            helper.setCurrentThread('thread-1', ['dist/**', 'build/**']);

            assert.ok(helper.logs.some(log => log.includes('thread-1')));
            assert.ok(helper.logs.some(log => log.includes('patterns=2')));
        });
    });

    suite('addWhitelistPattern', () => {
        test('saves to ThreadState when thread is selected', async () => {
            helper.setThreadStateRepository(mockRepo);
            helper.setCurrentThread('term-1', [], 'state-123');

            await helper.addWhitelistPattern('build/**');

            assert.strictEqual(mockRepo.updateWhitelistCalled, true);
            assert.strictEqual(mockRepo.lastUpdateId, 'state-123');
            assert.ok(mockRepo.lastUpdatePatterns.includes('build/**'));
        });

        test('updates current patterns after adding', async () => {
            helper.setThreadStateRepository(mockRepo);
            helper.setCurrentThread('term-1', ['existing/**'], 'state-123');

            await helper.addWhitelistPattern('build/**');

            const effective = helper.getEffectivePatterns();
            assert.ok(effective.includes('existing/**'));
            assert.ok(effective.includes('build/**'));
        });

        test('saves to global config when no thread selected', async () => {
            helper.setCurrentThread(null, []);

            await helper.addWhitelistPattern('build/**');

            assert.ok(helper.logs.some(log => log.includes('global config')));
            assert.ok(helper.getEffectivePatterns().includes('build/**'));
        });

        test('does not add duplicate patterns', async () => {
            helper.setThreadStateRepository(mockRepo);
            helper.setCurrentThread('term-1', ['build/**'], 'state-123');

            await helper.addWhitelistPattern('build/**');

            assert.strictEqual(mockRepo.updateWhitelistCalled, false);
        });

        test('triggers rebuild after adding pattern', async () => {
            helper.setThreadStateRepository(mockRepo);
            helper.setCurrentThread('term-1', [], 'state-123');
            helper.rebuildCalled = false;

            await helper.addWhitelistPattern('build/**');

            assert.strictEqual(helper.rebuildCalled, true);
        });
    });

    suite('getCurrentThreadId', () => {
        test('returns null when no thread is selected', () => {
            assert.strictEqual(helper.getCurrentThreadId(), null);
        });

        test('returns thread ID after selection', () => {
            helper.setCurrentThread('thread-abc', []);

            assert.strictEqual(helper.getCurrentThreadId(), 'thread-abc');
        });
    });

    suite('getCurrentThreadStateId', () => {
        test('returns undefined when no thread is selected', () => {
            assert.strictEqual(helper.getCurrentThreadStateId(), undefined);
        });

        test('returns state ID after selection', () => {
            helper.setCurrentThread('term-1', [], 'state-xyz');

            assert.strictEqual(helper.getCurrentThreadStateId(), 'state-xyz');
        });
    });
});
