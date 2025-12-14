<div align="center">

<img alt="Code Squad" src="assets/code-squad-full.png" width="400">

<br />

**Manage multiple AI agents in VS Code.**


[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/JakePark/code-squad?label=Downloads&color=teal)](https://open-vsx.org/extension/JakePark/code-squad)
[![GitHub Stars](https://img.shields.io/github/stars/team-attention/sidecar?style=flat&color=yellow)](https://github.com/team-attention/sidecar)
[![License](https://img.shields.io/github/license/team-attention/sidecar)](LICENSE)

</div>

<br />

## Why Code Squad?

Running multiple AI agents at once is chaos. Terminals pile up, context gets lost, changes overlap.

**Code Squad brings order.**

Create isolated agent sessions, track their status in real-time, review changes per agent, and switch between them instantly.

---

## Features

### Agent Management
- Create multiple agent sessions with isolated terminals
- Real-time status tracking (working, idle, waiting)
- Switch between agents with `Cmd+Shift+A`

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

[GitHub](https://github.com/team-attention/sidecar) · [Issues](https://github.com/team-attention/sidecar/issues) · [Changelog](https://github.com/team-attention/sidecar/releases)

---

> **Note**: Code Squad was originally called "Sidecar". See [legacy documentation](SIDECAR_README.md).

---

<div align="center">

**MIT License**

</div>
