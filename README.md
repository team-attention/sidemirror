# Sidecar

**Real-time code review interface for AI coding assistants**

Sidecar automatically detects AI coding tools like Claude Code, Codex, and Gemini CLI, displaying file changes in a side panel so you can review and provide feedback in real-time.

## Demo

https://github.com/user-attachments/assets/b893de21-bf19-430f-97c6-0ff544a7ac25

## Features

- **Auto-Detection**: Automatically activates when Claude Code, Codex, or Gemini CLI starts in terminal
- **Diff Viewer**: Human-friendly diff display with collapsible chunks and scope labels
- **Scope Detection**: Shows function/class names for each change using LSP
- **File Tree View**: Hierarchical file list with status badges (A/M/D)
- **Markdown Preview**: Preview mode for markdown files
- **Line Comments**: Click or drag-select lines to add review comments
- **Direct Submission**: Send comments directly to the AI terminal

## Installation

Search for "Sidecar" in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).

## Usage

### Automatic Mode

1. Open a workspace in VS Code
2. Run Claude Code, Codex, or Gemini CLI in the terminal
3. Sidecar panel opens automatically
4. Review file changes as the AI works

### Manual Mode

1. Open command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run `Sidecar: Show Panel`

### Adding Comments

Click or drag-select lines in the diff viewer to add comments.

### Submitting Feedback

Click "Ask AI" to send all comments to the active AI terminal.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sidecar.autoDetect` | `true` | Auto-detect AI commands |
| `sidecar.autoShowPanel` | `true` | Auto-show panel on AI detection |
| `sidecar.includeFiles` | `[]` | Glob patterns for gitignored files to track |

### Include Files Example

Track build outputs and environment files:

```json
{
  "sidecar.includeFiles": [
    "dist/**",
    ".env.local",
    "build/**/*.js"
  ]
}
```

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
