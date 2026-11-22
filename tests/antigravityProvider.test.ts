import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AntigravityProvider, getSqlJs } from '../src/main/providers/antigravityProvider';
import type { AccountConfig } from '../src/shared/types';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-agy-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('AntigravityProvider', () => {
  it('reads conversation_summaries.db (in-memory via sql.js) and history.jsonl cleanly', async () => {
    const profileDir = createTempDir();
    const SQL = await getSqlJs();
    const db = new SQL.Database();

    const nowLocal = new Date(2026, 10, 22, 14, 0, 0, 0);
    const nowMs = nowLocal.getTime();
    const twoHoursAgoIso = new Date(nowMs - 2 * 3_600_000).toISOString();
    const eightHoursAgoIso = new Date(nowMs - 8 * 3_600_000).toISOString();
    const threeDaysAgoIso = new Date(nowMs - 3 * 86_400_000).toISOString();

    db.run(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        title text NOT NULL DEFAULT "",
        preview text NOT NULL DEFAULT "",
        step_count integer NOT NULL DEFAULT 0,
        last_modified_time datetime NOT NULL,
        workspace_uris text NOT NULL DEFAULT "",
        status text NOT NULL DEFAULT "",
        source text NOT NULL DEFAULT "",
        project_id text NOT NULL DEFAULT "",
        agent_name text NOT NULL DEFAULT "",
        last_user_input_time datetime NOT NULL DEFAULT ""
      );
    `);

    db.run(
      `INSERT INTO conversation_summaries (conversation_id, step_count, last_modified_time, agent_name, source) VALUES (?, ?, ?, ?, ?)`,
      ['c1', 42, twoHoursAgoIso, 'Gemini 4 Neon', 'antigravity-cli']
    );
    db.run(
      `INSERT INTO conversation_summaries (conversation_id, step_count, last_modified_time, agent_name, source) VALUES (?, ?, ?, ?, ?)`,
      ['c2', 18, eightHoursAgoIso, 'Claude Sonnet', 'antigravity-ide']
    );
    db.run(
      `INSERT INTO conversation_summaries (conversation_id, step_count, last_modified_time, agent_name, source) VALUES (?, ?, ?, ?, ?)`,
      ['c3', 100, threeDaysAgoIso, 'Gemini 4 Neon', 'antigravity-cli']
    );

    const exported = db.export();
    db.close();
    writeFileSync(path.join(profileDir, 'conversation_summaries.db'), Buffer.from(exported));

    const historyLines = [
      JSON.stringify({ timestamp: twoHoursAgoIso, type: 'prompt', workspace: 'z:/repo' }),
      JSON.stringify({ timestamp: twoHoursAgoIso, type: 'prompt', workspace: 'z:/repo' }),
      JSON.stringify({ timestamp: eightHoursAgoIso, type: 'prompt', workspace: 'z:/repo' })
    ];
    writeFileSync(path.join(profileDir, 'history.jsonl'), historyLines.join('\n'), 'utf8');

    const account: AccountConfig = {
      id: 'agy-1',
      provider: 'antigravity',
      label: 'Antigravity CLI',
      mode: 'hybrid',
      profileDir,
      liveSyncEnabled: false,
      limits: {
        rollingWindowHours: 5,
        rollingLimitMetric: 'steps',
        rollingLimitValue: 200
      },
      manualSnapshot: {
        usedPercent: 40,
        label: 'Claude / GPT Pool',
        resetAtIso: new Date(nowMs + 3_600_000).toISOString(),
        pools: [
          { name: 'Gemini Models', usedPercent: 25 },
          { name: 'Claude / GPT Pool', usedPercent: 40 }
        ],
        updatedAtIso: new Date(nowMs).toISOString()
      },
      pinnedToWidget: true,
      enabled: true,
      createdAt: twoHoursAgoIso,
      updatedAt: twoHoursAgoIso
    };

    const provider = new AntigravityProvider();
    const snap = await provider.collect(account, {
      nowMs,
      getSecret: () => null
    });

    expect(snap.status).toBe('ok');
    expect(snap.sourceUsed).toBe('hybrid');
    expect(snap.metrics.rollingSteps).toBe(42);
    expect(snap.metrics.todaySteps).toBe(60);
    expect(snap.metrics.weekSteps).toBe(160);
    expect(snap.metrics.rollingRequests).toBe(2);
    expect(snap.metrics.todayRequests).toBe(3);
    expect(snap.primaryQuota.usedPercent).toBe(40);
    expect(snap.pools).toHaveLength(2);
    expect(snap.modelBreakdown[0]?.model).toBe('Gemini 4 Neon');
  });

  it('parses Go/SQLite +00:00 nanosecond timestamps, skips 0001-01-01, and computes 5h & 7d quotas + reset dates', async () => {
    const profileDir = createTempDir();
    const SQL = await getSqlJs();
    const db = new SQL.Database();

    const nowMs = Date.parse('2026-11-22T19:05:00.000Z');

    db.run(`
      CREATE TABLE conversation_summaries (
        conversation_id text PRIMARY KEY,
        step_count integer NOT NULL DEFAULT 0,
        last_modified_time datetime NOT NULL,
        last_user_input_time datetime NOT NULL DEFAULT "",
        agent_name text NOT NULL DEFAULT "",
        source text NOT NULL DEFAULT ""
      );
    `);

    // Exact format observed in real Antigravity conversation_summaries.db
    db.run(
      `INSERT INTO conversation_summaries (conversation_id, step_count, last_modified_time, last_user_input_time, agent_name, source) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'c-real-1',
        5000,
        '2026-11-22 17:33:58.1140909+00:00',
        '0001-01-01 00:00:00+00:00',
        '',
        'CORTEX_TRAJECTORY_SOURCE_CLI'
      ]
    );
    db.run(
      `INSERT INTO conversation_summaries (conversation_id, step_count, last_modified_time, last_user_input_time, agent_name, source) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'c-real-2',
        10000,
        '2026-11-20 10:00:00.1234567+00:00',
        '2026-11-20 09:55:00+00:00',
        '',
        ''
      ]
    );

    const exported = db.export();
    db.close();
    writeFileSync(path.join(profileDir, 'conversation_summaries.db'), Buffer.from(exported));

    const account: AccountConfig = {
      id: 'agy-local',
      provider: 'antigravity',
      label: 'Antigravity IDE',
      mode: 'hybrid',
      profileDir,
      liveSyncEnabled: false,
      limits: {
        rollingWindowHours: 5,
        rollingLimitMetric: 'steps',
        rollingLimitValue: 25_000,
        weeklyLimitValue: 100_000
      },
      pinnedToWidget: true,
      enabled: true,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString()
    };

    const provider = new AntigravityProvider();
    const snap = await provider.collect(account, {
      nowMs,
      getSecret: () => null
    });

    expect(snap.status).toBe('ok');
    expect(snap.metrics.rollingSteps).toBe(5000);
    expect(snap.metrics.weekSteps).toBe(15000);
    expect(snap.primaryQuota.usedPercent).toBe(20);
    expect(snap.primaryQuota.resetAtIso).toBe('2026-11-22T22:33:58.114Z');
    expect(snap.secondaryQuota?.usedPercent).toBe(15);
    expect(snap.secondaryQuota?.resetAtIso).toBe('2026-11-27T10:00:00.123Z');
  });
});
