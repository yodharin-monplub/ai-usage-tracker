import { promises as fs } from 'node:fs';
import path from 'node:path';
import { clampPercent } from '../../shared/formatters';
import {
  PROVIDER_META,
  type AccountConfig,
  type AccountUsageSnapshot,
  type ManualQuotaPool,
  type ProviderId,
  type QuotaWindow,
  type UsageMetrics,
  type UsageSource
} from '../../shared/types';

export interface ProviderContext {
  nowMs: number;
  getSecret: (accountId: string) => string | null;
  fetchFn?: typeof fetch;
}

export interface UsageProviderAdapter {
  readonly provider: ProviderId;
  collect(account: AccountConfig, ctx: ProviderContext): Promise<AccountUsageSnapshot>;
}

export interface LiveQuotaResult {
  primaryQuota: QuotaWindow;
  secondaryQuota?: QuotaWindow;
  pools?: ManualQuotaPool[];
  fetchedAtMs: number;
}

interface RateLimitEntry {
  lastAttemptMs: number;
  blockedUntilMs: number;
  consecutive429s: number;
  cachedLive?: LiveQuotaResult;
  lastError?: string;
}

export class RateLimitGuard {
  private readonly minIntervalMs: number;
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(minIntervalMs = 5 * 60 * 1000) {
    this.minIntervalMs = minIntervalMs;
  }

  inspect(accountId: string, nowMs: number): {
    canFetch: boolean;
    rateLimited: boolean;
    blockedUntilMs: number;
    cachedLive?: LiveQuotaResult;
    lastError?: string;
  } {
    const entry = this.entries.get(accountId);
    if (!entry) {
      return { canFetch: true, rateLimited: false, blockedUntilMs: 0 };
    }

    if (nowMs < entry.blockedUntilMs) {
      return {
        canFetch: false,
        rateLimited: entry.consecutive429s > 0,
        blockedUntilMs: entry.blockedUntilMs,
        cachedLive: entry.cachedLive,
        lastError: entry.lastError
      };
    }

    if (nowMs - entry.lastAttemptMs < this.minIntervalMs) {
      return {
        canFetch: false,
        rateLimited: false,
        blockedUntilMs: entry.lastAttemptMs + this.minIntervalMs,
        cachedLive: entry.cachedLive,
        lastError: entry.lastError
      };
    }

    return {
      canFetch: true,
      rateLimited: false,
      blockedUntilMs: 0,
      cachedLive: entry.cachedLive
    };
  }

  recordSuccess(accountId: string, nowMs: number, result: LiveQuotaResult): void {
    this.entries.set(accountId, {
      lastAttemptMs: nowMs,
      blockedUntilMs: nowMs + this.minIntervalMs,
      consecutive429s: 0,
      cachedLive: result
    });
  }

  recordRateLimit(accountId: string, nowMs: number, retryAfterSec?: number): number {
    const prev = this.entries.get(accountId);
    const consecutive = (prev?.consecutive429s ?? 0) + 1;
    const expMinutes = Math.min(60, 5 * Math.pow(2, consecutive - 1));
    const backoffMs = Math.max(
      expMinutes * 60_000,
      retryAfterSec && Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 0
    );
    const blockedUntilMs = nowMs + backoffMs;
    this.entries.set(accountId, {
      lastAttemptMs: nowMs,
      blockedUntilMs,
      consecutive429s: consecutive,
      cachedLive: prev?.cachedLive,
      lastError: `HTTP 429 rate limited; cooling down until ${new Date(blockedUntilMs).toLocaleTimeString()}`
    });
    return blockedUntilMs;
  }

  recordError(accountId: string, nowMs: number, message: string): void {
    const prev = this.entries.get(accountId);
    this.entries.set(accountId, {
      lastAttemptMs: nowMs,
      blockedUntilMs: nowMs + 60_000,
      consecutive429s: prev?.consecutive429s ?? 0,
      cachedLive: prev?.cachedLive,
      lastError: message
    });
  }

  reset(accountId?: string): void {
    if (accountId) this.entries.delete(accountId);
    else this.entries.clear();
  }
}

interface CachedFileEntry<T> {
  mtimeMs: number;
  size: number;
  data: T;
}

export class FileParseCache<T> {
  private readonly cache = new Map<string, CachedFileEntry<T>>();

  async readOrParse(
    filePath: string,
    parser: (content: string, filePath: string) => T | Promise<T>
  ): Promise<T | null> {
    try {
      const st = await fs.stat(filePath);
      const cached = this.cache.get(filePath);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return cached.data;
      }
      const raw = await fs.readFile(filePath, 'utf8');
      const data = await parser(raw, filePath);
      this.cache.set(filePath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        data
      });
      return data;
    } catch {
      return null;
    }
  }
}

export async function walkFiles(
  rootDir: string,
  predicate: (filePath: string) => boolean,
  maxDepth = 5
): Promise<string[]> {
  const results: string[] = [];

  async function visit(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  await visit(rootDir, 0);
  return results;
}

export async function readJsonFileSafe<T = Record<string, unknown>>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createEmptyMetrics(): UsageMetrics {
  return {
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
  };
}

export function getStartOfLocalDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const MIN_VALID_TIMESTAMP_MS = 946_684_800_000; // 2000-01-01T00:00:00Z

export function parseTimestampMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 10_000_000_000 ? raw * 1000 : raw;
    return ms >= MIN_VALID_TIMESTAMP_MS ? ms : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = num < 10_000_000_000 ? num * 1000 : num;
      return ms >= MIN_VALID_TIMESTAMP_MS ? ms : null;
    }
    let normalized = trimmed;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(normalized)) {
      normalized = normalized.replace(' ', 'T');
    }
    // Truncate >3 sub-millisecond digits (e.g. Go/SQLite 7-digit nanoseconds)
    normalized = normalized.replace(/(\.\d{3})\d+/, '$1');
    // Strip optional Go monotonic clock reading
    normalized = normalized.replace(/\s+m=[+-].*$/, '');
    // Append Z only if no timezone designator is present
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) {
      normalized += 'Z';
    }
    const ms = Date.parse(normalized);
    if (Number.isNaN(ms) || ms < MIN_VALID_TIMESTAMP_MS) return null;
    return ms;
  }
  return null;
}

export function buildQuotaWindow(
  label: string,
  usedPercent: number,
  resetAtIso?: string,
  windowHours?: number
): QuotaWindow {
  const clamped = clampPercent(usedPercent);
  return {
    label,
    usedPercent: clamped,
    remainingPercent: clampPercent(100 - clamped),
    resetAtIso,
    windowHours
  };
}

export function isManualSnapshotActive(account: AccountConfig, nowMs: number): boolean {
  const snap = account.manualSnapshot;
  if (!snap) return false;
  if (!snap.resetAtIso) return true;
  const resetMs = Date.parse(snap.resetAtIso);
  return Number.isNaN(resetMs) || resetMs > nowMs;
}

export interface LocalResetHints {
  rollingResetAtIso?: string;
  weeklyResetAtIso?: string;
}

export function resolveQuotas(
  account: AccountConfig,
  metrics: UsageMetrics,
  liveResult: LiveQuotaResult | undefined,
  embeddedQuota: { primary?: QuotaWindow; secondary?: QuotaWindow } | undefined,
  nowMs: number,
  hasLocalData: boolean,
  localResets?: LocalResetHints
): {
  primaryQuota: QuotaWindow;
  secondaryQuota: QuotaWindow;
  pools?: ManualQuotaPool[];
  sourceUsed: UsageSource;
} {
  const weeklyLimit =
    account.limits.weeklyLimitValue && account.limits.weeklyLimitValue > 0
      ? account.limits.weeklyLimitValue
      : PROVIDER_META[account.provider].defaultWeeklyLimitValue;
  const weeklyVal =
    account.limits.rollingLimitMetric === 'cost_usd'
      ? metrics.weekCostUsd
      : account.limits.rollingLimitMetric === 'requests'
        ? metrics.weekRequests
        : account.limits.rollingLimitMetric === 'steps'
          ? metrics.weekSteps
          : metrics.weekTokens;
  const localSecondary = buildQuotaWindow(
    '7d Weekly Est.',
    weeklyLimit > 0 ? clampPercent((weeklyVal / weeklyLimit) * 100) : 0,
    localResets?.weeklyResetAtIso,
    168
  );

  if (liveResult) {
    return {
      primaryQuota: liveResult.primaryQuota,
      secondaryQuota: liveResult.secondaryQuota ?? localSecondary,
      pools: liveResult.pools,
      sourceUsed: hasLocalData ? 'hybrid' : 'live'
    };
  }

  if (isManualSnapshotActive(account, nowMs) && account.manualSnapshot) {
    const snap = account.manualSnapshot;
    const primaryQuota = buildQuotaWindow(
      snap.label || `${account.limits.rollingWindowHours}h Snapshot`,
      snap.usedPercent,
      snap.resetAtIso,
      account.limits.rollingWindowHours
    );
    const secondaryQuota =
      typeof snap.secondaryUsedPercent === 'number'
        ? buildQuotaWindow(
            snap.secondaryLabel || '7d Weekly Quota',
            snap.secondaryUsedPercent,
            snap.secondaryResetAtIso ?? localResets?.weeklyResetAtIso,
            168
          )
        : localSecondary;
    return {
      primaryQuota,
      secondaryQuota,
      pools: snap.pools,
      sourceUsed: hasLocalData ? 'hybrid' : 'manual'
    };
  }

  if (embeddedQuota?.primary) {
    return {
      primaryQuota: embeddedQuota.primary,
      secondaryQuota: embeddedQuota.secondary ?? localSecondary,
      sourceUsed: 'local'
    };
  }

  let currentValue = 0;
  switch (account.limits.rollingLimitMetric) {
    case 'tokens':
      currentValue = metrics.rollingTokens;
      break;
    case 'cost_usd':
      currentValue = metrics.rollingCostUsd;
      break;
    case 'requests':
      currentValue = metrics.rollingRequests;
      break;
    case 'steps':
      currentValue = metrics.rollingSteps;
      break;
  }

  const limit = account.limits.rollingLimitValue;
  const pct = limit > 0 ? clampPercent((currentValue / limit) * 100) : 0;
  const primaryQuota = buildQuotaWindow(
    `${account.limits.rollingWindowHours}h Local Est.`,
    pct,
    localResets?.rollingResetAtIso,
    account.limits.rollingWindowHours
  );

  return {
    primaryQuota,
    secondaryQuota: localSecondary,
    sourceUsed: 'local'
  };
}
