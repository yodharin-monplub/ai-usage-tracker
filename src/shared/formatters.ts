export type QuotaSeverity = 'healthy' | 'warning' | 'critical';

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function formatTokens(tokens: number): string {
  const safe = Math.max(0, Number.isFinite(tokens) ? tokens : 0);
  if (safe >= 1_000_000_000) return `${(safe / 1_000_000_000).toFixed(2)}B`;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`;
  return `${Math.round(safe)}`;
}

export function formatUsd(usd: number): string {
  const safe = Math.max(0, Number.isFinite(usd) ? usd : 0);
  if (safe >= 100) return `$${safe.toFixed(0)}`;
  if (safe >= 10) return `$${safe.toFixed(1)}`;
  return `$${safe.toFixed(2)}`;
}

export function formatCountdown(resetAtIso?: string, nowMs = Date.now()): string {
  if (!resetAtIso) return '';
  const targetMs = Date.parse(resetAtIso);
  if (Number.isNaN(targetMs)) return '';

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return 'Resetting';

  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  const secs = Math.max(1, Math.floor(diffMs / 1000));
  return `${secs}s`;
}

export function formatResetDate(resetAtIso?: string): string {
  if (!resetAtIso) return '';
  const targetMs = Date.parse(resetAtIso);
  if (Number.isNaN(targetMs)) return '';
  return new Date(targetMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export function formatResetLabel(resetAtIso?: string, nowMs = Date.now()): string {
  if (!resetAtIso) return '';
  const targetMs = Date.parse(resetAtIso);
  if (Number.isNaN(targetMs)) return '';
  if (targetMs <= nowMs) return 'Resetting soon';
  const dateStr = formatResetDate(resetAtIso);
  const countdown = formatCountdown(resetAtIso, nowMs);
  return dateStr && countdown ? `Resets ${dateStr} (${countdown})` : countdown || dateStr;
}

export function formatRelativeAge(iso?: string, nowMs = Date.now()): string {
  if (!iso) return 'Never';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'Unknown';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function getQuotaSeverity(usedPercent: number): QuotaSeverity {
  if (usedPercent >= 85) return 'critical';
  if (usedPercent >= 65) return 'warning';
  return 'healthy';
}
