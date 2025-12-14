import * as assert from 'assert';
import { DetectThreadStatusUseCase } from '../../../application/useCases/DetectThreadStatusUseCase';
import { TerminalStatusDetector } from '../../../domain/services/TerminalStatusDetector';
import { AgentStatus } from '../../../domain/entities/AISession';

suite('DetectThreadStatusUseCase', () => {
    let useCase: DetectThreadStatusUseCase;
    let detector: TerminalStatusDetector;

    setup(() => {
        detector = new TerminalStatusDetector();
        useCase = new DetectThreadStatusUseCase(detector);
    });

    teardown(() => {
        useCase.clear('terminal-1');
    });

    suite('processOutput - activity-based detection', () => {
        test('immediately sets to working when output received', (done) => {
            const statuses: AgentStatus[] = [];
            useCase.onStatusChange((_terminalId, status) => {
                statuses.push(status);
            });

            useCase.processOutput('terminal-1', 'claude', 'Some output');

            // Should immediately notify working status
            assert.strictEqual(statuses.length, 1);
            assert.strictEqual(statuses[0], 'working');
            assert.strictEqual(useCase.getStatus('terminal-1'), 'working');
            done();
        });

        test('transitions to idle after debounce when prompt detected', (done) => {
            const statuses: AgentStatus[] = [];
            useCase.onStatusChange((_terminalId, status) => {
                statuses.push(status);
            });

            // Send output with prompt at end
            useCase.processOutput('terminal-1', 'claude', '> ');

            // Wait for debounce (500ms + buffer)
            setTimeout(() => {
                assert.strictEqual(statuses.length, 2);
                assert.strictEqual(statuses[0], 'working');  // Immediate
                assert.strictEqual(statuses[1], 'idle');     // After debounce
                assert.strictEqual(useCase.getStatus('terminal-1'), 'idle');
                done();
            }, 600);
        });

        test('stays working if output continues', (done) => {
            const statuses: AgentStatus[] = [];
            useCase.onStatusChange((_terminalId, status) => {
                statuses.push(status);
            });

            // Send rapid outputs
            useCase.processOutput('terminal-1', 'claude', 'Reading...');
            setTimeout(() => {
                useCase.processOutput('terminal-1', 'claude', 'Writing...');
            }, 100);
            setTimeout(() => {
                useCase.processOutput('terminal-1', 'claude', 'Done');
            }, 200);

            // Wait a bit and check status
            setTimeout(() => {
                // Should only have one working notification (initial)
                assert.strictEqual(statuses.length, 1);
                assert.strictEqual(statuses[0], 'working');
                done();
            }, 350);
        });

        test('detects waiting status from y/n prompt', (done) => {
            const statuses: AgentStatus[] = [];
            useCase.onStatusChange((_terminalId, status) => {
                statuses.push(status);
            });

            useCase.processOutput('terminal-1', 'claude', 'Do you want to proceed? (y/n)');

            setTimeout(() => {
                assert.strictEqual(statuses.length, 2);
                assert.strictEqual(statuses[0], 'working');
                assert.strictEqual(statuses[1], 'waiting');
                done();
            }, 600);
        });
    });

    suite('getStatus', () => {
        test('returns inactive for unknown terminal', () => {
            const status = useCase.getStatus('unknown-terminal');
            assert.strictEqual(status, 'inactive');
        });
    });

    suite('onStatusChange', () => {
        test('notifies multiple callbacks', (done) => {
            let count = 0;

            useCase.onStatusChange(() => count++);
            useCase.onStatusChange(() => count++);

            useCase.processOutput('terminal-1', 'claude', 'Some output');

            // Should immediately notify both callbacks
            assert.strictEqual(count, 2);
            done();
        });
    });

    suite('clear', () => {
        test('removes terminal state', (done) => {
            useCase.processOutput('terminal-1', 'claude', 'Some output');

            assert.strictEqual(useCase.getStatus('terminal-1'), 'working');

            useCase.clear('terminal-1');

            assert.strictEqual(useCase.getStatus('terminal-1'), 'inactive');
            done();
        });

        test('clears pending debounce timer', (done) => {
            let changeCount = 0;
            useCase.onStatusChange(() => changeCount++);

            useCase.processOutput('terminal-1', 'claude', '> ');

            // Clear before debounce fires
            useCase.clear('terminal-1');

            setTimeout(() => {
                // Only the initial 'working' notification, no 'idle' after clear
                assert.strictEqual(changeCount, 1);
                done();
            }, 600);
        });
    });

    suite('buffer management', () => {
        test('keeps only last 10 lines in buffer', (done) => {
            // Send 15 lines of output
            for (let i = 0; i < 15; i++) {
                useCase.processOutput('terminal-1', 'claude', `Line ${i}`);
            }

            // Then send a prompt that should be detected
            useCase.processOutput('terminal-1', 'claude', '> ');

            setTimeout(() => {
                assert.strictEqual(useCase.getStatus('terminal-1'), 'idle');
                done();
            }, 600);
        });
    });
});
