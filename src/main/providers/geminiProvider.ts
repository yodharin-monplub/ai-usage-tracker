import path from 'node:path';
import { clampPercent } from '../../shared/formatters';
import { estimateCostUsd } from '../../shared/pricing';
import type {
  AccountConfig,
  AccountUsageSnapshot,
  ManualQuotaPool,
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

interface GeminiTokenEvent {
  timestampMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function extractGeminiEvent(obj: Record<string, unknown>, fallbackTs: number | null): GeminiTokenEvent | null {
  const msg = isRecord(obj.message) ? obj.message : obj;
  const tokens = isRecord(msg.tokens)
    ? msg.tokens
    : isRecord(msg.usageMetadata)
      ? msg.usageMetadata
      : null;
  if (!tokens) return null;

  const inputTokens = toNum(tokens.input ?? tokens.promptTokenCount);
  const outputTokens = toNum(tokens.output ?? tokens.candidatesTokenCount);
  const cachedTokens = toNum(tokens.cached ?? tokens.cachedContentTokenCount);
  const thoughtsTokens = toNum(tokens.thoughts ?? tokens.thoughtsTokenCount);
  const explicitTotal = toNum(tokens.total ?? tokens.totalTokenCount);
  const totalTokens =
    explicitTotal > 0
      ? explicitTotal
      : inputTokens + outputTokens + cachedTokens + thoughtsTokens;

  if (totalTokens <= 0) return null;

  const ts =
    parseTimestampMs(msg.timestamp ?? obj.timestamp ?? obj.lastUpdated ?? obj.startTime) ??
    fallbackTs;
  if (ts === null) return null;

  const model =
    typeof msg.model === 'string' && msg.model
      ? msg.model
      : typeof obj.model === 'string' && obj.model
        ? obj.model
        : 'gemini-2.5-pro';

  return {
    timestampMs: ts,
    model,
    inputTokens,
    outputTokens: outputTokens + thoughtsTokens,
    cachedTokens,
    thoughtsTokens,
    totalTokens
  };
}

function parseGeminiChatFile(content: string, filePath: string): GeminiTokenEvent[] {
  const events: GeminiTokenEvent[] = [];

  if (filePath.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content);
      if (!isRecord(parsed)) return events;
      const fallbackTs = parseTimestampMs(parsed.lastUpdated ?? parsed.startTime);
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      for (const m of msgs) {
        if (!isRecord(m)) continue;
        const ev = extractGeminiEvent(m, fallbackTs);
        if (ev) events.push(ev);
      }
    } catch {
      return events;
    }
    return events;
  }

  // .jsonl format
  let headerTs: number | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      if (headerTs === null) {
        headerTs = parseTimestampMs(parsed.lastUpdated ?? parsed.startTime ?? parsed.timestamp);
      }
      const ev = extractGeminiEvent(parsed, headerTs);
      if (ev) events.push(ev);
    } catch {
      continue;
    }
  }
  return events;
}

export class GeminiProvider implements UsageProviderAdapter {
  readonly provider = 'gemini' as const;
  private readonly fileCache = new FileParseCache<GeminiTokenEvent[]>();
  private readonly rateGuard: RateLimitGuard;

  constructor(rateGuard = new RateLimitGuard()) {
    this.rateGuard = rateGuard;
  }

  private async resolveToken(account: AccountConfig, ctx: ProviderContext): Promise<string | null> {
    const secret = ctx.getSecret(account.id);
    if (secret) return secret;
    if (!account.profileDir) return null;

    const creds = await readJsonFileSafe<Record<string, unknown>>(
      path.join(account.profileDir, 'oauth_creds.json')
    );
    if (!creds) return null;
    if (typeof creds.access_token === 'string' && creds.access_token) {
      return creds.access_token;
    }
    if (typeof creds.token === 'string' && creds.token) {
      return creds.token;
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
        note: 'No Gemini OAuth token configured for live sync; showing local metrics.'
      };
    }

    const fetchImpl = ctx.fetchFn ?? fetch;
    try {
      const response = await fetchImpl(
        'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'ai-usage-tracker/0.1.0'
          },
          body: JSON.stringify({})
        }
      );

      if (response.status === 429) {
        const retryHeader = response.headers?.get?.('retry-after');
        const retrySec = retryHeader ? Number(retryHeader) : undefined;
        this.rateGuard.recordRateLimit(account.id, ctx.nowMs, retrySec);
        return {
          live: inspection.cachedLive,
          rateLimited: true,
          note: 'Gemini quota API returned 429; backed off and showing fallback data.'
        };
      }

      if (!response.ok) {
        const msg = `Gemini quota API returned HTTP ${response.status}`;
        this.rateGuard.recordError(account.id, ctx.nowMs, msg);
        return { live: inspection.cachedLive, rateLimited: false, note: msg };
      }

      const body = (await response.json()) as Record<string, unknown>;
      const rawBuckets = Array.isArray(body.buckets) ? body.buckets : [];
      const pools: ManualQuotaPool[] = [];

      for (const b of rawBuckets) {
        if (!isRecord(b)) continue;
        const remainingFrac =
          typeof b.remainingFraction === 'number' ? b.remainingFraction : null;
        if (remainingFrac === null) continue;
        const modelName =
          typeof b.modelId === 'string' && b.modelId ? b.modelId : 'Gemini Pool';
        pools.push({
          name: modelName,
          usedPercent: clampPercent((1 - remainingFrac) * 100),
          resetAtIso: typeof b.resetTime === 'string' ? b.resetTime : undefined
        });
      }

      if (pools.length === 0) {
        const msg = 'No quota buckets returned by Gemini quota API.';
        this.rateGuard.recordError(account.id, ctx.nowMs, msg);
        return { live: inspection.cachedLive, rateLimited: false, note: msg };
      }

      const topBucket = [...pools].sort((a, b) => b.usedPercent - a.usedPercent)[0];
      const live: LiveQuotaResult = {
        primaryQuota: buildQuotaWindow(
          topBucket.name,
          topBucket.usedPercent,
          topBucket.resetAtIso,
          24
        ),
        pools,
        fetchedAtMs: ctx.nowMs
      };
      this.rateGuard.recordSuccess(account.id, ctx.nowMs, live);
      return { live, rateLimited: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gemini quota request failed';
      this.rateGuard.recordError(account.id, ctx.nowMs, msg);
      return { live: inspection.cachedLive, rateLimited: false, note: msg };
    }
  }

  async collect(account: AccountConfig, ctx: ProviderContext): Promise<AccountUsageSnapshot> {
    const metrics = createEmptyMetrics();
    const byModel = new Map<string, ModelUsageItem>();
    let hasLocalData = false;
    let oldestRollingMs = Infinity;
    let oldestWeekMs = Infinity;

    if (account.mode !== 'manual' && account.mode !== 'live-api' && account.profileDir) {
      const tmpDir = path.join(account.profileDir, 'tmp');
      const files = await walkFiles(
        tmpDir,
        (f) =>
          (f.endsWith('.jsonl') || f.endsWith('.json')) &&
          f.toLowerCase().includes(`${path.sep}chats${path.sep}`),
        4
      );

      const rollingStartMs = ctx.nowMs - account.limits.rollingWindowHours * 3_600_000;
      const todayStartMs = getStartOfLocalDayMs(ctx.nowMs);
      const weekStartMs = ctx.nowMs - 7 * 86_400_000;

      for (const file of files) {
        const events = await this.fileCache.readOrParse(file, parseGeminiChatFile);
        if (!events) continue;

        for (const ev of events) {
          if (ev.timestampMs > ctx.nowMs + 60_000 || ev.timestampMs < weekStartMs) continue;
          hasLocalData = true;
          if (ev.timestampMs < oldestWeekMs) oldestWeekMs = ev.timestampMs;

          const nonCachedIn = Math.max(0, ev.inputTokens - ev.cachedTokens);
          const cost = estimateCostUsd(
            ev.model,
            nonCachedIn,
            ev.outputTokens,
            ev.cachedTokens,
            0
          );

          metrics.weekTokens += ev.totalTokens;
          metrics.weekRequests += 1;
          metrics.weekCostUsd += cost;
          metrics.inputTokens += ev.inputTokens;
          metrics.outputTokens += ev.outputTokens;
          metrics.cacheReadTokens += ev.cachedTokens;

          if (ev.timestampMs >= todayStartMs) {
            metrics.todayTokens += ev.totalTokens;
            metrics.todayRequests += 1;
            metrics.todayCostUsd += cost;
          }
          if (ev.timestampMs >= rollingStartMs) {
            metrics.rollingTokens += ev.totalTokens;
            metrics.rollingRequests += 1;
            metrics.rollingCostUsd += cost;
            if (ev.timestampMs < oldestRollingMs) oldestRollingMs = ev.timestampMs;
          }

          const prev = byModel.get(ev.model) ?? {
            model: ev.model,
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheTokens: 0,
            requests: 0,
            costUsd: 0
          };
          prev.tokens += ev.totalTokens;
          prev.inputTokens += ev.inputTokens;
          prev.outputTokens += ev.outputTokens;
          prev.cacheTokens += ev.cachedTokens;
          prev.requests += 1;
          prev.costUsd += cost;
          byModel.set(ev.model, prev);
        }
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

    const rollingResetAtIso =
      oldestRollingMs < Infinity
        ? new Date(oldestRollingMs + account.limits.rollingWindowHours * 3_600_000).toISOString()
        : undefined;
    const weeklyResetAtIso =
      oldestWeekMs < Infinity
        ? new Date(oldestWeekMs + 7 * 86_400_000).toISOString()
        : undefined;

    const resolved = resolveQuotas(
      account,
      metrics,
      liveResult,
      undefined,
      ctx.nowMs,
      hasLocalData,
      { rollingResetAtIso, weeklyResetAtIso }
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
          ? `No Gemini chat logs found under ${account.profileDir || '(no folder set)'}`
          : undefined)
    };
  }
}
