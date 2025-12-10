import * as vscode from 'vscode';

const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

export class ClaudeCodeConfigController {
    /**
     * Prompt user to enable terminal mode for Claude Code if not already enabled.
     * Shows a QuickPick with "Enable" pre-selected so user just presses Enter to accept.
     */
    async promptTerminalMode(): Promise<void> {
        const claudeExt = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
        if (!claudeExt) {
            return;
        }

        const config = vscode.workspace.getConfiguration('claudeCode');
        if (config.get('useTerminal') === true) {
            return;
        }

        const items: vscode.QuickPickItem[] = [
            {
                label: '$(check) Enable terminal mode',
                description: '(Recommended)',
                picked: true,
            },
            {
                label: '$(x) Skip',
            },
        ];

        const pick = await vscode.window.showQuickPick(items, {
            title: 'Sidecar works best with Claude Code in terminal mode',
            placeHolder: 'Press Enter to enable',
        });

        if (pick?.label.includes('Enable')) {
            await config.update('useTerminal', true, vscode.ConfigurationTarget.Global);
        }
    }
}
