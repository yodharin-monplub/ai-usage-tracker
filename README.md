# AI Usage Tracker

A lightweight, obsidian-themed Windows desktop widget & system tray application built with **Electron, TypeScript, React, and Vite** to track rolling quotas, reset timers, token usage, and estimated costs across **multiple accounts** for:

- **Claude Code**
- **Antigravity**
- **Gemini**
- **Codex**

---

## Features

- **Multi-Account Support**: Track unlimited accounts per provider (e.g., Personal Pro, Work Team, Client workspaces) side-by-side in one floating widget.
- **Floating Mini Widget + Expanded Dashboard**: Compact always-on-top widget with configurable opacity, provider filters, and 1-second live reset countdowns, expandable into a full multi-account management dashboard.
- **Windows System Tray Integration**: Minimize/close to tray with quick toggles for Mini/Expanded mode, Refresh All, Always on Top, and live tooltip summary.
- **Hybrid Data Collection**:
  - **Local Log Parsing (Offline & Read-Only)**:
    - *Claude Code*: Deduplicates streaming entries in `~/.claude*/projects/**/*.jsonl` for 5h / today / 7d tokens, requests, models, and USD estimates.
    - *Antigravity*: Reads `conversation_summaries.db` (in-memory via pure-WASM `sql.js`, never locking live files) + `history.jsonl` for rolling steps, prompts, and agent breakdown.
    - *Gemini*: Reads `~/.gemini*/tmp/*/chats/*.jsonl` and legacy `.json` session files.
    - *Codex*: Reads `~/.codex*/sessions/**/*.jsonl`, `archived_sessions/**/*.jsonl` (including embedded `rate_limits`), and `session_index.jsonl`.
  - **Opt-In Live Quota Sync**: Optional OAuth quota checks (Claude `oauth/usage`, Codex `wham/usage`, Gemini `retrieveUserQuota`) guarded by a 5-minute cooldown and automatic HTTP 429 exponential backoff.
  - **Paste `/usage` Snapshot Parser**: Paste output directly from `/usage`, `/quota`, `/status`, or `/stats` to extract percentages, model pools, and reset countdowns immediately.
- **Auto-Discovery**: One-click scan detects existing CLI profile directories on your machine without touching credentials.
- **Secure Secret Storage**: Optional override tokens are encrypted with Windows DPAPI (`safeStorage`) and stored outside the repo in `%APPDATA%\ai-tracker`.

---

## Download (Windows `.exe`)

Prebuilt Windows binaries are available on the [GitHub Releases](https://github.com/yodharin-monplub/ai-usage-tracker/releases/latest) page:

- **`AI-Tracker-0.1.0-portable.exe`** — Standalone portable app (download & double-click, no installation or Node.js required).
- **`AI-Tracker-Setup-0.1.0.exe`** — Standard Windows installer with Start Menu and Desktop shortcuts.
- **`README.txt`** — Plain-text user guide included alongside the release binaries.

> **SmartScreen Note:** Because the open-source Windows build is unsigned, Windows SmartScreen may ask for confirmation on first run (**More info → Run anyway**).

---

## Multi-Account CLI Setup Tips

Each provider supports isolated profile folders via environment variables, letting you configure separate accounts in **AI Tracker**:

| Provider | Default Profile Path | Multi-Account Isolation |
|---|---|---|
| **Claude Code** | `~/.claude` | Set `CLAUDE_CONFIG_DIR` (e.g. `~/.claude-personal`, `~/.claude-work`) |
| **Antigravity** | `~/.gemini/antigravity-cli` | Track separate Antigravity profile folders (`antigravity-cli`, `antigravity`, custom dirs) |
| **Gemini** | `~/.gemini` | Set `GEMINI_CLI_HOME` or `GEMINI_DATA_DIR` per account |
| **Codex** | `~/.codex` | Set `CODEX_HOME` (e.g. `~/.codex-personal`, `~/.codex-work`) |

---

## Quick Start

> **Windows Notes:**
> - If PowerShell execution policy blocks `npm.ps1`, use `npm.cmd` instead of bare `npm`.
> - On `npm` v11+, if `esbuild` or `electron` postinstall binaries are skipped by `allowScripts`, run `node node_modules/esbuild/install.js` and `node node_modules/electron/install.js`.
> - When cloned on a mapped SMB/network drive (`Z:\`), `npm.cmd start` and `npm.cmd run dev` automatically mirror the Electron binary into `%LOCALAPPDATA%\ai-tracker-runtime` so Chromium's AppContainer sandbox stays enabled.

```powershell
# 1. Install dependencies
npm.cmd install

# 2. Build main process, preload bridge, icons, and React UI
npm.cmd run build

# 3. Launch the widget
npm.cmd start
```

### Development & Testing

```powershell
# Start Vite dev server + Electron in dev mode
npm.cmd run dev

# Run TypeScript check
npm.cmd run typecheck

# Run Vitest unit tests
npm.cmd test

# Package unpacked Windows directory build
npm.cmd run package:win
```

---

## License

MIT License — Copyright (c) 2026 Yodharin monplub. See [LICENSE](./LICENSE).
