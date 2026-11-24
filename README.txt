================================================================================
AI USAGE TRACKER (v0.2.0)
Multi-Account Desktop Widget for Claude Code, Antigravity, Gemini & Codex
================================================================================

1. WHAT IS AI TRACKER?
----------------------
AI Tracker is an always-on-top Windows desktop widget and system tray app that
tracks rolling quotas, reset timers, token usage, and estimated USD costs
across multiple accounts simultaneously for:
  - Claude Code
  - Antigravity
  - Gemini
  - Codex (ChatGPT / OpenAI)


2. QUICK START FOR WINDOWS USERS (NO CODING / NODE.JS REQUIRED)
----------------------------------------------------------------
Download the latest Windows release from GitHub:
  https://github.com/yodharin-monplub/ai-usage-tracker/releases/latest

Choose either file:
  * AI-Tracker-0.2.0-portable.exe
      Standalone portable app. Download anywhere on your PC and double-click
      to run immediately (no installation required).

  * AI-Tracker-Setup-0.2.0.exe
      Standard Windows installer. Creates Start Menu and Desktop shortcuts.

Windows SmartScreen Note:
Because this open-source release is unsigned, Windows SmartScreen may show a
"Windows protected your PC" prompt on first launch. Click "More info" ->
"Run anyway" if you trust the download from the official GitHub Releases page.


3. MULTI-ACCOUNT DIRECT SIGN-IN (NEW IN v0.2.0)
-----------------------------------------------
You can now sign in directly inside the app across multiple accounts so you can
view all of your account quotas concurrently:

  1. Click the Expand button (top-right of the floating widget).
  2. In the "Accounts" tab, click "+ Direct Sign-In" (or "+ Add Account").
  3. Select your provider (Claude Code, Antigravity, Gemini, or Codex).
  4. Click "Sign in Directly in App":
     - Opens a dedicated, isolated browser window for that account.
     - Each account runs in its own private session partition (persist:account-<id>).
     - Account 1 and Account 2 never share cookies or overwrite each other!
  5. Sign into your provider account (e.g. personal@gmail.com).
  6. AI Tracker automatically detects your session, extracts live quotas,
     encrypts your credential securely via Windows DPAPI, and closes the window.
  7. Repeat for your other accounts (e.g. work@company.com).
  8. All accounts appear side-by-side in both the Mini Widget and Expanded
     Dashboard, showing real-time 5-hour and 7-day quota bars and reset countdowns!


4. ALTERNATIVE SIGN-IN & TRACKING OPTIONS
-----------------------------------------
  * Direct API Key / Token:
      Paste an API key or OAuth Bearer token and click "Test & Verify" for
      instant live quota verification.
  * Local CLI Folder Scan:
      Point each account to its local CLI folder (~/.claude, ~/.gemini/antigravity-cli,
      ~/.codex) for 100% offline log tracking.
  * Paste /usage Output:
      Click the clipboard icon on any card to paste text directly from
      /usage, /quota, /status, or /stats.


5. PRIVACY & SECURITY
---------------------
* Each account uses an isolated Electron partition (persist:account-<id>).
* Passwords and tokens never leak across accounts or outside your computer.
* Credentials are encrypted using Windows DPAPI (Electron safeStorage) in:
    %APPDATA%\ai-tracker\ai-tracker-secrets.json
* Local logs and SQLite databases are read strictly read-only.


6. BUILDING OR RUNNING FROM SOURCE (DEVELOPERS)
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


7. LICENSE
----------
MIT License — Copyright (c) 2026 Yodharin monplub
See LICENSE in the repository root for full terms.
