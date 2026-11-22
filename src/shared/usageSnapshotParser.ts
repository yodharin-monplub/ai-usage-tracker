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
  // Match explicit reset/refresh clauses first so "5-hour limit" is never misparsed
  const explicitClause = line.match(
    /(?:resets?|refresh(?:es)?)\s*(?:in|after)?\s+([^.\n()|]+)/i
  );
  const fallbackInClause = line.match(/\bin\s+([^.\n()|]+)/i);
  const candidate = explicitClause?.[1] ?? fallbackInClause?.[1] ?? line;

  // Reject hyphenated durations like "5-hour" when no explicit reset/refresh/in clause matched
  if (!explicitClause && !fallbackInClause && /\d+\s*-\s*(?:hour|day|min)/i.test(line)) {
    return null;
  }

  const days = candidate.match(/\b(\d+)\s*d(?:ays?)?\b/i);
  const hours = candidate.match(/\b(\d+)\s*h(?:ours?|rs?)?\b/i);
  const mins = candidate.match(/\b(\d+)\s*m(?:in(?:utes?)?)?\b/i);
  const secs = candidate.match(/\b(\d+)\s*s(?:ec(?:onds?)?)?\b/i);

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
  const isoMatch = line.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/
  );
  if (isoMatch) {
    const parsed = Date.parse(isoMatch[0]);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const clockMatch = line.match(
    /(?:resets?(?:\s+at)?\s*)(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
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

function extractPercentUsed(line: string, fallbackRemaining: boolean | null = null): number | null {
  const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!pctMatch) return null;

  const value = Number(pctMatch[1]);
  if (!Number.isFinite(value)) return null;

  const lower = line.toLowerCase();
  const hasExplicitUsed = /\bused\b/.test(lower);
  const hasExplicitRem = /\b(remaining|left|available)\b/.test(lower);
  const isRemaining = hasExplicitRem
    ? !hasExplicitUsed
    : hasExplicitUsed
      ? false
      : Boolean(fallbackRemaining);

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

function isFiveHourLine(line: string): boolean {
  return /\b(five\s*hour|5-?hour|5h|current\s*session|session)\b/i.test(line);
}

function isPoolLine(line: string): boolean {
  return (
    /\b(gemini|claude|gpt|codex|opus|sonnet|haiku|flash|pro|argon|neon|pool|models)\b/i.test(
      line
    ) && !/\b(all models|current session|current week|weekly limit|5h limit)\b/i.test(line)
  );
}

function isDescriptiveSentence(line: string): boolean {
  return /\b(you have used|will fully refresh|resets? in|resets? at)\b/i.test(line);
}

function isWindowHeading(line: string): boolean {
  return (
    !isDescriptiveSentence(line) &&
    /\b(weekly|five\s*hour|5-?hour|5h|session|daily|limit|remaining|quota)\b/i.test(line)
  );
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
  const poolsByName = new Map<string, ManualQuotaPool>();

  // Multi-line block state (supports Antigravity Models & Quota copy-paste)
  let currentSection = '';
  let pendingWindowLabel = '';
  let pendingIsRemaining: boolean | null = null;
  let blockHasRemainingStyle = false;
  let pendingResetIso: string | undefined;
  let pendingIsSecondary = false;
  let pendingIsFiveHour = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hasPct = /(\d+(?:\.\d+)?)\s*%/.test(line);

    if (!hasPct) {
      const resetIso = extractResetIso(line, nowMs);
      if (resetIso) {
        pendingResetIso = resetIso;
      }
      if (/\b(remaining|fully refresh)\b/i.test(line) && !/\b\d+%\s*used\b/i.test(line)) {
        blockHasRemainingStyle = true;
        if (pendingIsRemaining === null) pendingIsRemaining = true;
      }

      if (isWindowHeading(line)) {
        pendingWindowLabel = line.replace(/[:\-–—|\s]+$/g, '').trim();
        const hasRem = /\b(remaining|left|available)\b/i.test(line);
        const hasUsed = /\bused\b/i.test(line);
        if (hasRem && !hasUsed) {
          pendingIsRemaining = true;
          blockHasRemainingStyle = true;
        } else if (hasUsed) {
          pendingIsRemaining = false;
        } else {
          pendingIsRemaining = blockHasRemainingStyle ? true : null;
        }
        pendingIsSecondary = isSecondaryLine(line);
        pendingIsFiveHour = isFiveHourLine(line);
        // Reset timestamp carried only from lines inside this window block
        if (!resetIso) {
          pendingResetIso = undefined;
        }
      } else if (!isDescriptiveSentence(line) && line.length <= 50) {
        currentSection = line.replace(/[:\-–—|\s]+$/g, '').trim();
        pendingWindowLabel = '';
        pendingIsRemaining = null;
        pendingResetIso = undefined;
        pendingIsSecondary = false;
        pendingIsFiveHour = false;
      }
      continue;
    }

    const isStandalonePct = /^\d+(?:\.\d+)?\s*%$/i.test(line);
    const usedPercent = extractPercentUsed(
      line,
      isStandalonePct ? pendingIsRemaining : null
    );
    if (usedPercent === null) continue;

    let resetAtIso = extractResetIso(line, nowMs) ?? pendingResetIso;
    if (!resetAtIso && i + 1 < lines.length && !/(\d+(?:\.\d+)?)\s*%/.test(lines[i + 1])) {
      resetAtIso = extractResetIso(lines[i + 1], nowMs);
    }

    const label = isStandalonePct
      ? pendingWindowLabel || currentSection || 'Rolling Quota'
      : extractLabel(line);
    const lineIsSec = isStandalonePct ? pendingIsSecondary : isSecondaryLine(line);
    const lineIs5h = isStandalonePct ? pendingIsFiveHour : isFiveHourLine(line);

    const poolCandidateName = isStandalonePct ? currentSection || label : label;
    if (isPoolLine(isStandalonePct ? poolCandidateName : line)) {
      const existingPool = poolsByName.get(poolCandidateName);
      if (!existingPool || usedPercent > existingPool.usedPercent) {
        poolsByName.set(poolCandidateName, {
          name: poolCandidateName,
          usedPercent,
          resetAtIso: resetAtIso ?? existingPool?.resetAtIso
        });
      }
    }

    const windowLabel =
      isStandalonePct && currentSection && pendingWindowLabel
        ? `${currentSection} · ${pendingWindowLabel.replace(/\s*Remaining$/i, '')}`
        : label;

    if (lineIsSec) {
      if (!secondary || (secondary.usedPercent === 0 && usedPercent > 0)) {
        secondary = { label: windowLabel, usedPercent, resetAtIso };
      }
    } else if (lineIs5h) {
      if (!primary || (primary.usedPercent === 0 && usedPercent > 0)) {
        primary = { label: windowLabel, usedPercent, resetAtIso };
      }
    } else if (!primary) {
      primary = { label: windowLabel, usedPercent, resetAtIso };
    } else if (!secondary && !isPoolLine(line)) {
      secondary = { label: windowLabel, usedPercent, resetAtIso };
    }

    if (isStandalonePct) {
      pendingResetIso = undefined;
    }
  }

  const pools = Array.from(poolsByName.values());

  if (!primary && pools.length > 0) {
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
