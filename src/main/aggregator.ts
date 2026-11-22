import { formatCountdown } from '../shared/formatters';
import type { AccountConfig, AccountUsageSnapshot, ProviderId } from '../shared/types';
import type { AppStore } from './store';
import { AntigravityProvider } from './providers/antigravityProvider';
import type { ProviderContext, UsageProviderAdapter } from './providers/base';
import { ClaudeCodeProvider } from './providers/claudeCodeProvider';
import { CodexProvider } from './providers/codexProvider';
import { GeminiProvider } from './providers/geminiProvider';

export class UsageAggregator {
  private readonly store: AppStore;
  private readonly adapters: Record<ProviderId, UsageProviderAdapter>;
  private readonly snapshots = new Map<string, AccountUsageSnapshot>();
  private readonly listeners = new Set<(snapshots: Record<string, AccountUsageSnapshot>) => void>();
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;

  constructor(store: AppStore) {
    this.store = store;
    this.adapters = {
      'claude-code': new ClaudeCodeProvider(),
      antigravity: new AntigravityProvider(),
      gemini: new GeminiProvider(),
      codex: new CodexProvider()
    };
  }

  onUpdated(cb: (snapshots: Record<string, AccountUsageSnapshot>) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const record = this.getAllSnapshots();
    for (const cb of this.listeners) {
      try {
        cb(record);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  getAllSnapshots(): Record<string, AccountUsageSnapshot> {
    const out: Record<string, AccountUsageSnapshot> = {};
    for (const [k, v] of this.snapshots.entries()) {
      out[k] = v;
    }
    return out;
  }

  private buildContext(nowMs = Date.now()): ProviderContext {
    return {
      nowMs,
      getSecret: (accountId) => this.store.getAccountSecret(accountId)
    };
  }

  private async collectAccount(
    account: AccountConfig,
    ctx: ProviderContext
  ): Promise<AccountUsageSnapshot> {
    const adapter = this.adapters[account.provider];
    try {
      return await adapter.collect(account, ctx);
    } catch (err) {
      return {
        accountId: account.id,
        provider: account.provider,
        fetchedAt: new Date(ctx.nowMs).toISOString(),
        sourceUsed: 'local',
        primaryQuota: {
          label: `${account.limits.rollingWindowHours}h Window`,
          usedPercent: 0,
          remainingPercent: 100
        },
        metrics: {
          rollingTokens: 0,
          todayTokens: 0,
          weekTokens: 0,
          rollingRequests: 0,
          todayRequests: 0,
          weekRequests: 0,
          rollingSteps: 0,
          todaySteps: 0,
          weekSteps: 0,
          rollingCostUsd: 0,
          todayCostUsd: 0,
          weekCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        },
        modelBreakdown: [],
        status: 'error',
        statusMessage: err instanceof Error ? err.message : 'Unexpected provider error'
      };
    }
  }

  async refreshOne(accountId: string): Promise<AccountUsageSnapshot | null> {
    const account = this.store.getAccount(accountId);
    if (!account) {
      this.snapshots.delete(accountId);
      this.emit();
      return null;
    }

    const snap = await this.collectAccount(account, this.buildContext());
    this.snapshots.set(account.id, snap);
    this.emit();
    return snap;
  }

  async refreshAll(): Promise<Record<string, AccountUsageSnapshot>> {
    if (this.refreshing) {
      return this.getAllSnapshots();
    }

    this.refreshing = true;
    try {
      const accounts = this.store.getAccounts();
      const activeIds = new Set(accounts.map((a) => a.id));
      for (const existingId of Array.from(this.snapshots.keys())) {
        if (!activeIds.has(existingId)) {
          this.snapshots.delete(existingId);
        }
      }

      const enabled = accounts.filter((a) => a.enabled);
      const ctx = this.buildContext();
      const results = await Promise.allSettled(
        enabled.map((acc) => this.collectAccount(acc, ctx))
      );

      for (const res of results) {
        if (res.status === 'fulfilled') {
          this.snapshots.set(res.value.accountId, res.value);
        }
      }

      this.emit();
      return this.getAllSnapshots();
    } finally {
      this.refreshing = false;
    }
  }

  removeAccount(accountId: string): void {
    this.snapshots.delete(accountId);
    this.emit();
  }

  start(intervalSeconds: number): void {
    this.stop();
    const ms = Math.max(15, intervalSeconds) * 1000;
    this.timer = setInterval(() => {
      void this.refreshAll();
    }, ms);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  buildTrayTooltip(): string {
    const accounts = this.store.getAccounts().filter((a) => a.enabled);
    if (accounts.length === 0) {
      return 'AI Tracker — No accounts configured';
    }
    const parts: string[] = [];
    for (const acc of accounts.slice(0, 3)) {
      const snap = this.snapshots.get(acc.id);
      if (!snap) continue;
      const reset = formatCountdown(snap.primaryQuota.resetAtIso);
      const line = `${acc.label.slice(0, 14)}: ${Math.round(snap.primaryQuota.usedPercent)}%${reset ? ` (${reset})` : ''}`;
      parts.push(line);
    }
    if (parts.length === 0) return `AI Tracker (${accounts.length} accounts)`;
    const joined = `AI Tracker\n${parts.join('\n')}`;
    // Windows tray tooltip limit is 127 chars
    return joined.length > 125 ? `${joined.slice(0, 122)}...` : joined;
  }
}
