# SideMirror

**Real-time code review interface for AI coding assistants**

SideMirror automatically detects AI coding tools like Claude Code, Codex, and Gemini CLI, displaying file changes in a side panel so you can review, comment, and provide feedback in real-time.

## Features

- **Auto-Detection**: Automatically activates when Claude Code, Codex, or Gemini CLI starts in terminal
- **Diff Viewer**: GitHub-style unified diff display with line numbers
- **Line Comments**: Click or drag-select lines to add review comments
- **Direct Submission**: Send comments directly to the AI terminal
- **Whitelist Support**: Track gitignored files (build outputs, env files, etc.)
- **Snapshot System**: Captures file state at session start for accurate diffs

## Installation

Search for "SideMirror" in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).

## Usage

### Automatic Mode

1. Open a workspace in VS Code
2. Run Claude Code, Codex, or Gemini CLI in the terminal
3. SideMirror panel opens automatically
4. Review file changes as the AI works

### Manual Mode

1. Open command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run `SideMirror: Show Panel`

### Adding Comments

- **From diff viewer**: Click the `+` button on any line, or drag to select multiple lines
- **From editor**: Right-click and select `SideMirror: Add Comment`

### Submitting Feedback

Click "Send to AI" to send all comments to the active AI terminal.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sidemirror.autoDetect` | `true` | Auto-detect AI commands |
| `sidemirror.autoShowPanel` | `true` | Auto-show panel on AI detection |
| `sidemirror.includeFiles` | `[]` | Glob patterns for gitignored files to track |

### Whitelist Example

Track build outputs and environment files:

```json
{
  "sidemirror.includeFiles": [
    "dist/**",
    ".env.local",
    "build/**/*.js"
  ]
}
```

## Commands

| Command | Description |
|---------|-------------|
| `SideMirror: Show Panel` | Open the review panel |
| `SideMirror: Add Comment` | Add comment at cursor position |
| `SideMirror: Submit Comments to AI` | Send comments to AI terminal |
| `SideMirror: Add File/Pattern to Whitelist` | Add pattern to track |
| `SideMirror: Manage Whitelist` | View/remove whitelist patterns |

## Requirements

- VS Code 1.93.0 or higher

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint` and `npm run compile`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Claude Code](https://claude.ai/claude-code) by Anthropic
- [Codex](https://openai.com/codex) by OpenAI
- [Gemini](https://ai.google.dev) by Google
