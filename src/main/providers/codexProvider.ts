import { promises as fs } from 'node:fs';
import path from 'node:path';
import { clampPercent } from '../../shared/formatters';
import { estimateCostUsd } from '../../shared/pricing';
import type {
  AccountConfig,
  AccountUsageSnapshot,
  ModelUsageItem,
  QuotaWindow
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

interface CodexTokenEvent {
  timestampMs: number;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  primaryRate?: QuotaWindow;
  secondaryRate?: QuotaWindow;
}

interface CodexParsedFile {
  events: CodexTokenEvent[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function parseRateWindow(raw: unknown, fallbackLabel: string): QuotaWindow | undefined {
  if (!isRecord(raw)) return undefined;
  const used =
    typeof raw.used_percent === 'number'
      ? raw.used_percent
      : typeof raw.usedPercent === 'number'
        ? raw.usedPercent
        : null;
  if (used === null) return undefined;

  const resetMs = parseTimestampMs(raw.resets_at ?? raw.reset_at);
  const windowMins = toNum(raw.window_minutes);
  const windowSecs = toNum(raw.limit_window_seconds);
  const windowHours =
    windowMins > 0 ? Math.round(windowMins / 60) : windowSecs > 0 ? Math.round(windowSecs / 3600) : undefined;

  return buildQuotaWindow(
    fallbackLabel,
    clampPercent(used),
    resetMs ? new Date(resetMs).toISOString() : undefined,
    windowHours
  );
}

function parseCodexRolloutJsonl(content: string): CodexParsedFile {
  const events: CodexTokenEvent[] = [];
  let currentModel = 'gpt-5-codex';
  let prevTotalInput = 0;
  let prevTotalCached = 0;
  let prevTotalOutput = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      obj = parsed;
    } catch {
      continue;
    }

    const payload = isRecord(obj.payload) ? obj.payload : obj;
    if (obj.type === 'turn_context' && typeof payload.model === 'string' && payload.model) {
      currentModel = payload.model;
      continue;
    }

    const isTokenCount =
      (obj.type === 'event_msg' && payload.type === 'token_count') ||
      obj.type === 'token_count';
    if (!isTokenCount) continue;

    const ts =
      parseTimestampMs(obj.timestamp) ?? parseTimestampMs(payload.timestamp);
    if (ts === null) continue;

    const info = isRecord(payload.info) ? payload.info : null;
    const lastUsage = isRecord(info?.last_token_usage) ? info.last_token_usage : null;
    const totalUsage = isRecord(info?.total_token_usage) ? info.total_token_usage : null;

    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;

    if (lastUsage) {
      inputTokens = toNum(lastUsage.input_tokens);
      cachedInputTokens = toNum(lastUsage.cached_input_tokens);
      outputTokens = toNum(lastUsage.output_tokens);
      if (totalUsage) {
        prevTotalInput = Math.max(prevTotalInput, toNum(totalUsage.input_tokens));
        prevTotalCached = Math.max(prevTotalCached, toNum(totalUsage.cached_input_tokens));
        prevTotalOutput = Math.max(prevTotalOutput, toNum(totalUsage.output_tokens));
      }
    } else if (totalUsage) {
      const totIn = toNum(totalUsage.input_tokens);
      const totCached = toNum(totalUsage.cached_input_tokens);
      const totOut = toNum(totalUsage.output_tokens);
      inputTokens = Math.max(0, totIn - prevTotalInput);
      cachedInputTokens = Math.max(0, totCached - prevTotalCached);
      outputTokens = Math.max(0, totOut - prevTotalOutput);
      prevTotalInput = Math.max(prevTotalInput, totIn);
      prevTotalCached = Math.max(prevTotalCached, totCached);
      prevTotalOutput = Math.max(prevTotalOutput, totOut);
    }

    const totalTokens = inputTokens + outputTokens;
    const rates = isRecord(payload.rate_limits) ? payload.rate_limits : null;
    const primaryRate = parseRateWindow(rates?.primary, '5h Limit');
    const secondaryRate = parseRateWindow(rates?.secondary, 'Weekly Limit');

    if (totalTokens > 0 || primaryRate || secondaryRate) {
      events.push({
        timestampMs: ts,
        model: typeof payload.model === 'string' && payload.model ? payload.model : currentModel,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens,
        primaryRate,
        secondaryRate
      });
    }
  }

  return { events };
}

export class CodexProvider implements UsageProviderAdapter {
  readonly provider = 'codex' as const;
  private readonly fileCache = new FileParseCache<CodexParsedFile>();
  private readonly rateGuard: RateLimitGuard;

  constructor(rateGuard = new RateLimitGuard()) {
    this.rateGuard = rateGuard;
  }

  private async resolveAuth(
    account: AccountConfig,
    ctx: ProviderContext
  ): Promise<{ token: string | null; accountId?: string }> {
    const secret = ctx.getSecret(account.id);
    if (secret) return { token: secret };
    if (!account.profileDir) return { token: null };

    const auth = await readJsonFileSafe<Record<string, unknown>>(
      path.join(account.profileDir, 'auth.json')
    );
    if (!auth) return { token: null };

    const tokens = isRecord(auth.tokens) ? auth.tokens : null;
    const token =
      (typeof tokens?.access_token === 'string' && tokens.access_token) ||
      (typeof auth.access_token === 'string' && auth.access_token) ||
      (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY) ||
      null;
    const accountId =
      typeof tokens?.account_id === 'string' ? tokens.account_id : undefined;
    return { token, accountId };
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

    const { token, accountId } = await this.resolveAuth(account, ctx);
    if (!token) {
      return {
        live: inspection.cachedLive,
        rateLimited: false,
        note: 'No Codex auth token found for live sync; showing local metrics.'
      };
    }

    const fetchImpl = ctx.fetchFn ?? fetch;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'ai-usage-tracker/0.1.0'
      };
      if (accountId) headers['ChatGPT-Account-Id'] = accountId;

      const response = await fetchImpl('https://chatgpt.com/backend-api/wham/usage', {
        method: 'GET',
        headers
      });

      if (response.status === 429) {
        const retryHeader = response.headers?.get?.('retry-after');
        const retrySec = retryHeader ? Number(retryHeader) : undefined;
        this.rateGuard.recordRateLimit(account.id, ctx.nowMs, retrySec);
        return {
          live: inspection.cachedLive,
          rateLimited: true,
          note: 'Codex wham/usage returned 429; backed off and showing fallback data.'
        };
      }

      if (!response.ok) {
        const msg = `Codex usage API returned HTTP ${response.status}`;
        this.rateGuard.recordError(account.id, ctx.nowMs, msg);
        return { live: inspection.cachedLive, rateLimited: false, note: msg };
      }

      const body = (await response.json()) as Record<string, unknown>;
      const rl = isRecord(body.rate_limit) ? body.rate_limit : null;
      const primary = parseRateWindow(rl?.primary_window, '5h Limit');
      const secondary = parseRateWindow(rl?.secondary_window, 'Weekly Limit');

      if (!primary) {
        const msg = 'Unexpected Codex wham/usage response.';
        this.rateGuard.recordError(account.id, ctx.nowMs, msg);
        return { live: inspection.cachedLive, rateLimited: false, note: msg };
      }

      const live: LiveQuotaResult = {
        primaryQuota: primary,
        secondaryQuota: secondary,
        fetchedAtMs: ctx.nowMs
      };
      this.rateGuard.recordSuccess(account.id, ctx.nowMs, live);
      return { live, rateLimited: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Codex usage request failed';
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
    let latestEmbeddedTs = 0;
    let embeddedPrimary: QuotaWindow | undefined;
    let embeddedSecondary: QuotaWindow | undefined;

    if (account.mode !== 'manual' && account.mode !== 'live-api' && account.profileDir) {
      const [sessionFiles, archivedFiles] = await Promise.all([
        walkFiles(path.join(account.profileDir, 'sessions'), (f) => f.endsWith('.jsonl'), 5),
        walkFiles(
          path.join(account.profileDir, 'archived_sessions'),
          (f) => f.endsWith('.jsonl'),
          5
        )
      ]);
      const allRollouts = [...sessionFiles, ...archivedFiles];

      const rollingStartMs = ctx.nowMs - account.limits.rollingWindowHours * 3_600_000;
      const todayStartMs = getStartOfLocalDayMs(ctx.nowMs);
      const weekStartMs = ctx.nowMs - 7 * 86_400_000;

      for (const file of allRollouts) {
        const parsed = await this.fileCache.readOrParse(file, parseCodexRolloutJsonl);
        if (!parsed) continue;

        for (const ev of parsed.events) {
          if (ev.timestampMs > ctx.nowMs + 60_000) continue;

          if (ev.primaryRate && ev.timestampMs >= latestEmbeddedTs) {
            latestEmbeddedTs = ev.timestampMs;
            embeddedPrimary = ev.primaryRate;
            embeddedSecondary = ev.secondaryRate;
          }

          if (ev.timestampMs < weekStartMs || ev.totalTokens <= 0) continue;
          hasLocalData = true;
          if (ev.timestampMs < oldestWeekMs) oldestWeekMs = ev.timestampMs;

          const nonCachedIn = Math.max(0, ev.inputTokens - ev.cachedInputTokens);
          const cost = estimateCostUsd(
            ev.model,
            nonCachedIn,
            ev.outputTokens,
            ev.cachedInputTokens,
            0
          );

          metrics.weekTokens += ev.totalTokens;
          metrics.weekRequests += 1;
          metrics.weekCostUsd += cost;
          metrics.inputTokens += ev.inputTokens;
          metrics.outputTokens += ev.outputTokens;
          metrics.cacheReadTokens += ev.cachedInputTokens;

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
          prev.cacheTokens += ev.cachedInputTokens;
          prev.requests += 1;
          prev.costUsd += cost;
          byModel.set(ev.model, prev);
        }
      }

      // Fallback: check session_index.jsonl when rollout logs aren't present
      if (!hasLocalData) {
        try {
          const indexPath = path.join(account.profileDir, 'session_index.jsonl');
          const raw = await fs.readFile(indexPath, 'utf8');
          for (const rawLine of raw.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const obj = JSON.parse(line) as Record<string, unknown>;
              const ts = parseTimestampMs(obj.updated_at);
              if (ts === null || ts > ctx.nowMs + 60_000 || ts < weekStartMs) continue;
              hasLocalData = true;
              metrics.weekRequests += 1;
              if (ts < oldestWeekMs) oldestWeekMs = ts;
              if (ts >= todayStartMs) metrics.todayRequests += 1;
              if (ts >= rollingStartMs) {
                metrics.rollingRequests += 1;
                if (ts < oldestRollingMs) oldestRollingMs = ts;
              }
            } catch {
              continue;
            }
          }
        } catch {
          // session_index.jsonl optional
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

    // Ignore stale embedded rate limits if window has already reset
    const embeddedActive =
      embeddedPrimary &&
      (!embeddedPrimary.resetAtIso || Date.parse(embeddedPrimary.resetAtIso) > ctx.nowMs)
        ? { primary: embeddedPrimary, secondary: embeddedSecondary }
        : undefined;

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
      embeddedActive,
      ctx.nowMs,
      hasLocalData,
      { rollingResetAtIso, weeklyResetAtIso }
    );

    const hasAnyData =
      hasLocalData ||
      Boolean(liveResult) ||
      Boolean(embeddedActive) ||
      Boolean(account.manualSnapshot);

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
          ? `No Codex session logs found under ${account.profileDir || '(no folder set)'}`
          : undefined)
    };
  }
}
