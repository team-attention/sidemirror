import { AgentStatus, AIType } from '../entities/AISession';

interface StatusPattern {
    status: AgentStatus;
    patterns: RegExp[];
    priority: number;
}

export interface ITerminalStatusDetector {
    detect(aiType: AIType, output: string): AgentStatus;
    detectAIType(output: string): AIType | null;
}

// Status detection rules:
// - waiting: user input required (highest priority) - "Esc to cancel" in Claude
// - working: "Esc to interrupt" visible (AI processing)
// - idle: prompt ready for input

const CLAUDE_PATTERNS: StatusPattern[] = [
    {
        status: 'waiting',
        priority: 2,
        patterns: [
            /Esc to cancel/i,               // Permission dialog
            />\s*1\.\s*Yes/i,                // Permission menu option "> 1. Yes"
            /1\.\s*Yes,\s*allow/i,           // Confirmation menu with allow
            /Enter to select/,
            /\(y\/n\)/i,
            /\[Y\/n\]/i,
            /\[y\/N\]/i,
            /Tab\/Arrow keys/,
            /Press Enter to continue/,
            /Do you want to proceed\?/i,
            /Do you want to/i,
        ],
    },
    {
        status: 'working',
        priority: 1,
        patterns: [
            /Esc to interrupt/i,
        ],
    },
    {
        status: 'idle',
        priority: 0,
        patterns: [
            /^>\s*$/m,                        // Empty prompt (> ) - multiline mode
        ],
    },
];

// Codex: Only idle detection - output arrives in large batches, making
// real-time working/waiting detection unreliable
const CODEX_PATTERNS: StatusPattern[] = [
    {
        status: 'idle',
        priority: 0,
        patterns: [
            /To get started,?\s*describe/i,   // Welcome message
            />_\s*OpenAI\s*Codex/i,           // Header banner
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
            /1\.\s*Yes,\s*allow once/i,      // Gemini confirmation menu
            /Waiting for user/i,
            /Allow execution/i,
            /Yes, allow/i,
            /suggest changes/i,
            /Enter to select/i,
            /Press Enter/i,
            /Do you want to/i,
        ],
    },
    {
        status: 'working',
        priority: 1,
        patterns: [
            /esc to cancel/i,                 // "(esc to cancel, 1s)"
        ],
    },
    {
        status: 'idle',
        priority: 0,
        patterns: [
            />\s*Type your message/i,         // Input prompt
            /Tips for getting started/i,      // Welcome tips
        ],
    },
];

const GENERIC_PATTERNS: StatusPattern[] = [
    {
        status: 'waiting',
        priority: 2,
        patterns: [
            /1\.\s*Yes,\s*allow/i,           // Confirmation menu
            /\(y\/n\)/i,
            /\[Y\/n\]/i,
        ],
    },
    {
        status: 'working',
        priority: 1,
        patterns: [
            /Esc to interrupt/i,
        ],
    },
];

// AI type detection patterns - used to identify which AI CLI is running
// These patterns match startup banners and unique UI elements
const AI_TYPE_PATTERNS: { type: AIType; patterns: RegExp[] }[] = [
    {
        type: 'gemini',
        patterns: [
            /Gemini CLI/i,                    // Gemini banner
            /Tips for getting started/i,      // Gemini welcome message
            />\s*Type your message/i,         // Gemini input prompt
            /Gemini \d+\.\d+/i,               // Gemini version (e.g., "Gemini 2.5")
        ],
    },
    {
        type: 'codex',
        patterns: [
            /OpenAI\s*Codex/i,                // Codex banner
            />_\s*OpenAI/i,                   // Codex header
            /To get started,?\s*describe/i,   // Codex welcome
        ],
    },
    {
        type: 'claude',
        patterns: [
            /Claude Code/i,                   // Claude Code banner
            /claude\.ai/i,                    // Claude domain reference
            /Anthropic/i,                     // Anthropic reference
            /\bclaude\b.*\bsonnet\b/i,        // Model name (claude sonnet)
            /\bclaude\b.*\bopus\b/i,          // Model name (claude opus)
            /\bclaude\b.*\bhaiku\b/i,         // Model name (claude haiku)
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

    /**
     * Detect AI type from output content.
     * Returns null if no AI type pattern is matched.
     */
    detectAIType(output: string): AIType | null {
        const cleanOutput = stripAnsiCodes(output);

        for (const { type, patterns } of AI_TYPE_PATTERNS) {
            for (const pattern of patterns) {
                if (pattern.test(cleanOutput)) {
                    return type;
                }
            }
        }

        return null;
    }
}
