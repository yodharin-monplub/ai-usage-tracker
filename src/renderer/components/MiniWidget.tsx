import {
  ClipboardPaste,
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  ScanSearch
} from 'lucide-react';
import {
  formatCountdown,
  formatResetDate,
  formatTokens,
  formatUsd,
  getQuotaSeverity
} from '../../shared/formatters';
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  type AccountConfig,
  type AccountUsageSnapshot,
  type AppSettings
} from '../../shared/types';
import type { ProviderFilter } from '../App';

interface MiniWidgetProps {
  accounts: AccountConfig[];
  snapshots: Record<string, AccountUsageSnapshot>;
  settings: AppSettings;
  filter: ProviderFilter;
  refreshing: boolean;
  nowMs: number;
  onFilterChange: (next: ProviderFilter) => void;
  onRefreshAll: () => void;
  onRefreshOne: (id: string) => void;
  onTogglePinOnTop: () => void;
  onExpand: () => void;
  onHide: () => void;
  onAddAccount: () => void;
  onAutoDiscover: () => void;
  onOpenSnapshotModal: (account: AccountConfig) => void;
}

function summarizeToday(acc: AccountConfig, snap?: AccountUsageSnapshot): string {
  if (!snap) return 'Waiting for sync';
  const m = snap.metrics;
  if (acc.provider === 'antigravity') {
    if (m.todaySteps > 0 || m.rollingSteps > 0) {
      return `Today ${m.todaySteps} steps · ${m.todayRequests} prompts`;
    }
    if (m.weekSteps > 0) {
      return `7d ${m.weekSteps} steps`;
    }
    return 'No steps today';
  }
  if (m.todayTokens > 0) {
    return `Today ${formatTokens(m.todayTokens)} · ${formatUsd(m.todayCostUsd)}`;
  }
  if (m.todayRequests > 0) {
    return `Today ${m.todayRequests} sessions`;
  }
  if (m.weekTokens > 0) {
    return `7d ${formatTokens(m.weekTokens)} · ${formatUsd(m.weekCostUsd)}`;
  }
  return snap.status === 'no-data' ? 'No recent local activity' : 'Idle today';
}

export function MiniWidget({
  accounts,
  snapshots,
  settings,
  filter,
  refreshing,
  nowMs,
  onFilterChange,
  onRefreshAll,
  onRefreshOne,
  onTogglePinOnTop,
  onExpand,
  onHide,
  onAddAccount,
  onAutoDiscover,
  onOpenSnapshotModal
}: MiniWidgetProps) {
  const enabledAccounts = accounts.filter((a) => a.enabled);
  const pinnedAccounts = enabledAccounts.filter((a) => a.pinnedToWidget);
  const visibleSource = pinnedAccounts.length > 0 ? pinnedAccounts : enabledAccounts;
  const filteredAccounts =
    filter === 'all'
      ? visibleSource
      : visibleSource.filter((a) => a.provider === filter);

  const countFor = (p: ProviderFilter) =>
    p === 'all'
      ? visibleSource.length
      : visibleSource.filter((a) => a.provider === p).length;

  return (
    <>
      <div className="titlebar">
        <div className="brand">
          <span className="brand-dot" />
          <span>AI Tracker</span>
        </div>
        <div className="row-center no-drag">
          <button
            className="icon-btn"
            title="Refresh all accounts"
            onClick={onRefreshAll}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
          <button
            className={`icon-btn ${settings.alwaysOnTop ? 'active' : ''}`}
            title={settings.alwaysOnTop ? 'Unpin from top' : 'Pin always on top'}
            onClick={onTogglePinOnTop}
          >
            {settings.alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button
            className="icon-btn"
            title="Expand full dashboard"
            onClick={onExpand}
          >
            <Maximize2 size={14} />
          </button>
          <button
            className="icon-btn"
            title="Hide to system tray"
            onClick={onHide}
          >
            <Minus size={14} />
          </button>
        </div>
      </div>

      <div className="filter-strip no-drag">
        <button
          className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
          onClick={() => onFilterChange('all')}
        >
          All <span className="tabular muted">{countFor('all')}</span>
        </button>
        {PROVIDER_ORDER.map((pid) => {
          const meta = PROVIDER_META[pid];
          const count = countFor(pid);
          if (count === 0 && filter !== pid) return null;
          return (
            <button
              key={pid}
              className={`filter-pill ${filter === pid ? 'active' : ''}`}
              onClick={() => onFilterChange(pid)}
            >
              <span
                className="provider-dot"
                style={{ backgroundColor: meta.accentColor }}
              />
              <span>{meta.shortName}</span>
              <span className="tabular muted">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="scroll-body">
        {filteredAccounts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '18px 12px' }}>
            <div style={{ fontWeight: 600 }}>No pinned accounts</div>
            <div className="muted tiny">
              Add accounts for Claude Code, Antigravity, Gemini, or Codex to track them here.
            </div>
            <div className="row-center" style={{ justifyContent: 'center', marginTop: 6 }}>
              <button className="btn btn-primary btn-sm" onClick={onAutoDiscover}>
                <ScanSearch size={13} /> Auto-Scan Profiles
              </button>
              <button className="btn btn-sm" onClick={onAddAccount}>
                <Plus size={13} /> Add Account
              </button>
            </div>
          </div>
        ) : (
          filteredAccounts.map((acc) => {
            const meta = PROVIDER_META[acc.provider];
            const snap = snapshots[acc.id];
            const used = snap?.primaryQuota.usedPercent ?? 0;
            const severity = getQuotaSeverity(used);
            const countdown = formatCountdown(snap?.primaryQuota.resetAtIso, nowMs);

            return (
              <div
                key={acc.id}
                className={`card ${settings.compactCards ? 'card-compact' : ''}`}
              >
                <div className="row-between">
                  <div className="row-center" style={{ minWidth: 0 }}>
                    <span
                      className="provider-badge"
                      style={{ borderColor: `${meta.accentColor}55` }}
                    >
                      <span
                        className="provider-dot"
                        style={{ backgroundColor: meta.accentColor }}
                      />
                      {meta.shortName}
                    </span>
                    <span className="truncate" style={{ fontWeight: 600 }}>
                      {acc.label}
                    </span>
                  </div>
                  <div className="row-center" style={{ flexShrink: 0 }}>
                    {acc.authType === 'direct-signin' ? (
                      <span
                        className={`source-tag ${acc.directAuthStatus === 'signed-in' ? 'ok' : 'error'}`}
                        title={`Direct In-App Auth: ${acc.directAuthEmail || acc.accountHint || 'Connected'}`}
                      >
                        🔒 {snap?.sourceUsed ?? 'live'}
                      </span>
                    ) : (
                      <span
                        className={`source-tag ${snap?.status ?? ''}`}
                        title={snap?.statusMessage || snap?.sourceUsed || 'local'}
                      >
                        {snap?.status === 'rate-limited'
                          ? '429'
                          : snap?.sourceUsed ?? 'local'}
                      </span>
                    )}
                    <button
                      className="icon-btn"
                      style={{ padding: 3 }}
                      title="Paste /usage or set manual quota"
                      onClick={() => onOpenSnapshotModal(acc)}
                    >
                      <ClipboardPaste size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ padding: 3 }}
                      title="Refresh this account"
                      onClick={() => onRefreshOne(acc.id)}
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                </div>

                <div>
                  <div className="row-between tiny" style={{ marginBottom: 4 }}>
                    <span className="muted truncate">
                      {snap?.primaryQuota.label ?? 'Rolling Quota'}
                    </span>
                    <span className="tabular" style={{ fontWeight: 600 }}>
                      {used.toFixed(0)}%
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${severity}`}
                      style={{ width: `${Math.min(100, Math.max(0, used))}%` }}
                    />
                  </div>
                </div>

                {snap?.secondaryQuota && (
                  <div>
                    <div className="row-between tiny muted" style={{ marginBottom: 3 }}>
                      <span className="truncate">{snap.secondaryQuota.label}</span>
                      <span className="tabular">
                        {snap.secondaryQuota.usedPercent.toFixed(0)}%
                        {snap.secondaryQuota.resetAtIso
                          ? ` · ↻ ${formatResetDate(snap.secondaryQuota.resetAtIso)}`
                          : ''}
                      </span>
                    </div>
                    <div className="progress-track thin">
                      <div
                        className={`progress-fill ${getQuotaSeverity(snap.secondaryQuota.usedPercent)}`}
                        style={{
                          width: `${Math.min(100, Math.max(0, snap.secondaryQuota.usedPercent))}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="row-between tiny muted">
                  <span className="truncate">{summarizeToday(acc, snap)}</span>
                  <span
                    className="tabular"
                    style={{ flexShrink: 0 }}
                    title={
                      snap?.primaryQuota.resetAtIso
                        ? `Resets ${formatResetDate(snap.primaryQuota.resetAtIso)}`
                        : undefined
                    }
                  >
                    {countdown
                      ? `↻ ${formatResetDate(snap?.primaryQuota.resetAtIso)} (${countdown})`
                      : ''}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="footer-bar">
        <span className="tabular">
          {filteredAccounts.length} shown · {accounts.length} total
        </span>
        <div className="row-center no-drag">
          <button className="icon-btn" onClick={onAddAccount} title="Add account">
            <Plus size={12} /> Account
          </button>
          <button className="icon-btn" onClick={onExpand} title="Open dashboard">
            Dashboard
          </button>
        </div>
      </div>
    </>
  );
}
