import * as assert from 'assert';
import { TerminalStatusDetector } from '../../../domain/services/TerminalStatusDetector';

suite('TerminalStatusDetector', () => {
    let detector: TerminalStatusDetector;

    setup(() => {
        detector = new TerminalStatusDetector();
    });

    // Note: 'working' status is detected by activity (output received), not patterns
    // The detector only returns 'waiting', 'idle', or 'inactive'

    suite('detect - Claude patterns', () => {
        test('detects waiting status from selection menu', () => {
            const output = 'Enter to select';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'waiting');
        });

        test('detects waiting status from y/n prompt', () => {
            const output = 'Do you want to proceed? (y/n)';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'waiting');
        });

        test('detects waiting status from Y/n prompt', () => {
            const output = 'Confirm [Y/n]';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'waiting');
        });

        test('detects waiting status from Tab/Arrow navigation', () => {
            const output = 'Tab/Arrow keys to navigate';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'waiting');
        });

        test('detects idle status from prompt', () => {
            const output = '> ';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'idle');
        });

        test('returns inactive for unknown output', () => {
            const output = 'Some random text';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'inactive');
        });

        test('priority: waiting takes precedence over idle', () => {
            // This output contains both waiting and idle patterns
            const output = '> Do you want to proceed? (y/n)';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'waiting');
        });
    });

    suite('detect - strips ANSI codes', () => {
        test('strips ANSI cursor codes before matching', () => {
            const output = '\x1B[2K\x1B[1GEnter to select';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'waiting');
        });

        test('strips ANSI codes and detects idle', () => {
            const output = '\x1B[32m> \x1B[0m';
            const status = detector.detect('claude', output);
            assert.strictEqual(status, 'idle');
        });
    });

    suite('detect - Codex patterns', () => {
        test('detects idle status from welcome message for codex', () => {
            const output = 'To get started, describe a task';
            const status = detector.detect('codex', output);
            assert.strictEqual(status, 'idle');
        });

        test('detects idle status from header banner for codex', () => {
            const output = '>_ OpenAI Codex (v0.36.0)';
            const status = detector.detect('codex', output);
            assert.strictEqual(status, 'idle');
        });
    });

    suite('detect - Gemini patterns', () => {
        test('detects waiting status for gemini (y/n)', () => {
            const output = '(y/n)';
            const status = detector.detect('gemini', output);
            assert.strictEqual(status, 'waiting');
        });

        // Removed: Confirm pattern was too broad, caused false positives

        test('detects waiting status for Waiting for user', () => {
            const output = 'Waiting for user confirmation...';
            const status = detector.detect('gemini', output);
            assert.strictEqual(status, 'waiting');
        });

        test('detects idle status from Type your message for gemini', () => {
            const output = '> Type your message or @path/to/file';
            const status = detector.detect('gemini', output);
            assert.strictEqual(status, 'idle');
        });

        test('detects idle status from tips for gemini', () => {
            const output = 'Tips for getting started:';
            const status = detector.detect('gemini', output);
            assert.strictEqual(status, 'idle');
        });
    });

});
