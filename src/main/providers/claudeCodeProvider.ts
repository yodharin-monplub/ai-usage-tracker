import path from 'node:path';
import { clampPercent } from '../../shared/formatters';
import { estimateCostUsd } from '../../shared/pricing';
import type {
  AccountConfig,
  AccountUsageSnapshot,
  ModelUsageItem
} from '../../shared/types';
import {
  FileParseCache,
  RateLimitGuard,
  buildQuotaWindow,
  createEmptyMetrics,
  getStartOfLocalDayMs,
  parseTimestampMs,
  readJsonFileSafe,
  resolveQuotas,
  walkFiles,
  type LiveQuotaResult,
  type ProviderContext,
  type UsageProviderAdapter
} from './base';

interface ClaudeParsedEvent {
  dedupKey: string;
  timestampMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function parseClaudeJsonl(content: string, filePath: string): ClaudeParsedEvent[] {
  const byKey = new Map<string, ClaudeParsedEvent>();
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      obj = parsed;
    } catch {
      continue;
    }

    const msg = isRecord(obj.message) ? obj.message : null;
    const usage = isRecord(msg?.usage)
      ? msg.usage
      : isRecord(obj.usage)
        ? obj.usage
        : null;
    if (!usage) continue;

    const inputTokens = toNum(usage.input_tokens);
    const outputTokens = toNum(usage.output_tokens);
    const cacheReadTokens = toNum(usage.cache_read_input_tokens);
    const cacheWriteTokens = toNum(usage.cache_creation_input_tokens);
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    if (totalTokens <= 0) continue;

    const ts =
      parseTimestampMs(obj.timestamp) ?? parseTimestampMs(msg?.timestamp);
    if (ts === null) continue;

    const model =
      typeof msg?.model === 'string' && msg.model
        ? msg.model
        : typeof obj.model === 'string' && obj.model
          ? obj.model
          : 'claude-unknown';

    const dedupKey =
      (typeof obj.requestId === 'string' && obj.requestId) ||
      (typeof msg?.id === 'string' && msg.id) ||
      (typeof obj.uuid === 'string' && obj.uuid) ||
      `${filePath}:${i}`;

    const existing = byKey.get(dedupKey);
    if (!existing || totalTokens > existing.totalTokens) {
      byKey.set(dedupKey, {
        dedupKey,
        timestampMs: ts,
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens
      });
    }
  }

  return Array.from(byKey.values());
}

export class ClaudeCodeProvider implements UsageProviderAdapter {
  readonly provider = 'claude-code' as const;
  private readonly fileCache = new FileParseCache<ClaudeParsedEvent[]>();
  private readonly rateGuard: RateLimitGuard;

  constructor(rateGuard = new RateLimitGuard()) {
    this.rateGuard = rateGuard;
  }

  private async resolveToken(account: AccountConfig, ctx: ProviderContext): Promise<string | null> {
    const secret = ctx.getSecret(account.id);
    if (secret) return secret;
    if (!account.profileDir) return null;

    const creds = await readJsonFileSafe<Record<string, unknown>>(
      path.join(account.profileDir, '.credentials.json')
    );
    if (!creds) return null;

    const oauth = isRecord(creds.claudeAiOauth) ? creds.claudeAiOauth : null;
    if (typeof oauth?.accessToken === 'string' && oauth.accessToken) {
      return oauth.accessToken;
    }
    if (typeof creds.accessToken === 'string' && creds.accessToken) {
      return creds.accessToken;
    }
    return null;
  }

  private async fetchLiveQuota(
    account: AccountConfig,
    ctx: ProviderContext
  ): Promise<{ live?: LiveQuotaResult; rateLimited: boolean; note?: string }> {
    const inspection = this.rateGuard.inspect(account.id, ctx.nowMs);
    if (!inspection.canFetch) {
      return {
        live: inspection.cachedLive,
        rateLimited: inspection.rateLimited,
        note: inspection.lastError
      };
    }

    const token = await this.resolveToken(account, ctx);
    if (!token) {
      return {
        live: inspection.cachedLive,
        rateLimited: false,
        note: 'No OAuth token configured for live Claude sync; showing local metrics.'
      };
    }

    const fetchImpl = ctx.fetchFn ?? fetch;
    try {
      const response = await fetchImpl('https://api.anthropic.com/api/oauth/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'ai-usage-tracker/0.1.0'
        }
      });

      if (response.status === 429) {
        const retryHeader = response.headers?.get?.('retry-after');
        const retrySec = retryHeader ? Number(retryHeader) : undefined;
        this.rateGuard.recordRateLimit(account.id, ctx.nowMs, retrySec);
        return {
          live: inspection.cachedLive,
          rateLimited: true,
          note: 'Claude OAuth usage API returned 429; backed off and showing fallback data.'
        };
      }

      if (!response.ok) {
        const msg = `Claude OAuth API returned HTTP ${response.status}`;
        this.rateGuard.recordError(account.id, ctx.nowMs, msg);
        return { live: inspection.cachedLive, rateLimited: false, note: msg };
      }

      const body = (await response.json()) as Record<string, unknown>;
      const fiveHour = isRecord(body.five_hour) ? body.five_hour : null;
      const sevenDay = isRecord(body.seven_day) ? body.seven_day : null;

      if (!fiveHour || typeof fiveHour.utilization !== 'number') {
        const msg = 'Unexpected Claude OAuth usage payload.';
        this.rateGuard.recordError(account.id, ctx.nowMs, msg);
        return { live: inspection.cachedLive, rateLimited: false, note: msg };
      }

      const live: LiveQuotaResult = {
        primaryQuota: buildQuotaWindow(
          '5h Session',
          clampPercent(fiveHour.utilization),
          typeof fiveHour.resets_at === 'string' ? fiveHour.resets_at : undefined,
          5
        ),
        secondaryQuota:
          sevenDay && typeof sevenDay.utilization === 'number'
            ? buildQuotaWindow(
                '7d Weekly',
                clampPercent(sevenDay.utilization),
                typeof sevenDay.resets_at === 'string' ? sevenDay.resets_at : undefined,
                168
              )
            : undefined,
        fetchedAtMs: ctx.nowMs
      };
      this.rateGuard.recordSuccess(account.id, ctx.nowMs, live);
      return { live, rateLimited: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Claude OAuth request failed';
      this.rateGuard.recordError(account.id, ctx.nowMs, msg);
      return { live: inspection.cachedLive, rateLimited: false, note: msg };
    }
  }

  async collect(account: AccountConfig, ctx: ProviderContext): Promise<AccountUsageSnapshot> {
    const metrics = createEmptyMetrics();
    const byModel = new Map<string, ModelUsageItem>();
    let hasLocalData = false;

    if (account.mode !== 'manual' && account.mode !== 'live-api' && account.profileDir) {
      const projectsDir = path.join(account.profileDir, 'projects');
      const files = await walkFiles(projectsDir, (f) => f.endsWith('.jsonl'), 4);

      const globalDedup = new Map<string, ClaudeParsedEvent>();
      for (const file of files) {
        const parsed = await this.fileCache.readOrParse(file, parseClaudeJsonl);
        if (!parsed) continue;
        for (const ev of parsed) {
          const existing = globalDedup.get(ev.dedupKey);
          if (!existing || ev.totalTokens > existing.totalTokens) {
            globalDedup.set(ev.dedupKey, ev);
          }
        }
      }

      const rollingStartMs = ctx.nowMs - account.limits.rollingWindowHours * 3_600_000;
      const todayStartMs = getStartOfLocalDayMs(ctx.nowMs);
      const weekStartMs = ctx.nowMs - 7 * 86_400_000;

      for (const ev of globalDedup.values()) {
        if (ev.timestampMs > ctx.nowMs + 60_000) continue;
        if (ev.timestampMs < weekStartMs) continue;

        hasLocalData = true;
        const cost = estimateCostUsd(
          ev.model,
          ev.inputTokens,
          ev.outputTokens,
          ev.cacheReadTokens,
          ev.cacheWriteTokens
        );

        metrics.weekTokens += ev.totalTokens;
        metrics.weekRequests += 1;
        metrics.weekCostUsd += cost;
        metrics.inputTokens += ev.inputTokens;
        metrics.outputTokens += ev.outputTokens;
        metrics.cacheReadTokens += ev.cacheReadTokens;
        metrics.cacheWriteTokens += ev.cacheWriteTokens;

        if (ev.timestampMs >= todayStartMs) {
          metrics.todayTokens += ev.totalTokens;
          metrics.todayRequests += 1;
          metrics.todayCostUsd += cost;
        }
        if (ev.timestampMs >= rollingStartMs) {
          metrics.rollingTokens += ev.totalTokens;
          metrics.rollingRequests += 1;
          metrics.rollingCostUsd += cost;
        }

        const prevModel = byModel.get(ev.model) ?? {
          model: ev.model,
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheTokens: 0,
          requests: 0,
          costUsd: 0
        };
        prevModel.tokens += ev.totalTokens;
        prevModel.inputTokens += ev.inputTokens;
        prevModel.outputTokens += ev.outputTokens;
        prevModel.cacheTokens += ev.cacheReadTokens + ev.cacheWriteTokens;
        prevModel.requests += 1;
        prevModel.costUsd += cost;
        byModel.set(ev.model, prevModel);
      }
    }

    let liveResult: LiveQuotaResult | undefined;
    let rateLimited = false;
    let liveNote: string | undefined;

    if (account.liveSyncEnabled && account.mode !== 'local-only' && account.mode !== 'manual') {
      const liveOutcome = await this.fetchLiveQuota(account, ctx);
      liveResult = liveOutcome.live;
      rateLimited = liveOutcome.rateLimited;
      liveNote = liveOutcome.note;
    }

    const resolved = resolveQuotas(
      account,
      metrics,
      liveResult,
      undefined,
      ctx.nowMs,
      hasLocalData
    );

    const hasAnyData =
      hasLocalData || Boolean(liveResult) || Boolean(account.manualSnapshot);

    const modelBreakdown = Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens);

    return {
      accountId: account.id,
      provider: this.provider,
      fetchedAt: new Date(ctx.nowMs).toISOString(),
      sourceUsed: resolved.sourceUsed,
      primaryQuota: resolved.primaryQuota,
      secondaryQuota: resolved.secondaryQuota,
      pools: resolved.pools,
      metrics,
      modelBreakdown,
      status: rateLimited ? 'rate-limited' : hasAnyData ? 'ok' : 'no-data',
      statusMessage:
        liveNote ??
        (!hasAnyData
          ? `No local JSONL logs found under ${account.profileDir || '(no folder set)'}`
          : undefined)
    };
  }
}
