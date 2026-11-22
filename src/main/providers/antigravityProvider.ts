import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type {
  AccountConfig,
  AccountUsageSnapshot,
  ModelUsageItem
} from '../../shared/types';
import {
  FileParseCache,
  createEmptyMetrics,
  getStartOfLocalDayMs,
  parseTimestampMs,
  resolveQuotas,
  type ProviderContext,
  type UsageProviderAdapter
} from './base';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function resolveSqlWasmPath(): string {
  const candidates = [
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'sql-wasm.wasm'),
    path.join(__dirname, 'sql-wasm.wasm'),
    path.resolve(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(process.cwd(), 'dist-electron', 'sql-wasm.wasm'),
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

export async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      useOldExtensionFunctions: false,
      locateFile: () => resolveSqlWasmPath()
    });
  }
  return sqlJsPromise;
}

interface HistoryEvent {
  timestampMs: number;
  type: string;
}

function parseHistoryJsonl(content: string): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const ts = parseTimestampMs(obj.timestamp);
      if (ts === null) continue;
      events.push({
        timestampMs: ts,
        type: typeof obj.type === 'string' ? obj.type : 'prompt'
      });
    } catch {
      continue;
    }
  }
  return events;
}

interface ConversationSummaryRow {
  stepCount: number;
  modifiedMs: number;
  sourceLabel: string;
}

async function readConversationSummaries(dbPath: string): Promise<ConversationSummaryRow[]> {
  if (!existsSync(dbPath)) return [];
  const bytes = await fs.readFile(dbPath);
  const SQL = await getSqlJs();
  const db = new SQL.Database(new Uint8Array(bytes));
  try {
    const tableCheck = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'"
    );
    if (!tableCheck.length || !tableCheck[0].values.length) {
      return [];
    }

    const res = db.exec(
      'SELECT step_count, last_modified_time, last_user_input_time, agent_name, source FROM conversation_summaries'
    );
    if (!res.length) return [];

    const rows: ConversationSummaryRow[] = [];
    for (const row of res[0].values) {
      const stepCount = typeof row[0] === 'number' && row[0] > 0 ? row[0] : 0;
      const modifiedMs =
        parseTimestampMs(row[1]) ?? parseTimestampMs(row[2]) ?? null;
      if (modifiedMs === null) continue;

      const agentName = typeof row[3] === 'string' && row[3].trim() ? row[3].trim() : '';
      const source = typeof row[4] === 'string' && row[4].trim() ? row[4].trim() : '';
      const sourceLabel = agentName || source || 'antigravity-session';

      rows.push({
        stepCount,
        modifiedMs,
        sourceLabel
      });
    }
    return rows;
  } finally {
    db.close();
  }
}

export class AntigravityProvider implements UsageProviderAdapter {
  readonly provider = 'antigravity' as const;
  private readonly historyCache = new FileParseCache<HistoryEvent[]>();

  async collect(account: AccountConfig, ctx: ProviderContext): Promise<AccountUsageSnapshot> {
    const metrics = createEmptyMetrics();
    const bySource = new Map<string, ModelUsageItem>();
    let hasLocalData = false;
    let oldestRollingMs = Infinity;
    let oldestWeekMs = Infinity;

    const rollingStartMs = ctx.nowMs - account.limits.rollingWindowHours * 3_600_000;
    const todayStartMs = getStartOfLocalDayMs(ctx.nowMs);
    const weekStartMs = ctx.nowMs - 7 * 86_400_000;

    if (account.mode !== 'manual' && account.profileDir) {
      // 1. Read conversation_summaries.db safely into memory
      const dbPath = path.join(account.profileDir, 'conversation_summaries.db');
      try {
        const summaries = await readConversationSummaries(dbPath);
        for (const item of summaries) {
          if (item.modifiedMs > ctx.nowMs + 60_000 || item.modifiedMs < weekStartMs) {
            continue;
          }
          hasLocalData = true;
          metrics.weekSteps += item.stepCount;
          if (item.modifiedMs < oldestWeekMs) oldestWeekMs = item.modifiedMs;

          if (item.modifiedMs >= todayStartMs) {
            metrics.todaySteps += item.stepCount;
          }
          if (item.modifiedMs >= rollingStartMs) {
            metrics.rollingSteps += item.stepCount;
            if (item.modifiedMs < oldestRollingMs) oldestRollingMs = item.modifiedMs;
          }

          const prev = bySource.get(item.sourceLabel) ?? {
            model: item.sourceLabel,
            tokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheTokens: 0,
            requests: 0,
            costUsd: 0
          };
          prev.requests += 1;
          prev.tokens += item.stepCount;
          bySource.set(item.sourceLabel, prev);
        }
      } catch {
        // Ignore unreadable DB and continue to history.jsonl / manual snapshot
      }

      // 2. Read history.jsonl for exact prompt counts in rolling/today/7d windows
      const histPath = path.join(account.profileDir, 'history.jsonl');
      const historyEvents = await this.historyCache.readOrParse(histPath, parseHistoryJsonl);
      if (historyEvents) {
        for (const ev of historyEvents) {
          if (ev.timestampMs > ctx.nowMs + 60_000 || ev.timestampMs < weekStartMs) {
            continue;
          }
          hasLocalData = true;
          metrics.weekRequests += 1;
          if (ev.timestampMs < oldestWeekMs) oldestWeekMs = ev.timestampMs;

          if (ev.timestampMs >= todayStartMs) {
            metrics.todayRequests += 1;
          }
          if (ev.timestampMs >= rollingStartMs) {
            metrics.rollingRequests += 1;
            if (ev.timestampMs < oldestRollingMs) oldestRollingMs = ev.timestampMs;
          }
        }
      }

      // If conversation DB existed without history.jsonl, mirror active conversation count
      if (hasLocalData && metrics.weekRequests === 0) {
        let weekConv = 0;
        for (const item of bySource.values()) weekConv += item.requests;
        metrics.weekRequests = weekConv;
      }
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
      undefined,
      undefined,
      ctx.nowMs,
      hasLocalData,
      { rollingResetAtIso, weeklyResetAtIso }
    );

    const hasAnyData = hasLocalData || Boolean(account.manualSnapshot);
    const modelBreakdown = Array.from(bySource.values()).sort((a, b) => b.tokens - a.tokens);

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
      status: hasAnyData ? 'ok' : 'no-data',
      statusMessage: !hasAnyData
        ? `No Antigravity data found under ${account.profileDir || '(no folder set)'}`
        : undefined
    };
  }
}
