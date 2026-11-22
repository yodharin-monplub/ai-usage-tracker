================================================================================
AI USAGE TRACKER (v0.1.1)
Multi-Account Desktop Widget for Claude Code, Antigravity, Gemini & Codex
================================================================================

1. WHAT IS AI TRACKER?
----------------------
AI Tracker is an always-on-top Windows desktop widget and system tray app that
tracks rolling quotas, reset timers, token usage, and estimated USD costs
across multiple accounts for:
  - Claude Code
  - Antigravity
  - Gemini
  - Codex


2. QUICK START FOR WINDOWS USERS (NO CODING / NODE.JS REQUIRED)
----------------------------------------------------------------
Download the latest Windows release from GitHub:
  https://github.com/yodharin-monplub/ai-usage-tracker/releases/latest

Choose either file:
  * AI-Tracker-0.1.1-portable.exe
      Standalone portable app. Download anywhere on your PC and double-click
      to run immediately (no installation required).

  * AI-Tracker-Setup-0.1.1.exe
      Standard Windows installer. Creates Start Menu and Desktop shortcuts.

Windows SmartScreen Note:
Because this open-source release is unsigned, Windows SmartScreen may show a
"Windows protected your PC" prompt on first launch. Click "More info" ->
"Run anyway" if you trust the download from the official GitHub Releases page.


3. FIRST LAUNCH & MULTI-ACCOUNT SETUP
-------------------------------------
On first launch, AI Tracker runs a read-only local profile scan and adds any
detected CLI profiles automatically (live remote API sync stays OFF by default).

To add extra accounts for the same AI tool:
  1. Click the Expand button (top-right of the floating widget).
  2. Open the "Accounts" tab and click "+ Add Account" or "Auto-Scan".
  3. Point each account to its own local profile directory:
       * Claude Code : CLAUDE_CONFIG_DIR (e.g. ~/.claude-personal, ~/.claude-work)
       * Antigravity : ~/.gemini/antigravity-cli, ~/.gemini/antigravity, etc.
       * Gemini      : GEMINI_CLI_HOME or GEMINI_DATA_DIR per account
       * Codex       : CODEX_HOME (e.g. ~/.codex-personal, ~/.codex-work)

Tip — Paste /usage Output:
Click the paste icon on any account card and paste output directly from /usage,
/quota, /status, or /stats to immediately update utilization % and countdowns.

Tip — System Tray:
Closing the widget hides it to the Windows system tray. Right-click the tray
icon to switch between Mini Widget and Expanded Dashboard, toggle Always on
Top, refresh all accounts, or quit completely.


4. PRIVACY & DATA STORAGE
-------------------------
* Local CLI logs and SQLite files are read strictly read-only.
* Configuration and settings are stored locally in:
    %APPDATA%\ai-tracker\ai-tracker-config.json
* Optional override tokens / API keys are encrypted via Windows DPAPI
  (Electron safeStorage) in:
    %APPDATA%\ai-tracker\ai-tracker-secrets.json


5. BUILDING OR RUNNING FROM SOURCE (DEVELOPERS)
-----------------------------------------------
Requirements: Node.js 22+ and Git.
Note for Windows PowerShell: if execution policy blocks npm.ps1, use npm.cmd.

  git clone https://github.com/yodharin-monplub/ai-usage-tracker.git
  cd ai-usage-tracker
  npm.cmd install
  npm.cmd run build
  npm.cmd start

Run tests & typecheck:
  npm.cmd run typecheck
  npm.cmd test

Build Windows .exe packages:
  npm.cmd run package:exe


6. LICENSE
----------
MIT License — Copyright (c) 2026 Yodharin monplub
See LICENSE in the repository root for full terms.
