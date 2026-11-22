import { describe, expect, it } from 'vitest';
import { parseUsageSnapshotText } from '../src/shared/usageSnapshotParser';

describe('usageSnapshotParser', () => {
  const nowMs = Date.parse('2026-11-22T12:00:00.000Z');

  it('parses Claude Code /usage output with primary session and weekly caps', () => {
    const raw = `
      Current session: 42% used (Resets in 2h 15m)
      Current week (all models): 18% used (Resets in 4d 3h)
    `;
    const parsed = parseUsageSnapshotText(raw, nowMs);
    expect(parsed).not.toBeNull();
    expect(parsed!.usedPercent).toBe(42);
    expect(parsed!.secondaryUsedPercent).toBe(18);
    expect(Date.parse(parsed!.resetAtIso!)).toBe(nowMs + (2 * 60 + 15) * 60_000);
    expect(Date.parse(parsed!.secondaryResetAtIso!)).toBe(
      nowMs + (4 * 24 + 3) * 3_600_000
    );
  });

  it('parses Antigravity /usage multi-pool output converting remaining % to used %', () => {
    const raw = `
      Gemini Models: 75% remaining (resets in 3h 20m)
      Claude / GPT Models: 40% used (resets in 1h 50m)
    `;
    const parsed = parseUsageSnapshotText(raw, nowMs);
    expect(parsed).not.toBeNull();
    expect(parsed!.pools).toHaveLength(2);
    expect(parsed!.pools[0]).toMatchObject({ name: 'Gemini Models', usedPercent: 25 });
    expect(parsed!.pools[1]).toMatchObject({ name: 'Claude / GPT Models', usedPercent: 40 });
    expect(parsed!.usedPercent).toBe(25);
  });

  it('parses Codex /status output with % remaining and % left', () => {
    const raw = `
      5h limit: 64% remaining (resets in 3h 10m)
      Weekly limit: 82% left (resets in 5d 12h)
    `;
    const parsed = parseUsageSnapshotText(raw, nowMs);
    expect(parsed).not.toBeNull();
    expect(parsed!.usedPercent).toBe(36);
    expect(parsed!.secondaryUsedPercent).toBe(18);
  });

  it('parses clock-based reset time and rejects non-quota text', () => {
    const parsed = parseUsageSnapshotText('Daily quota: 25% used (resets at 15:30)', nowMs);
    expect(parsed).not.toBeNull();
    expect(parsed!.usedPercent).toBe(25);
    expect(parsed!.resetAtIso).toBeDefined();

    expect(parseUsageSnapshotText('No numbers here at all', nowMs)).toBeNull();
  });

  it('parses multi-line Antigravity Models & Quota text with days/hours resets and pools', () => {
    const raw = `
      Gemini Models
      Weekly Limit Remaining
      You have used some of your weekly limit. It will fully refresh in 6 days, 19 hours.
      79%
      Five Hour Limit Remaining
      You have used some of your 5-hour limit. It will fully refresh in 4 hours, 12 minutes.
      85%
      Claude and GPT models
      Weekly Limit Remaining
      100%
      Five Hour Limit Remaining
      100%
      Gemini 4 Argon
      Gemini 4 Argon Weekly Limit
      You have used some of your weekly limit. It will fully refresh in 6 days, 22 hours.
      41%
    `;
    const parsed = parseUsageSnapshotText(raw, nowMs);
    expect(parsed).not.toBeNull();
    // Five Hour Limit Remaining = 85% -> 15% used
    expect(parsed!.usedPercent).toBe(15);
    expect(Date.parse(parsed!.resetAtIso!)).toBe(nowMs + (4 * 60 + 12) * 60_000);
    // Weekly Limit Remaining = 79% -> 21% used
    expect(parsed!.secondaryUsedPercent).toBe(21);
    expect(Date.parse(parsed!.secondaryResetAtIso!)).toBe(
      nowMs + (6 * 24 + 19) * 3_600_000
    );
    expect(parsed!.pools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Gemini Models', usedPercent: 21 }),
        expect.objectContaining({ name: 'Claude and GPT models', usedPercent: 0 }),
        expect.objectContaining({ name: 'Gemini 4 Argon', usedPercent: 59 })
      ])
    );
  });
});
