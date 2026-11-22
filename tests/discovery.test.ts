import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAccountFromDiscovered,
  discoverLocalProfiles
} from '../src/main/discovery';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('discoverLocalProfiles', () => {
  it('discovers multi-account profiles across Claude, Antigravity, Gemini, and Codex', async () => {
    const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-home-'));
    tempDirs.push(fakeHome);

    mkdirSync(path.join(fakeHome, '.claude', 'projects', 'p1'), { recursive: true });
    mkdirSync(path.join(fakeHome, '.claude-work'), { recursive: true });
    writeFileSync(path.join(fakeHome, '.claude-work', '.credentials.json'), '{}');

    mkdirSync(path.join(fakeHome, '.codex', 'sessions'), { recursive: true });
    mkdirSync(path.join(fakeHome, '.codex-team'), { recursive: true });
    writeFileSync(path.join(fakeHome, '.codex-team', 'session_index.jsonl'), '');

    mkdirSync(path.join(fakeHome, '.gemini', 'tmp'), { recursive: true });
    mkdirSync(path.join(fakeHome, '.gemini', 'antigravity-cli'), { recursive: true });
    writeFileSync(
      path.join(fakeHome, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
      ''
    );
    mkdirSync(path.join(fakeHome, '.gemini', 'antigravity'), { recursive: true });
    writeFileSync(path.join(fakeHome, '.gemini', 'antigravity', 'history.jsonl'), '');

    const firstPass = await discoverLocalProfiles(fakeHome, []);
    expect(firstPass).toHaveLength(7);

    const byProvider = {
      claude: firstPass.filter((p) => p.provider === 'claude-code'),
      antigravity: firstPass.filter((p) => p.provider === 'antigravity'),
      gemini: firstPass.filter((p) => p.provider === 'gemini'),
      codex: firstPass.filter((p) => p.provider === 'codex')
    };

    expect(byProvider.claude).toHaveLength(2);
    expect(byProvider.antigravity).toHaveLength(2);
    expect(byProvider.gemini).toHaveLength(1);
    expect(byProvider.codex).toHaveLength(2);
    expect(firstPass.every((p) => p.alreadyAdded === false)).toBe(true);

    const existing = [createAccountFromDiscovered(firstPass[0])];
    expect(existing[0].liveSyncEnabled).toBe(false);

    const secondPass = await discoverLocalProfiles(fakeHome, existing);
    const matched = secondPass.find((p) => p.profileDir === firstPass[0].profileDir);
    expect(matched?.alreadyAdded).toBe(true);
  });
});
