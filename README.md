# Sidecar

> Real-time code review panel for AI coding assistants

Sidecar displays file changes from AI coding tools (Claude Code, Codex, Gemini CLI) in a dedicated side panel, enabling you to review modifications as they happen.

https://github.com/user-attachments/assets/63979c9d-5ed4-4127-a3bc-4c12c8fcf1cf

## Features

### Automatic AI Detectionssss
Sidecar monitors your terminal and automatically activates when it detects Claude Code, Codex, or Gemini CLI. The review panel opens alongside your editor without manual intervention.

### Structured Diff View
File changes are displayed with collapsible chunks organized by code scope. Each chunk header shows the relevant function, class, or module name using LSP symbol detection, making it easy to understand the context of changessss.

### File Tree with Status Indicators
Modified files appear in a hierarchical tree view with visual status badges:
- **A** (green) — Added files
- **M** (yellow) — Modified files
- **D** (red) — Deleted files

### Inline Review Comments
Select single or multiple lines in the diff view to add comments. Comments are collected in the sidebar and can be sent directly to the active AI terminal with one click.

### Markdown Preview
For markdown files, toggle between diff view and rendered preview to see documentation changes as they will appear.

## Usage

**Automatic**: Start any supported AI tool in VS Code's integrated terminal. Sidecar opens automatically.

**Manual**: Open Command Palette (`Cmd+Shift+P`) → `Sidecar: Show Panel`

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sidecar.autoDetect` | `true` | Automatically detect AI coding tools in terminal |
| `sidecar.autoShowPanel` | `true` | Open Sidecar panel when AI tool is detected |
| `sidecar.includeFiles` | `[]` | Glob patterns for tracking gitignored files |

### Tracking Gitignored Files

To track files normally excluded by `.gitignore` (build outputs, environment files):

```json
{
  "sidecar.includeFiles": ["dist/**", ".env.local"]
}
```

## Requirements

- VS Code 1.93.0 or later

## Supported AI Tools

- [Claude Code](https://claude.ai/code) by Anthropic
- [Codex CLI](https://github.com/openai/codex) by OpenAI
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) by Google

## Links

- [GitHub Repository](https://github.com/team-attention/sidecar)
- [Report Issues](https://github.com/team-attention/sidecar/issues)
- [Changelog](https://github.com/team-attention/sidecar/releases)

## License

[MIT](LICENSE)
