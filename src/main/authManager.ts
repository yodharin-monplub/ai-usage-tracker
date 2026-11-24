import { BrowserWindow, session } from 'electron';
import {
  PROVIDER_META,
  type AccountConfig,
  type CredentialVerifyResult,
  type DirectAuthResult,
  type ProviderId,
  type QuotaWindow
} from '../shared/types';
import type { AppStore } from './store';

export function getAccountPartition(accountId: string): string {
  const safeId = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `persist:account-${safeId}`;
}

export interface AuthManagerOptions {
  store: AppStore;
  fetchFn?: typeof fetch;
  browserWindowConstructor?: typeof BrowserWindow;
  sessionGetter?: (partition: string) => Electron.Session;
}

export class AuthManager {
  private readonly store: AppStore;
  private readonly fetchFn: typeof fetch;
  private readonly winCtor: typeof BrowserWindow;
  private readonly getSession: (partition: string) => Electron.Session;
  private readonly activeWindows = new Map<string, BrowserWindow>();

  constructor(options: AuthManagerOptions) {
    this.store = options.store;
    this.fetchFn = options.fetchFn ?? fetch;
    this.winCtor = options.browserWindowConstructor ?? BrowserWindow;
    this.getSession = options.sessionGetter ?? ((p: string) => session.fromPartition(p));
  }

  getLoginUrl(provider: ProviderId): string {
    switch (provider) {
      case 'codex':
        return 'https://chatgpt.com/auth/login';
      case 'claude-code':
        return 'https://claude.ai/login';
      case 'gemini':
        return 'https://aistudio.google.com/';
      case 'antigravity':
        return 'https://accounts.google.com/ServiceLogin';
      default:
        return 'https://google.com';
    }
  }

  async verifyCredentials(
    provider: ProviderId,
    token: string
  ): Promise<CredentialVerifyResult> {
    const trimmed = token.trim();
    if (!trimmed) {
      return { valid: false, message: 'Token cannot be empty.' };
    }

    try {
      if (provider === 'claude-code') {
        if (trimmed.startsWith('sk-ant-')) {
          const res = await this.fetchFn('https://api.anthropic.com/v1/models', {
            method: 'GET',
            headers: {
              'x-api-key': trimmed,
              'anthropic-version': '2023-06-01'
            }
          });
          if (res.ok) {
            return {
              valid: true,
              message: 'Anthropic API key successfully verified.'
            };
          }
          return {
            valid: false,
            message: `Anthropic API returned HTTP ${res.status}: ${res.statusText}`
          };
        }

        const res = await this.fetchFn('https://api.anthropic.com/api/oauth/usage', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${trimmed}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'ai-usage-tracker/0.2.0'
          }
        });

        if (res.ok) {
          const body = (await res.json()) as Record<string, unknown>;
          const fiveHour = body.five_hour as Record<string, unknown> | undefined;
          const sevenDay = body.seven_day as Record<string, unknown> | undefined;
          let primary: QuotaWindow | undefined;
          let secondary: QuotaWindow | undefined;

          if (fiveHour && typeof fiveHour.utilization === 'number') {
            primary = {
              label: '5h Session',
              usedPercent: Math.round(fiveHour.utilization),
              remainingPercent: Math.max(0, 100 - Math.round(fiveHour.utilization)),
              resetAtIso: typeof fiveHour.resets_at === 'string' ? fiveHour.resets_at : undefined,
              windowHours: 5
            };
          }

          if (sevenDay && typeof sevenDay.utilization === 'number') {
            secondary = {
              label: '7d Weekly',
              usedPercent: Math.round(sevenDay.utilization),
              remainingPercent: Math.max(0, 100 - Math.round(sevenDay.utilization)),
              resetAtIso: typeof sevenDay.resets_at === 'string' ? sevenDay.resets_at : undefined,
              windowHours: 168
            };
          }

          return {
            valid: true,
            message: 'Claude OAuth usage token verified with live quotas.',
            primaryQuota: primary,
            secondaryQuota: secondary
          };
        }

        return {
          valid: false,
          message: `Claude OAuth API returned HTTP ${res.status}: ${res.statusText}`
        };
      }

      if (provider === 'codex') {
        const res = await this.fetchFn('https://chatgpt.com/backend-api/wham/usage', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${trimmed}`,
            'User-Agent': 'ai-usage-tracker/0.2.0'
          }
        });

        if (res.ok) {
          const body = (await res.json()) as Record<string, unknown>;
          const rl = body.rate_limit as Record<string, unknown> | undefined;
          const pri = rl?.primary_window as Record<string, unknown> | undefined;
          const sec = rl?.secondary_window as Record<string, unknown> | undefined;
          let primary: QuotaWindow | undefined;
          let secondary: QuotaWindow | undefined;

          if (pri && typeof pri.used_percent === 'number') {
            primary = {
              label: '5h Limit',
              usedPercent: Math.round(pri.used_percent),
              remainingPercent: Math.max(0, 100 - Math.round(pri.used_percent)),
              resetAtIso: typeof pri.resets_at === 'string' ? pri.resets_at : undefined,
              windowHours: 5
            };
          }

          if (sec && typeof sec.used_percent === 'number') {
            secondary = {
              label: 'Weekly Limit',
              usedPercent: Math.round(sec.used_percent),
              remainingPercent: Math.max(0, 100 - Math.round(sec.used_percent)),
              resetAtIso: typeof sec.resets_at === 'string' ? sec.resets_at : undefined,
              windowHours: 168
            };
          }

          return {
            valid: true,
            message: 'Codex / ChatGPT rate limits verified with live quotas.',
            primaryQuota: primary,
            secondaryQuota: secondary
          };
        }

        if (trimmed.startsWith('sk-')) {
          const oai = await this.fetchFn('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: { Authorization: `Bearer ${trimmed}` }
          });
          if (oai.ok) {
            return {
              valid: true,
              message: 'OpenAI API key successfully verified.'
            };
          }
        }

        return {
          valid: false,
          message: `Codex API returned HTTP ${res.status}: ${res.statusText}`
        };
      }

      if (provider === 'gemini') {
        if (trimmed.startsWith('AIza')) {
          const res = await this.fetchFn(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${trimmed}`,
            { method: 'GET' }
          );
          if (res.ok) {
            return {
              valid: true,
              message: 'Google Gemini API key successfully verified.'
            };
          }
          return {
            valid: false,
            message: `Gemini API returned HTTP ${res.status}: ${res.statusText}`
          };
        }

        const res = await this.fetchFn(
          'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${trimmed}`,
              'Content-Type': 'application/json',
              'User-Agent': 'ai-usage-tracker/0.2.0'
            },
            body: JSON.stringify({})
          }
        );

        if (res.ok) {
          return {
            valid: true,
            message: 'Google Cloud Code OAuth quota API verified.'
          };
        }

        return {
          valid: false,
          message: `Google Quota API returned HTTP ${res.status}: ${res.statusText}`
        };
      }

      if (provider === 'antigravity') {
        return {
          valid: true,
          message: 'Antigravity credentials registered.'
        };
      }

      return { valid: false, message: 'Unsupported provider for verification.' };
    } catch (err) {
      return {
        valid: false,
        message: err instanceof Error ? err.message : 'Network verification failed'
      };
    }
  }

  async startDirectLogin(
    accountId: string,
    provider: ProviderId
  ): Promise<DirectAuthResult> {
    const existingWin = this.activeWindows.get(accountId);
    if (existingWin && !existingWin.isDestroyed()) {
      existingWin.focus();
      return {
        success: false,
        provider,
        message: 'A sign-in window for this account is already open.'
      };
    }

    const partition = getAccountPartition(accountId);
    const ses = this.getSession(partition);
    const providerMeta = PROVIDER_META[provider];

    return new Promise<DirectAuthResult>((resolve) => {
      let settled = false;
      let checkInterval: NodeJS.Timeout | null = null;

      const safeResolve = (res: DirectAuthResult) => {
        if (settled) return;
        settled = true;
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
        this.activeWindows.delete(accountId);
        if (authWin && !authWin.isDestroyed()) {
          authWin.close();
        }
        resolve(res);
      };

      const authWin = new this.winCtor({
        width: 620,
        height: 780,
        title: `Sign In - ${providerMeta.name} (Isolated Session: ${accountId})`,
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      this.activeWindows.set(accountId, authWin);

      const targetUrl = this.getLoginUrl(provider);

      const checkForCompletion = async () => {
        if (settled || authWin.isDestroyed()) return;

        try {
          const currentUrl = authWin.webContents.getURL();

          if (provider === 'codex') {
            if (currentUrl.includes('chatgpt.com') && !currentUrl.includes('/auth/login') && !currentUrl.includes('/login')) {
              try {
                const data = (await authWin.webContents.executeJavaScript(
                  `(function() {
                    try {
                      return fetch('/api/auth/session').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
                    } catch (e) {
                      return null;
                    }
                  })()`
                )) as Record<string, unknown> | null;

                if (data && typeof data === 'object') {
                  const accessToken = typeof data.accessToken === 'string' ? data.accessToken : undefined;
                  const user = data.user as Record<string, unknown> | undefined;
                  const email = typeof user?.email === 'string' ? user.email : undefined;

                  if (accessToken) {
                    this.store.setAccountSecret(accountId, accessToken);
                    this.updateAccountDirectAuth(accountId, email, 'signed-in', partition);

                    safeResolve({
                      success: true,
                      token: accessToken,
                      email,
                      accountHint: email,
                      provider,
                      message: email ? `Successfully signed in as ${email}` : 'Successfully signed into ChatGPT/Codex'
                    });
                    return;
                  }
                }
              } catch {
                // Session endpoint check not ready yet
              }
            }
          }

          if (provider === 'claude-code') {
            if (currentUrl.includes('claude.ai') && !currentUrl.includes('/login')) {
              try {
                const cookies = await ses.cookies.get({ domain: '.claude.ai' });
                const sessionKeyCookie = cookies.find((c) => c.name === 'sessionKey');

                let email: string | undefined;
                try {
                  const uData = (await authWin.webContents.executeJavaScript(
                    `(function() {
                      try {
                        return fetch('/api/auth/current_user').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
                      } catch (e) {
                        return null;
                      }
                    })()`
                  )) as Record<string, unknown> | null;

                  if (uData && typeof uData.email_address === 'string') {
                    email = uData.email_address;
                  }
                } catch {
                  // User info endpoint optional
                }

                if (sessionKeyCookie?.value) {
                  this.store.setAccountSecret(accountId, sessionKeyCookie.value);
                  this.updateAccountDirectAuth(accountId, email, 'signed-in', partition);

                  safeResolve({
                    success: true,
                    token: sessionKeyCookie.value,
                    email,
                    accountHint: email,
                    provider,
                    message: email ? `Successfully signed in as ${email}` : 'Successfully signed into Claude'
                  });
                  return;
                }
              } catch {
                // Cookies check error
              }
            }
          }

          if (provider === 'gemini') {
            if (currentUrl.includes('aistudio.google.com') || currentUrl.includes('myaccount.google.com')) {
              try {
                const cookies = await ses.cookies.get({ domain: '.google.com' });
                const hasSsid = cookies.some((c) => c.name === 'SSID' || c.name === 'SID');

                if (hasSsid) {
                  let email: string | undefined;
                  const title = authWin.getTitle();
                  const match = title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                  if (match) email = match[1];

                  this.updateAccountDirectAuth(accountId, email, 'signed-in', partition);
                  safeResolve({
                    success: true,
                    email,
                    accountHint: email,
                    provider,
                    message: email ? `Google session authenticated for ${email}` : 'Google AI Studio session authenticated'
                  });
                  return;
                }
              } catch {
                // Gemini check error
              }
            }
          }

          if (provider === 'antigravity') {
            if (currentUrl.includes('myaccount.google.com') || currentUrl.includes('google.com')) {
              const cookies = await ses.cookies.get({ domain: '.google.com' });
              if (cookies.some((c) => c.name === 'SSID')) {
                let email: string | undefined;
                const match = authWin.getTitle().match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                if (match) email = match[1];

                this.updateAccountDirectAuth(accountId, email, 'signed-in', partition);
                safeResolve({
                  success: true,
                  email,
                  accountHint: email,
                  provider,
                  message: email ? `Antigravity session linked to ${email}` : 'Antigravity session authenticated'
                });
                return;
              }
            }
          }
        } catch {
          // Ignored during intermediate page navigations
        }
      };

      authWin.webContents.on('did-finish-load', () => {
        void checkForCompletion();
      });

      authWin.webContents.on('did-navigate', () => {
        void checkForCompletion();
      });

      checkInterval = setInterval(() => {
        void checkForCompletion();
      }, 2000);

      authWin.on('closed', () => {
        if (!settled) {
          safeResolve({
            success: false,
            provider,
            message: 'Sign-in window was closed before completing authentication.'
          });
        }
      });

      void authWin.loadURL(targetUrl);
    });
  }

  cancelDirectLogin(accountId: string): void {
    const win = this.activeWindows.get(accountId);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    this.activeWindows.delete(accountId);
  }

  async signOut(accountId: string): Promise<void> {
    this.cancelDirectLogin(accountId);
    const partition = getAccountPartition(accountId);
    try {
      const ses = this.getSession(partition);
      await ses.clearStorageData();
    } catch {
      // Partition storage clearance fallback
    }
    this.store.clearAccountSecret(accountId);
    const existing = this.store.getAccount(accountId);
    if (existing) {
      this.store.saveAccount({
        ...existing,
        hasSecretToken: false,
        directAuthStatus: 'signed-out',
        updatedAt: new Date().toISOString()
      });
    }
  }

  private updateAccountDirectAuth(
    accountId: string,
    email: string | undefined,
    status: 'signed-in' | 'expired' | 'signed-out',
    partition: string
  ): void {
    const existing = this.store.getAccount(accountId);
    if (existing) {
      const nowIso = new Date().toISOString();
      const updated: AccountConfig = {
        ...existing,
        authType: 'direct-signin',
        directAuthEmail: email ?? existing.directAuthEmail,
        directAuthStatus: status,
        directAuthAt: nowIso,
        accountHint: email ?? existing.accountHint,
        partitionId: partition,
        liveSyncEnabled: true,
        updatedAt: nowIso
      };
      this.store.saveAccount(updated);
    }
  }
}
