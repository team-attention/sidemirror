import * as assert from 'assert';
import { PanelStateManager } from '../../../application/services/PanelStateManager';
import { CommentInfo } from '../../../application/ports/outbound/PanelState';

/**
 * Unit tests for PanelStateManager.
 *
 * Tests the setComments method added for thread state integration.
 */

/** Helper to create a test comment with defaults */
function createTestComment(overrides: Partial<CommentInfo> & { id: string; text: string }): CommentInfo {
    return {
        file: 'test.ts',
        line: 1,
        isSubmitted: false,
        codeContext: 'test code',
        timestamp: Date.now(),
        ...overrides
    };
}

suite('PanelStateManager', () => {
    let manager: PanelStateManager;
    let renderCallCount: number;

    setup(() => {
        manager = new PanelStateManager();
        renderCallCount = 0;
        manager.setRenderCallback(() => {
            renderCallCount++;
        });
        // Reset count after initial render from setRenderCallback
        renderCallCount = 0;
    });

    suite('setComments', () => {
        test('replaces all comments with new array', () => {
            // Add initial comment
            manager.addComment(createTestComment({
                id: '1',
                file: 'old.ts',
                text: 'Old comment'
            }));

            // Replace with new comments
            const newComments: CommentInfo[] = [
                createTestComment({
                    id: '2',
                    file: 'new.ts',
                    line: 10,
                    text: 'New comment'
                })
            ];

            manager.setComments(newComments);

            const state = manager.getState();
            assert.strictEqual(state.comments.length, 1);
            assert.strictEqual(state.comments[0].id, '2');
            assert.strictEqual(state.comments[0].text, 'New comment');
        });

        test('triggers render callback', () => {
            manager.setComments([]);

            assert.strictEqual(renderCallCount, 1);
        });

        test('sets empty array correctly', () => {
            // Add some comments first
            manager.addComment(createTestComment({ id: '1', text: 'Comment 1' }));
            manager.addComment(createTestComment({ id: '2', line: 2, text: 'Comment 2' }));

            manager.setComments([]);

            const state = manager.getState();
            assert.strictEqual(state.comments.length, 0);
        });

        test('creates copy of input array to avoid mutation', () => {
            const inputComments: CommentInfo[] = [
                createTestComment({ id: '1', text: 'Comment' })
            ];

            manager.setComments(inputComments);

            // Mutate input array
            inputComments.push(createTestComment({ id: '2', file: 'test2.ts', text: 'Comment 2' }));

            // State should not be affected
            const state = manager.getState();
            assert.strictEqual(state.comments.length, 1);
        });

        test('preserves all comment properties', () => {
            const timestamp = Date.now();
            const comments: CommentInfo[] = [
                {
                    id: 'comment-123',
                    file: 'src/components/Button.tsx',
                    line: 10,
                    endLine: 20,
                    text: 'Review this logic',
                    isSubmitted: true,
                    codeContext: 'function onClick() {}',
                    timestamp
                }
            ];

            manager.setComments(comments);

            const state = manager.getState();
            const comment = state.comments[0];
            assert.strictEqual(comment.id, 'comment-123');
            assert.strictEqual(comment.file, 'src/components/Button.tsx');
            assert.strictEqual(comment.line, 10);
            assert.strictEqual(comment.endLine, 20);
            assert.strictEqual(comment.text, 'Review this logic');
            assert.strictEqual(comment.isSubmitted, true);
            assert.strictEqual(comment.codeContext, 'function onClick() {}');
            assert.strictEqual(comment.timestamp, timestamp);
        });

        test('handles multiple comments', () => {
            const comments: CommentInfo[] = [
                createTestComment({ id: '1', file: 'a.ts', text: 'Comment A' }),
                createTestComment({ id: '2', file: 'b.ts', line: 2, text: 'Comment B' }),
                createTestComment({ id: '3', file: 'c.ts', line: 3, text: 'Comment C', isSubmitted: true })
            ];

            manager.setComments(comments);

            const state = manager.getState();
            assert.strictEqual(state.comments.length, 3);
            assert.strictEqual(state.comments[0].text, 'Comment A');
            assert.strictEqual(state.comments[1].text, 'Comment B');
            assert.strictEqual(state.comments[2].text, 'Comment C');
        });

        test('can be called multiple times', () => {
            manager.setComments([
                createTestComment({ id: '1', file: 'a.ts', text: 'First' })
            ]);

            manager.setComments([
                createTestComment({ id: '2', file: 'b.ts', text: 'Second' })
            ]);

            manager.setComments([
                createTestComment({ id: '3', file: 'c.ts', text: 'Third' })
            ]);

            const state = manager.getState();
            assert.strictEqual(state.comments.length, 1);
            assert.strictEqual(state.comments[0].text, 'Third');
            assert.strictEqual(renderCallCount, 3);
        });
    });

    suite('setComments integration with thread switching', () => {
        test('simulates thread switch comment filtering', () => {
            // Simulate: Initially showing all comments
            manager.setComments([
                createTestComment({ id: '1', file: 'a.ts', text: 'Thread A' }),
                createTestComment({ id: '2', file: 'b.ts', text: 'Thread B' }),
                createTestComment({ id: '3', file: 'c.ts', text: 'Legacy' })
            ]);

            assert.strictEqual(manager.getState().comments.length, 3);

            // Simulate: Switch to Thread A (only Thread A + legacy comments)
            manager.setComments([
                createTestComment({ id: '1', file: 'a.ts', text: 'Thread A' }),
                createTestComment({ id: '3', file: 'c.ts', text: 'Legacy' })
            ]);

            const state = manager.getState();
            assert.strictEqual(state.comments.length, 2);
            assert.ok(state.comments.some(c => c.text === 'Thread A'));
            assert.ok(state.comments.some(c => c.text === 'Legacy'));
            assert.ok(!state.comments.some(c => c.text === 'Thread B'));
        });
    });
});
