import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexProvider } from '../src/main/providers/codexProvider';
import { RateLimitGuard } from '../src/main/providers/base';
import type { AccountConfig } from '../src/shared/types';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-codex-'));
  tempDirs.push(dir);
  return dir;
}

function makeAccount(profileDir: string, overrides: Partial<AccountConfig> = {}): AccountConfig {
  const nowIso = '2026-11-22T12:00:00.000Z';
  return {
    id: 'codex-acc-1',
    provider: 'codex',
    label: 'Codex Work',
    mode: 'hybrid',
    profileDir,
    liveSyncEnabled: false,
    limits: {
      rollingWindowHours: 5,
      rollingLimitMetric: 'tokens',
      rollingLimitValue: 2_000_000
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

describe('CodexProvider', () => {
  it('parses rollout JSONL token_count and embedded rate_limits', async () => {
    const profileDir = createTempDir();
    const sessionsDir = path.join(profileDir, 'sessions', '2026', '11', '22');
    mkdirSync(sessionsDir, { recursive: true });

    const nowMs = Date.parse('2026-11-22T12:00:00.000Z');
    const eventTime = new Date(nowMs - 30 * 60_000).toISOString();
    const resetUnixSec = Math.floor((nowMs + 3 * 3_600_000) / 1000);

    const lines = [
      JSON.stringify({
        type: 'turn_context',
        timestamp: eventTime,
        payload: { model: 'gpt-5.3-codex' }
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: eventTime,
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 12000,
              cached_input_tokens: 4000,
              output_tokens: 3000
            }
          },
          rate_limits: {
            primary: {
              used_percent: 28,
              window_minutes: 300,
              resets_at: resetUnixSec
            },
            secondary: {
              used_percent: 12,
              window_minutes: 10080,
              resets_at: resetUnixSec + 86400
            }
          }
        }
      })
    ];

    writeFileSync(path.join(sessionsDir, 'rollout-001.jsonl'), lines.join('\n'), 'utf8');

    const provider = new CodexProvider();
    const snap = await provider.collect(makeAccount(profileDir), {
      nowMs,
      getSecret: () => null
    });

    expect(snap.status).toBe('ok');
    expect(snap.metrics.rollingTokens).toBe(15000);
    expect(snap.metrics.rollingRequests).toBe(1);
    expect(snap.primaryQuota.usedPercent).toBe(28);
    expect(snap.secondaryQuota?.usedPercent).toBe(12);
    expect(snap.modelBreakdown[0]?.model).toBe('gpt-5.3-codex');
  });

  it('falls back to session_index.jsonl and supports opt-in wham/usage sync', async () => {
    const profileDir = createTempDir();
    const nowMs = Date.parse('2026-11-22T12:00:00.000Z');

    writeFileSync(
      path.join(profileDir, 'session_index.jsonl'),
      JSON.stringify({
        id: 'sess-1',
        thread_name: 'Refactor widget',
        updated_at: new Date(nowMs - 3600_000).toISOString()
      }),
      'utf8'
    );
    writeFileSync(
      path.join(profileDir, 'auth.json'),
      JSON.stringify({ tokens: { access_token: 'codex-tok', account_id: 'acct-9' } }),
      'utf8'
    );

    const provider = new CodexProvider(new RateLimitGuard(60_000));
    const snap = await provider.collect(
      makeAccount(profileDir, { liveSyncEnabled: true }),
      {
        nowMs,
        getSecret: () => null,
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              rate_limit: {
                primary_window: {
                  used_percent: 61,
                  limit_window_seconds: 18000,
                  reset_at: Math.floor((nowMs + 7200_000) / 1000)
                },
                secondary_window: {
                  used_percent: 24,
                  limit_window_seconds: 604800,
                  reset_at: Math.floor((nowMs + 3 * 86400_000) / 1000)
                }
              }
            }),
            { status: 200 }
          )
      }
    );

    expect(snap.status).toBe('ok');
    expect(snap.sourceUsed).toBe('hybrid');
    expect(snap.metrics.rollingRequests).toBe(1);
    expect(snap.primaryQuota.usedPercent).toBe(61);
    expect(snap.secondaryQuota?.usedPercent).toBe(24);
  });
});
