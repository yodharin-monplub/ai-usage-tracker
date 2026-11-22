import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  PROVIDER_META,
  type AccountConfig,
  type AppSettings,
  type WindowBounds
} from '../shared/types';

export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export interface PersistedConfig {
  version: 1;
  settings: AppSettings;
  accounts: AccountConfig[];
  windowBounds?: WindowBounds;
}

interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function createElectronSecretCipher(safeStorage: ElectronSafeStorageLike): SecretCipher {
  return {
    encrypt(plaintext: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS credential encryption (safeStorage) is unavailable on this system.');
      }
      return safeStorage.encryptString(plaintext).toString('base64');
    },
    decrypt(ciphertext: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS credential encryption (safeStorage) is unavailable on this system.');
      }
      return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
    }
  };
}

function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    renameSync(tempPath, filePath);
  } catch {
    // Fallback on Windows when destination is momentarily held by AV/indexer
    writeFileSync(filePath, content, 'utf8');
  }
}

export class AppStore {
  private readonly configPath: string;
  private readonly secretsPath: string;
  private readonly cipher?: SecretCipher;
  private config: PersistedConfig;
  private secrets: Record<string, string>;

  private migratedOnLoad = false;

  constructor(dataDir: string, cipher?: SecretCipher) {
    mkdirSync(dataDir, { recursive: true });
    this.configPath = path.join(dataDir, 'ai-tracker-config.json');
    this.secretsPath = path.join(dataDir, 'ai-tracker-secrets.json');
    this.cipher = cipher;
    this.config = this.loadConfig();
    this.secrets = this.loadSecrets();
    if (this.migratedOnLoad) {
      this.saveConfig();
    }
  }

  private migrateAccounts(rawAccounts: AccountConfig[]): AccountConfig[] {
    return rawAccounts.map((acc) => {
      const meta = PROVIDER_META[acc.provider];
      if (!meta || !acc.limits) return acc;
      const nextLimits = { ...acc.limits };
      let changed = false;
      if (!nextLimits.weeklyLimitValue || nextLimits.weeklyLimitValue <= 0) {
        nextLimits.weeklyLimitValue = meta.defaultWeeklyLimitValue;
        changed = true;
      }
      if (
        acc.provider === 'antigravity' &&
        nextLimits.rollingLimitMetric === 'steps' &&
        nextLimits.rollingLimitValue === 250
      ) {
        nextLimits.rollingLimitValue = meta.defaultLimitValue;
        changed = true;
      }
      if (!changed) return acc;
      this.migratedOnLoad = true;
      return { ...acc, limits: nextLimits };
    });
  }

  private loadConfig(): PersistedConfig {
    if (!existsSync(this.configPath)) {
      return {
        version: 1,
        settings: { ...DEFAULT_APP_SETTINGS },
        accounts: []
      };
    }

    try {
      const raw = readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedConfig>;
      const accounts = Array.isArray(parsed.accounts)
        ? this.migrateAccounts(parsed.accounts)
        : [];
      return {
        version: 1,
        settings: {
          ...DEFAULT_APP_SETTINGS,
          ...(parsed.settings ?? {})
        },
        accounts,
        windowBounds: parsed.windowBounds
      };
    } catch {
      return {
        version: 1,
        settings: { ...DEFAULT_APP_SETTINGS },
        accounts: []
      };
    }
  }

  private loadSecrets(): Record<string, string> {
    if (!existsSync(this.secretsPath)) return {};
    try {
      const raw = readFileSync(this.secretsPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private saveConfig(): void {
    atomicWriteFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private saveSecrets(): void {
    atomicWriteFileSync(this.secretsPath, JSON.stringify(this.secrets, null, 2));
  }

  getSettings(): AppSettings {
    return { ...this.config.settings };
  }

  updateSettings(partial: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...this.config.settings,
      ...partial
    };
    next.pollIntervalSeconds = Math.max(15, Math.min(3600, Math.round(next.pollIntervalSeconds)));
    next.opacity = Math.max(0.5, Math.min(1, Number(next.opacity)));
    this.config.settings = next;
    this.saveConfig();
    return this.getSettings();
  }

  getAccounts(): AccountConfig[] {
    return this.config.accounts.map((acc) => ({
      ...acc,
      hasSecretToken: Boolean(this.secrets[acc.id])
    }));
  }

  getAccount(id: string): AccountConfig | undefined {
    const found = this.config.accounts.find((a) => a.id === id);
    if (!found) return undefined;
    return {
      ...found,
      hasSecretToken: Boolean(this.secrets[found.id])
    };
  }

  saveAccount(account: AccountConfig): AccountConfig {
    const nowIso = new Date().toISOString();
    const sanitized: AccountConfig = {
      ...account,
      label: account.label.trim() || 'Unnamed Account',
      profileDir: account.profileDir.trim(),
      hasSecretToken: Boolean(this.secrets[account.id]),
      createdAt: account.createdAt || nowIso,
      updatedAt: nowIso
    };

    const idx = this.config.accounts.findIndex((a) => a.id === sanitized.id);
    if (idx >= 0) {
      this.config.accounts[idx] = sanitized;
    } else {
      this.config.accounts.push(sanitized);
    }
    this.saveConfig();
    return { ...sanitized };
  }

  deleteAccount(id: string): void {
    this.config.accounts = this.config.accounts.filter((a) => a.id !== id);
    if (this.secrets[id]) {
      delete this.secrets[id];
      this.saveSecrets();
    }
    this.saveConfig();
  }

  setAccountSecret(id: string, plaintext: string): void {
    const trimmed = plaintext.trim();
    if (!trimmed) {
      this.clearAccountSecret(id);
      return;
    }
    if (!this.cipher) {
      throw new Error('No secret cipher configured.');
    }
    this.secrets[id] = this.cipher.encrypt(trimmed);
    this.saveSecrets();
    const acc = this.config.accounts.find((a) => a.id === id);
    if (acc) {
      acc.hasSecretToken = true;
      this.saveConfig();
    }
  }

  getAccountSecret(id: string): string | null {
    const ciphertext = this.secrets[id];
    if (!ciphertext || !this.cipher) return null;
    try {
      return this.cipher.decrypt(ciphertext);
    } catch {
      return null;
    }
  }

  clearAccountSecret(id: string): void {
    if (this.secrets[id]) {
      delete this.secrets[id];
      this.saveSecrets();
    }
    const acc = this.config.accounts.find((a) => a.id === id);
    if (acc) {
      acc.hasSecretToken = false;
      this.saveConfig();
    }
  }

  getWindowBounds(): WindowBounds | undefined {
    return this.config.windowBounds ? { ...this.config.windowBounds } : undefined;
  }

  setWindowBounds(bounds: WindowBounds): void {
    this.config.windowBounds = { ...bounds };
    this.saveConfig();
  }

  exportSanitizedJson(): string {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      accounts: this.config.accounts.map((acc) => ({
        ...acc,
        hasSecretToken: false
      }))
    };
    return JSON.stringify(payload, null, 2);
  }

  importSanitizedJson(rawJson: string): { importedAccounts: number; settings: AppSettings } {
    const parsed = JSON.parse(rawJson) as Partial<PersistedConfig>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON configuration payload.');
    }

    if (parsed.settings && typeof parsed.settings === 'object') {
      this.updateSettings(parsed.settings);
    }

    let importedAccounts = 0;
    if (Array.isArray(parsed.accounts)) {
      for (const item of parsed.accounts) {
        if (!item || typeof item !== 'object' || !item.id || !item.provider) continue;
        this.saveAccount({
          ...item,
          hasSecretToken: Boolean(this.secrets[item.id])
        });
        importedAccounts += 1;
      }
    }

    return {
      importedAccounts,
      settings: this.getSettings()
    };
  }
}
