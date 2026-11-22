import type { ManualQuotaPool, ManualQuotaSnapshot } from './types';
import { clampPercent } from './formatters';

export interface ParsedUsageSnapshot {
  usedPercent: number;
  label: string;
  resetAtIso?: string;
  secondaryUsedPercent?: number;
  secondaryLabel?: string;
  secondaryResetAtIso?: string;
  pools: ManualQuotaPool[];
}

function parseRelativeDurationMs(line: string): number | null {
  // Matches e.g. "resets in 2h 15m", "4d 3h", "45m", "1h 5m 20s"
  const afterReset = line.match(/(?:resets?\s*(?:in|after)?|in)\s+([^()|\n]+)/i);
  const candidate = afterReset ? afterReset[1] : line;

  const days = candidate.match(/(\d+)\s*d(?:ays?)?/i);
  const hours = candidate.match(/(\d+)\s*h(?:ours?|rs?)?/i);
  const mins = candidate.match(/(\d+)\s*m(?:in(?:utes?)?)?(?!\s*o)/i);
  const secs = candidate.match(/(\d+)\s*s(?:ec(?:onds?)?)?/i);

  if (!days && !hours && !mins && !secs) {
    return null;
  }

  const totalMs =
    (days ? Number(days[1]) * 86_400_000 : 0) +
    (hours ? Number(hours[1]) * 3_600_000 : 0) +
    (mins ? Number(mins[1]) * 60_000 : 0) +
    (secs ? Number(secs[1]) * 1000 : 0);

  return totalMs > 0 ? totalMs : null;
}

function parseClockTimeIso(line: string, nowMs: number): string | undefined {
  const isoMatch = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const clockMatch = line.match(/(?:resets?(?:\s+at)?\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const clock24Match = line.match(/(?:resets?\s+at\s+)(\d{1,2}):(\d{2})\b/i);

  let hour: number | null = null;
  let minute = 0;

  if (clockMatch) {
    hour = Number(clockMatch[1]);
    minute = clockMatch[2] ? Number(clockMatch[2]) : 0;
    const meridiem = clockMatch[3].toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (clock24Match) {
    hour = Number(clock24Match[1]);
    minute = Number(clock24Match[2]);
  }

  if (hour === null || hour > 23 || minute > 59) {
    return undefined;
  }

  const target = new Date(nowMs);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= nowMs) {
    target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
}

export function extractResetIso(line: string, nowMs = Date.now()): string | undefined {
  const relMs = parseRelativeDurationMs(line);
  if (relMs !== null) {
    return new Date(nowMs + relMs).toISOString();
  }
  return parseClockTimeIso(line, nowMs);
}

function extractPercentUsed(line: string): number | null {
  const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!pctMatch) return null;

  const value = Number(pctMatch[1]);
  if (!Number.isFinite(value)) return null;

  const lower = line.toLowerCase();
  const isRemaining =
    /\b(remaining|left|available)\b/.test(lower) && !/\bused\b/.test(lower);

  return clampPercent(isRemaining ? 100 - value : value);
}

function extractLabel(line: string): string {
  const cleaned = line
    .replace(/\(.*?\)/g, '')
    .replace(/(\d+(?:\.\d+)?)\s*%.*$/, '')
    .replace(/[:\-–—|\s]+$/g, '')
    .trim();
  return cleaned || 'Rolling Quota';
}

function isSecondaryLine(line: string): boolean {
  return /\b(week|weekly|7d|7-day|all models|sonnet only|monthly)\b/i.test(line);
}

function isPoolLine(line: string): boolean {
  return /\b(gemini|claude|gpt|codex|opus|sonnet|haiku|flash|pro|pool|models)\b/i.test(line) &&
    !/\b(all models|current session|current week|weekly limit|5h limit)\b/i.test(line);
}

export function parseUsageSnapshotText(
  rawText: string,
  nowMs = Date.now()
): ParsedUsageSnapshot | null {
  if (!rawText || !rawText.trim()) return null;

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let primary: { label: string; usedPercent: number; resetAtIso?: string } | null = null;
  let secondary: { label: string; usedPercent: number; resetAtIso?: string } | null = null;
  const pools: ManualQuotaPool[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const usedPercent = extractPercentUsed(line);
    if (usedPercent === null) continue;

    // Look at current line and immediate next line for reset countdown if not on current line
    let resetAtIso = extractResetIso(line, nowMs);
    if (!resetAtIso && i + 1 < lines.length && extractPercentUsed(lines[i + 1]) === null) {
      resetAtIso = extractResetIso(lines[i + 1], nowMs);
    }

    const label = extractLabel(line);

    if (isPoolLine(line)) {
      pools.push({ name: label, usedPercent, resetAtIso });
    }

    if (isSecondaryLine(line)) {
      if (!secondary) {
        secondary = { label, usedPercent, resetAtIso };
      }
      continue;
    }

    if (!primary) {
      primary = { label, usedPercent, resetAtIso };
    } else if (!secondary && !isPoolLine(line)) {
      secondary = { label, usedPercent, resetAtIso };
    }
  }

  if (!primary && pools.length > 0) {
    // Pick most-constrained model pool as primary pressure indicator
    const topPool = [...pools].sort((a, b) => b.usedPercent - a.usedPercent)[0];
    primary = {
      label: topPool.name,
      usedPercent: topPool.usedPercent,
      resetAtIso: topPool.resetAtIso
    };
  } else if (!primary && secondary) {
    primary = secondary;
    secondary = null;
  }

  if (!primary) return null;

  return {
    usedPercent: primary.usedPercent,
    label: primary.label,
    resetAtIso: primary.resetAtIso,
    secondaryUsedPercent: secondary?.usedPercent,
    secondaryLabel: secondary?.label,
    secondaryResetAtIso: secondary?.resetAtIso,
    pools
  };
}

export function toManualQuotaSnapshot(
  parsed: ParsedUsageSnapshot,
  rawText?: string,
  nowMs = Date.now()
): ManualQuotaSnapshot {
  return {
    usedPercent: parsed.usedPercent,
    label: parsed.label,
    resetAtIso: parsed.resetAtIso,
    secondaryUsedPercent: parsed.secondaryUsedPercent,
    secondaryLabel: parsed.secondaryLabel,
    secondaryResetAtIso: parsed.secondaryResetAtIso,
    pools: parsed.pools.length > 0 ? parsed.pools : undefined,
    updatedAtIso: new Date(nowMs).toISOString(),
    rawText
  };
}
