<div align="center">

<img alt="Code Squad" src="assets/code-squad-full.png" width="400">

<br />

**Building with AI, the right way.**


[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/JakePark/code-squad?label=Downloads&color=teal)](https://open-vsx.org/extension/JakePark/code-squad)
[![GitHub Stars](https://img.shields.io/github/stars/team-attention/code-squad?style=flat&color=yellow)](https://github.com/team-attention/code-squad)
[![License](https://img.shields.io/github/license/team-attention/code-squad)](LICENSE)

</div>

<br />

> **Note**: This project was originally called "Sidecar". See [legacy documentation](SIDECAR_README.md).

## Why Code Squad?

Vibe coding is amazing... until you review the changes.

AI writes fast. Too fast. Files pile up, changes scatter everywhere. And now you're running multiple agents at once — terminals everywhere, context lost, changes overlapping.

**Code Squad keeps the conversation going.**

One seamless flow — talk to AI, review what it built, give feedback, keep building. Now with support for multiple agents running in parallel, each in its own isolated workspace.

---

## Features

### Agent Management
- Create multiple agent sessions with isolated terminals
- Real-time status tracking (working, idle, waiting)
- Click sidebar to switch between agents

### Git Isolation
- **Local**: Work in current branch
- **Worktree**: Isolated directory for parallel work (recommended)

### Review Interface
- Unified diff view per agent
- Inline comments with direct AI feedback
- Scope-based diff (grouped by function/class)

---

## Quick Start

```
1. Install from VS Marketplace / Open VSX
2. Click + in Code Squad sidebar to create an agent
3. Or just run claude/codex/gemini - Code Squad auto-attaches
```

---

## Supported AI Tools

| Tool | Command |
|------|---------|
| [Claude Code](https://github.com/anthropics/claude-code) | `claude` |
| [Codex CLI](https://github.com/openai/codex) | `codex` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini` |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codeSquad.autoDetect` | `true` | Auto-detect AI tools in terminal |
| `codeSquad.autoShowPanel` | `true` | Open panel when AI detected |
| `codeSquad.includeFiles` | `[]` | Glob patterns for gitignored files |

---

## Requirements

VS Code 1.93.0+

---

## Links

[GitHub](https://github.com/team-attention/code-squad) · [Issues](https://github.com/team-attention/code-squad/issues) · [Changelog](https://github.com/team-attention/code-squad/releases)

---

<div align="center">

**MIT License**

</div>
