import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GeminiProvider } from '../src/main/providers/geminiProvider';
import { RateLimitGuard } from '../src/main/providers/base';
import type { AccountConfig } from '../src/shared/types';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-gemini-'));
  tempDirs.push(dir);
  return dir;
}

function makeAccount(profileDir: string, overrides: Partial<AccountConfig> = {}): AccountConfig {
  const nowIso = '2026-11-22T12:00:00.000Z';
  return {
    id: 'gemini-acc-1',
    provider: 'gemini',
    label: 'Gemini CLI',
    mode: 'hybrid',
    profileDir,
    liveSyncEnabled: false,
    limits: {
      rollingWindowHours: 24,
      rollingLimitMetric: 'requests',
      rollingLimitValue: 100
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
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('GeminiProvider', () => {
  it('parses tmp/*/chats/*.jsonl and legacy *.json token summaries', async () => {
    const profileDir = createTempDir();
    const chatsDir = path.join(profileDir, 'tmp', 'projhash1', 'chats');
    mkdirSync(chatsDir, { recursive: true });

    const nowMs = Date.parse('2026-11-22T12:00:00.000Z');
    const recentIso = new Date(nowMs - 2 * 3_600_000).toISOString();

    writeFileSync(
      path.join(chatsDir, 'session-1.jsonl'),
      [
        JSON.stringify({ sessionId: 's1', startTime: recentIso }),
        JSON.stringify({
          timestamp: recentIso,
          type: 'model',
          model: 'gemini-2.5-pro',
          tokens: { input: 3000, output: 1000, cached: 500, thoughts: 250, total: 4750 }
        })
      ].join('\n'),
      'utf8'
    );

    writeFileSync(
      path.join(chatsDir, 'legacy.json'),
      JSON.stringify({
        startTime: recentIso,
        messages: [
          {
            timestamp: recentIso,
            model: 'gemini-2.5-flash',
            tokens: { input: 1000, output: 500, total: 1500 }
          }
        ]
      }),
      'utf8'
    );

    const provider = new GeminiProvider();
    const snap = await provider.collect(makeAccount(profileDir), {
      nowMs,
      getSecret: () => null
    });

    expect(snap.status).toBe('ok');
    expect(snap.metrics.rollingRequests).toBe(2);
    expect(snap.metrics.rollingTokens).toBe(6250);
    expect(snap.modelBreakdown).toHaveLength(2);
  });

  it('parses retrieveUserQuota buckets when liveSyncEnabled is true', async () => {
    const profileDir = createTempDir();
    writeFileSync(
      path.join(profileDir, 'oauth_creds.json'),
      JSON.stringify({ access_token: 'gem-token' }),
      'utf8'
    );

    const provider = new GeminiProvider(new RateLimitGuard(60_000));
    const nowMs = Date.parse('2026-11-22T12:00:00.000Z');

    const snap = await provider.collect(
      makeAccount(profileDir, { liveSyncEnabled: true }),
      {
        nowMs,
        getSecret: () => null,
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              buckets: [
                {
                  modelId: 'gemini-2.5-pro',
                  remainingFraction: 0.35,
                  resetTime: '2026-11-22T18:00:00.000Z'
                },
                {
                  modelId: 'gemini-2.5-flash',
                  remainingFraction: 0.9,
                  resetTime: '2026-11-22T18:00:00.000Z'
                }
              ]
            }),
            { status: 200 }
          )
      }
    );

    expect(snap.status).toBe('ok');
    expect(snap.sourceUsed).toBe('live');
    expect(snap.primaryQuota.label).toBe('gemini-2.5-pro');
    expect(snap.primaryQuota.usedPercent).toBe(65);
    expect(snap.pools).toHaveLength(2);
  });
});
