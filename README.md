<div align="center">

<img alt="Code Squad" src="assets/code-squad-full.png" width="400">

<br />

**Building with AI, the right way.**

https://github.com/user-attachments/assets/cd1c6eb1-21fe-4179-91b8-a1abd920ea41

[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/JakePark/code-squad?label=Downloads&color=teal)](https://open-vsx.org/extension/JakePark/code-squad)
[![GitHub Stars](https://img.shields.io/github/stars/team-attention/code-squad?style=flat&color=yellow)](https://github.com/team-attention/code-squad)
[![License](https://img.shields.io/github/license/team-attention/code-squad)](LICENSE)

</div>

<br />

> **Note**: This project was originally called "Sidecar". See [legacy documentation](SIDECAR_README.md).

## Why Code Squad?

AI coding agents write fast. Too fast. Files pile up, changes scatter everywhere, and when you need to review or give feedback — **the flow breaks**.

- Hard to track what changed across multiple files
- Context gets lost when running multiple agents
- Copy-pasting code to request fixes is tedious

**Code Squad keeps the conversation going.**

Talk to AI → Review changes instantly → Give inline feedback → AI fixes it. One seamless flow from start to finish.

---

## How It Works

### 1. Start a Thread

Open **Thread Management** in the sidebar and click `+`.

- Enter a **task name**
- Choose **isolation mode**:
  - `Local` - Work in current branch
  - `Worktree` - Create isolated worktree (recommended for parallel work)

### 2. Run Your AI Agent

A terminal opens. Run your preferred AI agent:

```bash
claude    # Claude Code
codex     # OpenAI Codex CLI
gemini    # Gemini CLI
```

### 3. Review Changes

When AI modifies files, **Code Squad panel** shows all changes:

- File-by-file Diff view
- Scope view (grouped by function/class)

### 4. Give Inline Feedback

Select lines that need changes. Write a comment. Hit **Submit** — it goes directly to the AI terminal.

```
"Add error handling to this function"
    ↓
AI starts fixing immediately
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Thread Management** | Run multiple AI agents in isolated workspaces |
| **Isolation Modes** | `Local` (current branch) or `Worktree` (isolated directory) |
| **Attach to Worktree** | Connect Code Squad to existing git worktrees |
| **Auto-Detect** | Automatically detects `claude`, `codex`, `gemini` |
| **Diff View** | GitHub-style change comparison |
| **Inline Comments** | Select lines → Comment → Send to AI |
| **Scope View** | Changes grouped by function/class |
| **Status Tracking** | Real-time AI status with color indicators |

### Thread Actions

Each thread in the sidebar has quick actions:

| Action | Description |
|--------|-------------|
| **Terminal** | Open/focus the thread's terminal |
| **Open in Editor** | Open worktree folder in new VS Code window |
| **Cleanup** | Delete thread and optionally remove worktree |

### Status Indicators

| Status | Color | Description |
|--------|-------|-------------|
| **Working** | 🟢 Green | AI is actively processing (pulsing) |
| **Waiting** | 🟡 Yellow | AI waiting for confirmation (y/n) |
| **Idle** | 🔵 Blue | AI ready for input |
| **Inactive** | ⚪ Gray | No AI session running |

---

## Installation

**VS Code / Cursor Extension**

1. Open Extensions (`Cmd+Shift+X`)
2. Search "Code Squad"
3. Click Install

Or download from [Open VSX](https://open-vsx.org/extension/JakePark/code-squad)

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
| `codeSquad.includeFiles` | `[]` | Glob patterns for gitignored files to track |
| `codeSquad.worktreeCopyPatterns` | `[]` | Files to copy when creating worktree (e.g., `.env*`, `config/**`) |

---

## Requirements

- VS Code 1.93.0+ or Cursor

---

## Links

[GitHub](https://github.com/team-attention/code-squad) · [Issues](https://github.com/team-attention/code-squad/issues) · [Changelog](https://github.com/team-attention/code-squad/releases)

---

<div align="center">

**MIT License**

</div>
