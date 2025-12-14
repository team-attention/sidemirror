import { AgentStatus, AIType } from '../entities/AISession';

interface StatusPattern {
    status: AgentStatus;
    patterns: RegExp[];
    priority: number;
}

export interface ITerminalStatusDetector {
    detect(aiType: AIType, output: string): AgentStatus;
    detectFromBuffer(aiType: AIType, lines: string[]): AgentStatus;
}

// Activity-based detection: 'working' is detected by output activity, not patterns
// Only 'waiting' and 'idle' patterns are needed

const CLAUDE_PATTERNS: StatusPattern[] = [
    {
        status: 'waiting',
        priority: 2,
        patterns: [
            /Enter to select/,
            /\(y\/n\)/i,
            /\[Y\/n\]/i,
            /\[y\/N\]/i,
            /Tab\/Arrow keys/,
            /Press Enter to continue/,
            /Do you want to proceed\?/i,
        ],
    },
    {
        status: 'idle',
        priority: 1,
        patterns: [
            // Claude Code prompt: "> " at end of line
            /^>\s*$/m,
            // Vim modes (when in editor)
            /-- INSERT --/,
            /-- NORMAL --/,
        ],
    },
];

const CODEX_PATTERNS: StatusPattern[] = [
    {
        status: 'waiting',
        priority: 2,
        patterns: [
            /\(y\/n\)/i,
            /\[Y\/n\]/i,
            // Removed broad /Confirm/i - causes false positives in AI responses
        ],
    },
    {
        status: 'idle',
        priority: 1,
        patterns: [
            // Codex input prompt (cursor character after pipe)
            /[│|]\s*[▌▍▎▏█⎸▏]/,      // "| ▌" input cursor prompt
            // Codex prompt hints (various arrow chars: ⮐ ⏎ ↵ ← ⇦)
            /[⮐⏎↵←⇦]\s*send/,        // "⮐ send" hint at bottom of Codex prompt
            /\^J\s*newline/,          // "^J newline" hint
            /\^C\s*quit/,             // "^C quit" hint
            /To get started/,         // Welcome message
            /OpenAI Codex/,           // Header banner
        ],
    },
];

const GEMINI_PATTERNS: StatusPattern[] = [
    {
        status: 'waiting',
        priority: 2,
        patterns: [
            /\(y\/n\)/i,
            /\[Y\/n\]/i,
            // Removed broad /Confirm/i - causes false positives in AI responses
            /Waiting for user/i,           // "Waiting for user confirmation..."
            /Allow execution/i,             // "Allow execution of: 'command'?"
            /Enter to select/i,             // Selection prompt
            /Press Enter/i,                 // Any Enter prompt
        ],
    },
    {
        status: 'idle',
        priority: 1,
        patterns: [
            // Gemini prompt hints
            /Type your message/,      // "Type your message" prompt hint
            /@path\/to\/file/,        // "@path/to/file" hint
            /Tips for getting started/,  // Welcome message
        ],
    },
];

const GENERIC_PATTERNS: StatusPattern[] = [
    {
        status: 'waiting',
        priority: 2,
        patterns: [
            /\(y\/n\)/i,
            /\[Y\/n\]/i,
        ],
    },
    {
        status: 'idle',
        priority: 1,
        patterns: [
            /^>\s*$/m,
            /\$\s*$/m,
        ],
    },
];

function getPatternsForAI(aiType: AIType): StatusPattern[] {
    switch (aiType) {
        case 'claude':
            return CLAUDE_PATTERNS;
        case 'codex':
            return CODEX_PATTERNS;
        case 'gemini':
            return GEMINI_PATTERNS;
        default:
            return GENERIC_PATTERNS;
    }
}

function stripAnsiCodes(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

export class TerminalStatusDetector implements ITerminalStatusDetector {
    detect(aiType: AIType, output: string): AgentStatus {
        const cleanOutput = stripAnsiCodes(output);
        const patterns = getPatternsForAI(aiType);

        // Sort by priority descending (check highest priority first)
        const sortedPatterns = [...patterns].sort((a, b) => b.priority - a.priority);

        for (const { status, patterns: regexps } of sortedPatterns) {
            for (const regex of regexps) {
                if (regex.test(cleanOutput)) {
                    return status;
                }
            }
        }

        // No pattern matched - return inactive (no clear AI signal)
        return 'inactive';
    }

    detectFromBuffer(aiType: AIType, lines: string[]): AgentStatus {
        // Check last few lines first (most recent output is most relevant)
        // Start from the end and work backwards
        for (let i = lines.length - 1; i >= 0; i--) {
            const status = this.detect(aiType, lines[i]);
            if (status !== 'inactive') {
                return status;
            }
        }

        // Also try joining last 3 lines for multi-line patterns
        if (lines.length >= 2) {
            const recentOutput = lines.slice(-3).join('\n');
            const status = this.detect(aiType, recentOutput);
            if (status !== 'inactive') {
                return status;
            }
        }

        return 'inactive';
    }
}
