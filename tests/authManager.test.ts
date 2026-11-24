import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthManager, getAccountPartition } from '../src/main/authManager';
import { AppStore, type SecretCipher } from '../src/main/store';
import type { AccountConfig } from '../src/shared/types';

const tempDirs: string[] = [];

const testCipher: SecretCipher = {
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8').toString('base64'),
  decrypt: (cipher) => {
    const raw = Buffer.from(cipher, 'base64').toString('utf8');
    if (!raw.startsWith('enc:')) throw new Error('Invalid cipher');
    return raw.slice(4);
  }
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createTestStore(): AppStore {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-auth-'));
  tempDirs.push(dir);
  return new AppStore(dir, testCipher);
}

describe('AuthManager & Partitioning', () => {
  it('generates isolated partition IDs per account', () => {
    expect(getAccountPartition('acc-123')).toBe('persist:account-acc-123');
    expect(getAccountPartition('user@example.com/work')).toBe('persist:account-user_example_com_work');
    // Ensure two different accounts have strictly distinct partitions
    expect(getAccountPartition('acc-personal')).not.toBe(getAccountPartition('acc-work'));
  });

  it('provides official login URLs for all 4 AI providers', () => {
    const store = createTestStore();
    const manager = new AuthManager({ store });

    expect(manager.getLoginUrl('claude-code')).toBe('https://claude.ai/login');
    expect(manager.getLoginUrl('codex')).toBe('https://chatgpt.com/auth/login');
    expect(manager.getLoginUrl('gemini')).toBe('https://aistudio.google.com/');
    expect(manager.getLoginUrl('antigravity')).toBe('https://accounts.google.com/ServiceLogin');
  });

  it('verifies Claude OAuth tokens and parses live 5h / 7d quotas', async () => {
    const store = createTestStore();
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/oauth/usage')) {
        return new Response(
          JSON.stringify({
            five_hour: {
              utilization: 24.5,
              resets_at: '2026-11-24T22:00:00Z'
            },
            seven_day: {
              utilization: 60.0,
              resets_at: '2026-11-30T18:00:00Z'
            }
          }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const manager = new AuthManager({ store, fetchFn: mockFetch });
    const result = await manager.verifyCredentials('claude-code', 'test-oauth-token');

    expect(result.valid).toBe(true);
    expect(result.primaryQuota).toBeDefined();
    expect(result.primaryQuota?.label).toBe('5h Session');
    expect(result.primaryQuota?.usedPercent).toBe(25);
    expect(result.secondaryQuota).toBeDefined();
    expect(result.secondaryQuota?.label).toBe('7d Weekly');
    expect(result.secondaryQuota?.usedPercent).toBe(60);
  });

  it('verifies Codex / ChatGPT tokens and parses primary and secondary rate limits', async () => {
    const store = createTestStore();
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('/backend-api/wham/usage')) {
        return new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 45,
                resets_at: '2026-11-24T21:30:00Z'
              },
              secondary_window: {
                used_percent: 82,
                resets_at: '2026-12-01T00:00:00Z'
              }
            }
          }),
          { status: 200 }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const manager = new AuthManager({ store, fetchFn: mockFetch });
    const result = await manager.verifyCredentials('codex', 'test-codex-token');

    expect(result.valid).toBe(true);
    expect(result.primaryQuota?.label).toBe('5h Limit');
    expect(result.primaryQuota?.usedPercent).toBe(45);
    expect(result.secondaryQuota?.label).toBe('Weekly Limit');
    expect(result.secondaryQuota?.usedPercent).toBe(82);
  });

  it('verifies Google Gemini API keys via Generative Language endpoint', async () => {
    const store = createTestStore();
    const mockFetch: typeof fetch = async (url) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-pro' }] }), {
          status: 200
        });
      }
      return new Response('Unauthorized', { status: 401 });
    };

    const manager = new AuthManager({ store, fetchFn: mockFetch });
    const result = await manager.verifyCredentials('gemini', 'AIzaSyTestApiKey');
    expect(result.valid).toBe(true);
    expect(result.message).toContain('Google Gemini API key successfully verified');
  });

  it('signs out an account, clears secret and updates account metadata', async () => {
    const store = createTestStore();
    const account: AccountConfig = {
      id: 'acc-signout-test',
      provider: 'claude-code',
      label: 'Personal Claude',
      mode: 'live-api',
      profileDir: '',
      liveSyncEnabled: true,
      authType: 'direct-signin',
      directAuthEmail: 'personal@example.com',
      directAuthStatus: 'signed-in',
      limits: {
        rollingWindowHours: 5,
        rollingLimitMetric: 'cost_usd',
        rollingLimitValue: 20
      },
      pinnedToWidget: true,
      enabled: true,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z'
    };

    store.saveAccount(account);
    store.setAccountSecret('acc-signout-test', 'secret-token-to-be-cleared');

    expect(store.getAccountSecret('acc-signout-test')).toBe('secret-token-to-be-cleared');

    const mockSession = {
      clearStorageData: async () => {}
    } as unknown as Electron.Session;

    const manager = new AuthManager({
      store,
      sessionGetter: () => mockSession
    });

    await manager.signOut('acc-signout-test');

    expect(store.getAccountSecret('acc-signout-test')).toBeNull();
    const updated = store.getAccount('acc-signout-test');
    expect(updated?.hasSecretToken).toBe(false);
    expect(updated?.directAuthStatus).toBe('signed-out');
  });
});
