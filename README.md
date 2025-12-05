<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/sidecar-full.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/sidecar-full.svg">
  <img alt="Sidecar" src="assets/sidecar-full.svg" width="400">
</picture>

<br />

**Building with AI, the right way.**


[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/JakePark/Sidecar?label=Downloads&color=teal)](https://open-vsx.org/extension/JakePark/Sidecar)
[![GitHub Stars](https://img.shields.io/github/stars/team-attention/sidecar?style=flat&color=yellow)](https://github.com/team-attention/sidecar)
[![License](https://img.shields.io/github/license/team-attention/sidecar)](LICENSE)

<br />

https://github.com/user-attachments/assets/51aa09b2-072a-47f7-b8be-f49e05493ca6

</div>

<br />

## Why Sidecar?

Vibe coding is amazing... until you review the changes.

AI writes fast. Too fast. Files pile up, changes scatter everywhere, and suddenly you're juggling tabs, hunting diffs, fixing things by hand. The conversation breaks. The momentum dies.

**Sidecar keeps the conversation going.**

One seamless flow — talk to AI, review what it built, give feedback, keep building. All in one place, without breaking the rhythm.

---

## Features

**👁️ Unified View**
All AI outputs — code, docs, configs — organized in a single panel. No more hunting through files.

**💬 Inline Comments**
Select lines, leave feedback, send to AI. Talk to AI in context, not in a separate terminal.

**🧩 Structured Diffs**
Changes grouped by function, class, or module. See the intent, not just the diff.

---

## Quick Start

```
1. Install from VS Marketplace
2. Start Claude Code, Codex, or Gemini CLI
3. Sidecar opens automatically
```

---

## Supported AI Tools

<table>
  <tr>
    <td align="center"><a href="https://claude.ai/code"><strong>Claude Code</strong></a><br/>Anthropic</td>
    <td align="center"><a href="https://github.com/openai/codex"><strong>Codex CLI</strong></a><br/>OpenAI</td>
    <td align="center"><a href="https://github.com/google-gemini/gemini-cli"><strong>Gemini CLI</strong></a><br/>Google</td>
  </tr>
</table>

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sidecar.autoDetect` | `true` | Auto-detect AI tools in terminal |
| `sidecar.autoShowPanel` | `true` | Open panel when AI tool detected |
| `sidecar.includeFiles` | `[]` | Glob patterns for gitignored files |

<details>
<summary><strong>Tracking gitignored files</strong></summary>

```json
{
  "sidecar.includeFiles": ["dist/**", ".env.local"]
}
```

</details>

---

## Requirements

VS Code 1.93.0+

---

## Links

[GitHub](https://github.com/eatnug/sidecar) · [Issues](https://github.com/eatnug/sidecar/issues) · [Changelog](https://github.com/eatnug/sidecar/releases)

---

<div align="center">

**MIT License**

</div>
