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
});
