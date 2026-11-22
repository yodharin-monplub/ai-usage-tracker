import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeCodeProvider } from '../src/main/providers/claudeCodeProvider';
import { RateLimitGuard } from '../src/main/providers/base';
import type { AccountConfig } from '../src/shared/types';

const tempDirs: string[] = [];

function createTempProfile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-claude-'));
  tempDirs.push(dir);
  return dir;
}

function makeAccount(profileDir: string, overrides: Partial<AccountConfig> = {}): AccountConfig {
  const nowIso = '2026-11-22T12:00:00.000Z';
  return {
    id: 'claude-acc-1',
    provider: 'claude-code',
    label: 'Claude Personal',
    mode: 'hybrid',
    profileDir,
    liveSyncEnabled: false,
    limits: {
      rollingWindowHours: 5,
      rollingLimitMetric: 'cost_usd',
      rollingLimitValue: 20
    },
    pinnedToWidget: true,
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    ...overrides
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ClaudeCodeProvider', () => {
  it('parses local JSONL logs, deduplicates streaming chunks, and buckets 5h/today/7d', async () => {
    const profileDir = createTempProfile();
    const projDir = path.join(profileDir, 'projects', 'demo-app');
    mkdirSync(projDir, { recursive: true });

    // Local noon reference so "earlier today" (>5h ago) stays on the same local calendar day
    const nowLocal = new Date(2026, 10, 22, 14, 0, 0, 0);
    const nowMs = nowLocal.getTime();
    const twoHoursAgo = new Date(nowMs - 2 * 3_600_000).toISOString();
    const eightHoursAgo = new Date(nowMs - 8 * 3_600_000).toISOString();
    const threeDaysAgo = new Date(nowMs - 3 * 86_400_000).toISOString();
    const tenDaysAgo = new Date(nowMs - 10 * 86_400_000).toISOString();

    const lines = [
      // Duplicate streaming chunk 1 (lower token count — should be superseded)
      JSON.stringify({
        requestId: 'req-dedup-1',
        timestamp: twoHoursAgo,
        message: {
          id: 'msg-1',
          model: 'claude-sonnet-4-5',
          usage: {
            input_tokens: 1000,
            output_tokens: 10,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 0
          }
        }
      }),
      // Duplicate streaming chunk 2 (final token count — should win)
      JSON.stringify({
        requestId: 'req-dedup-1',
        timestamp: twoHoursAgo,
        message: {
          id: 'msg-1',
          model: 'claude-sonnet-4-5',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 0
          }
        }
      }),
      // Earlier today (>5h window, same local day)
      JSON.stringify({
        requestId: 'req-today-2',
        timestamp: eightHoursAgo,
        message: {
          model: 'claude-haiku-4-5',
          usage: { input_tokens: 2000, output_tokens: 1000 }
        }
      }),
      // 3 days ago (in 7d window only)
      JSON.stringify({
        requestId: 'req-week-3',
        timestamp: threeDaysAgo,
        message: {
          model: 'claude-opus-4-5',
          usage: { input_tokens: 1000, output_tokens: 500 }
        }
      }),
      // 10 days ago (outside 7d window — excluded)
      JSON.stringify({
        requestId: 'req-old-4',
        timestamp: tenDaysAgo,
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 99999, output_tokens: 99999 }
        }
      }),
      'not-valid-json'
    ];

    writeFileSync(path.join(projDir, 'session.jsonl'), lines.join('\n'), 'utf8');

    const provider = new ClaudeCodeProvider();
    const snap = await provider.collect(makeAccount(profileDir), {
      nowMs,
      getSecret: () => null
    });

    expect(snap.status).toBe('ok');
    expect(snap.sourceUsed).toBe('local');
    expect(snap.metrics.rollingRequests).toBe(1);
    expect(snap.metrics.rollingTokens).toBe(2000);
    expect(snap.metrics.todayRequests).toBe(2);
    expect(snap.metrics.todayTokens).toBe(5000);
    expect(snap.metrics.weekRequests).toBe(3);
    expect(snap.metrics.weekTokens).toBe(6500);
    expect(snap.modelBreakdown.map((m) => m.model)).toContain('claude-sonnet-4-5');
    expect(snap.metrics.weekCostUsd).toBeGreaterThan(0);
  });

  it('uses opt-in live OAuth quota when available and backs off gracefully on 429', async () => {
    const profileDir = createTempProfile();
    writeFileSync(
      path.join(profileDir, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'test-token-123' } }),
      'utf8'
    );

    const provider = new ClaudeCodeProvider(new RateLimitGuard(60_000));
    const account = makeAccount(profileDir, { liveSyncEnabled: true });
    const nowMs = Date.parse('2026-11-22T12:00:00.000Z');

    const okSnap = await provider.collect(account, {
      nowMs,
      getSecret: () => null,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            five_hour: { utilization: 44, resets_at: '2026-11-22T15:00:00.000Z' },
            seven_day: { utilization: 19, resets_at: '2026-11-27T00:00:00.000Z' }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    });

    expect(okSnap.status).toBe('ok');
    expect(okSnap.sourceUsed).toBe('live');
    expect(okSnap.primaryQuota.usedPercent).toBe(44);
    expect(okSnap.secondaryQuota?.usedPercent).toBe(19);

    // Simulate separate account receiving HTTP 429
    const acc429 = makeAccount(profileDir, { id: 'claude-acc-429', liveSyncEnabled: true });
    const limitedSnap = await provider.collect(acc429, {
      nowMs,
      getSecret: () => 'override-secret',
      fetchFn: async () => new Response('rate limited', { status: 429 })
    });

    expect(limitedSnap.status).toBe('rate-limited');
    expect(limitedSnap.statusMessage).toContain('429');
  });
});
