import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('AppStore', () => {
  it('persists accounts, settings, encrypted secrets, and strips secrets on export', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-store-'));
    tempDirs.push(dataDir);

    const store = new AppStore(dataDir, testCipher);
    const acc: AccountConfig = {
      id: 'acc-1',
      provider: 'claude-code',
      label: 'Claude Pro',
      mode: 'hybrid',
      profileDir: 'C:/tmp/claude',
      liveSyncEnabled: true,
      limits: {
        rollingWindowHours: 5,
        rollingLimitMetric: 'cost_usd',
        rollingLimitValue: 20
      },
      pinnedToWidget: true,
      enabled: true,
      createdAt: '2026-11-22T00:00:00.000Z',
      updatedAt: '2026-11-22T00:00:00.000Z'
    };

    store.saveAccount(acc);
    store.setAccountSecret('acc-1', 'super-secret-oauth-token');
    store.updateSettings({ pollIntervalSeconds: 120, opacity: 0.88 });

    // Reload from disk
    const reloaded = new AppStore(dataDir, testCipher);
    expect(reloaded.getAccounts()).toHaveLength(1);
    expect(reloaded.getAccounts()[0].hasSecretToken).toBe(true);
    expect(reloaded.getAccountSecret('acc-1')).toBe('super-secret-oauth-token');
    expect(reloaded.getSettings().pollIntervalSeconds).toBe(120);
    expect(reloaded.getSettings().opacity).toBe(0.88);

    const exported = reloaded.exportSanitizedJson();
    expect(exported).not.toContain('super-secret-oauth-token');
    expect(exported).toContain('"hasSecretToken": false');

    // Import into fresh store
    const dataDir2 = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-store2-'));
    tempDirs.push(dataDir2);
    const store2 = new AppStore(dataDir2, testCipher);
    const importRes = store2.importSanitizedJson(exported);
    expect(importRes.importedAccounts).toBe(1);
    expect(store2.getAccounts()[0].label).toBe('Claude Pro');

    reloaded.deleteAccount('acc-1');
    expect(reloaded.getAccounts()).toHaveLength(0);
    expect(reloaded.getAccountSecret('acc-1')).toBeNull();
  });
});
