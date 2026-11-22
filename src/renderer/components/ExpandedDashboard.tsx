import { useState } from 'react';
import {
  Activity,
  ClipboardPaste,
  Copy,
  Download,
  Minimize2,
  Minus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Power,
  RefreshCw,
  ScanSearch,
  Trash2,
  Upload
} from 'lucide-react';
import {
  formatCountdown,
  formatRelativeAge,
  formatResetDate,
  formatResetLabel,
  formatTokens,
  formatUsd,
  getQuotaSeverity
} from '../../shared/formatters';
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  type AccountConfig,
  type AccountUsageSnapshot,
  type AppSettings,
  type DiscoveredProfile,
  type ProviderId
} from '../../shared/types';
import type { ProviderFilter } from '../App';

type DashboardTab = 'overview' | 'accounts' | 'settings';

interface ExpandedDashboardProps {
  accounts: AccountConfig[];
  snapshots: Record<string, AccountUsageSnapshot>;
  settings: AppSettings;
  filter: ProviderFilter;
  refreshing: boolean;
  nowMs: number;
  discovered: DiscoveredProfile[];
  onFilterChange: (next: ProviderFilter) => void;
  onRefreshAll: () => void;
  onRefreshOne: (id: string) => void;
  onTogglePinOnTop: () => void;
  onMinimizeToWidget: () => void;
  onHide: () => void;
  onAddAccount: (provider?: ProviderId) => void;
  onEditAccount: (account: AccountConfig) => void;
  onCloneAccount: (account: AccountConfig) => void;
  onDeleteAccount: (id: string) => void;
  onQuickToggleAccount: (account: AccountConfig) => void;
  onDiscover: () => void;
  onSeedDiscovered: (profiles: DiscoveredProfile[]) => void;
  onOpenSnapshotModal: (account: AccountConfig) => void;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
  onReloadAll: () => void;
}

export function ExpandedDashboard({
  accounts,
  snapshots,
  settings,
  filter,
  refreshing,
  nowMs,
  discovered,
  onFilterChange,
  onRefreshAll,
  onRefreshOne,
  onTogglePinOnTop,
  onMinimizeToWidget,
  onHide,
  onAddAccount,
  onEditAccount,
  onCloneAccount,
  onDeleteAccount,
  onQuickToggleAccount,
  onDiscover,
  onSeedDiscovered,
  onOpenSnapshotModal,
  onUpdateSettings,
  onReloadAll
}: ExpandedDashboardProps) {
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [backupJson, setBackupJson] = useState('');
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const enabledAccounts = accounts.filter((a) => a.enabled);
  const filteredAccounts =
    filter === 'all'
      ? enabledAccounts
      : enabledAccounts.filter((a) => a.provider === filter);

  let totalTodayTokens = 0;
  let totalTodayCost = 0;
  let totalTodaySteps = 0;
  let peakQuota = 0;
  let peakLabel = 'None';

  for (const acc of enabledAccounts) {
    const snap = snapshots[acc.id];
    if (!snap) continue;
    totalTodayTokens += snap.metrics.todayTokens;
    totalTodayCost += snap.metrics.todayCostUsd;
    totalTodaySteps += snap.metrics.todaySteps;
    if (snap.primaryQuota.usedPercent >= peakQuota) {
      peakQuota = snap.primaryQuota.usedPercent;
      peakLabel = acc.label;
    }
  }

  const unaddedProfiles = discovered.filter((p) => !p.alreadyAdded);

  const handleExport = async () => {
    const json = await window.aiTracker.settingsExportJson();
    setBackupJson(json);
    setBackupNotice('Exported sanitized config (API tokens stripped).');
  };

  const handleImport = async () => {
    if (!backupJson.trim()) return;
    try {
      const res = await window.aiTracker.settingsImportJson(backupJson);
      setBackupNotice(`Imported ${res.importedAccounts} account(s).`);
      onReloadAll();
    } catch (err) {
      setBackupNotice(err instanceof Error ? err.message : 'Invalid JSON payload');
    }
  };

  return (
    <>
      <div className="titlebar">
        <div className="row-center">
          <div className="brand">
            <span className="brand-dot" />
            <span>AI Tracker</span>
          </div>
          <div className="tab-group no-drag" style={{ marginLeft: 10 }}>
            <button
              className={`tab-btn ${tab === 'overview' ? 'active' : ''}`}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              className={`tab-btn ${tab === 'accounts' ? 'active' : ''}`}
              onClick={() => setTab('accounts')}
            >
              Accounts ({accounts.length})
            </button>
            <button
              className={`tab-btn ${tab === 'settings' ? 'active' : ''}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </div>
        </div>

        <div className="row-center no-drag">
          <button
            className="btn btn-sm"
            onClick={onRefreshAll}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> Refresh
          </button>
          <button
            className={`icon-btn ${settings.alwaysOnTop ? 'active' : ''}`}
            title={settings.alwaysOnTop ? 'Unpin from top' : 'Pin always on top'}
            onClick={onTogglePinOnTop}
          >
            {settings.alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button
            className="btn btn-sm btn-primary"
            title="Switch to floating mini widget"
            onClick={onMinimizeToWidget}
          >
            <Minimize2 size={13} /> Mini Widget
          </button>
          <button className="icon-btn" title="Hide to tray" onClick={onHide}>
            <Minus size={14} />
          </button>
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="filter-strip no-drag">
            <button
              className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
              onClick={() => onFilterChange('all')}
            >
              All Accounts <span className="tabular muted">{enabledAccounts.length}</span>
            </button>
            {PROVIDER_ORDER.map((pid) => {
              const meta = PROVIDER_META[pid];
              const count = enabledAccounts.filter((a) => a.provider === pid).length;
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
                  <span>{meta.name}</span>
                  <span className="tabular muted">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="scroll-body">
            <div className="kpi-grid">
              <div className="card">
                <span className="metric-label">Today Tokens</span>
                <span className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                  {formatTokens(totalTodayTokens)}
                </span>
                <span className="tiny muted">
                  {totalTodaySteps > 0 ? `+ ${totalTodaySteps} AGY steps` : 'Across active profiles'}
                </span>
              </div>
              <div className="card">
                <span className="metric-label">Est. Today Cost</span>
                <span className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                  {formatUsd(totalTodayCost)}
                </span>
                <span className="tiny muted">Token pricing estimate</span>
              </div>
              <div className="card">
                <span className="metric-label">Active Accounts</span>
                <span className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                  {enabledAccounts.length}
                </span>
                <span className="tiny muted">{accounts.length} configured total</span>
              </div>
              <div className="card">
                <span className="metric-label">Peak Quota</span>
                <span className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>
                  {peakQuota.toFixed(0)}%
                </span>
                <span className="tiny muted truncate">{peakLabel}</span>
              </div>
            </div>

            {filteredAccounts.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 24 }}>
                <Activity size={24} style={{ margin: '0 auto 6px', color: 'var(--accent)' }} />
                <div style={{ fontWeight: 600 }}>No active accounts in this filter</div>
                <div className="muted tiny">
                  Use Accounts tab to add multiple accounts for Claude Code, Antigravity, Gemini, or Codex.
                </div>
                <div className="row-center" style={{ justifyContent: 'center', marginTop: 8 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onAddAccount(filter === 'all' ? undefined : filter)}
                  >
                    <Plus size={13} /> Add Account
                  </button>
                </div>
              </div>
            ) : (
              <div className="cards-grid">
                {filteredAccounts.map((acc) => {
                  const meta = PROVIDER_META[acc.provider];
                  const snap = snapshots[acc.id];
                  const used = snap?.primaryQuota.usedPercent ?? 0;

                  return (
                    <div key={acc.id} className="card">
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
                            {meta.name}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div className="truncate" style={{ fontWeight: 600 }}>
                              {acc.label}
                            </div>
                            {acc.accountHint && (
                              <div className="tiny muted truncate">{acc.accountHint}</div>
                            )}
                          </div>
                        </div>

                        <div className="row-center">
                          <span className={`source-tag ${snap?.status ?? ''}`}>
                            {snap?.status === 'rate-limited'
                              ? '429 Cooldown'
                              : snap?.sourceUsed ?? acc.mode}
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="row-between tiny" style={{ marginBottom: 4 }}>
                          <span className="muted">
                            {snap?.primaryQuota.label ?? 'Rolling Quota'}
                          </span>
                          <span className="tabular" style={{ fontWeight: 600 }}>
                            {used.toFixed(1)}% used
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className={`progress-fill ${getQuotaSeverity(used)}`}
                            style={{ width: `${Math.min(100, Math.max(0, used))}%` }}
                          />
                        </div>
                        <div className="tiny muted tabular" style={{ marginTop: 3 }}>
                          {snap?.primaryQuota.resetAtIso
                            ? formatResetLabel(snap.primaryQuota.resetAtIso, nowMs)
                            : used === 0
                              ? 'Ready · no active 5h window'
                              : ''}
                        </div>
                      </div>

                      {snap?.secondaryQuota && (
                        <div>
                          <div className="row-between tiny muted" style={{ marginBottom: 3 }}>
                            <span>{snap.secondaryQuota.label}</span>
                            <span className="tabular" style={{ fontWeight: 600 }}>
                              {snap.secondaryQuota.usedPercent.toFixed(1)}% used
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
                          {snap.secondaryQuota.resetAtIso && (
                            <div className="tiny muted tabular" style={{ marginTop: 2 }}>
                              {formatResetLabel(snap.secondaryQuota.resetAtIso, nowMs)}
                            </div>
                          )}
                        </div>
                      )}

                      {snap?.pools && snap.pools.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {snap.pools.slice(0, 4).map((pool) => (
                            <div key={pool.name} className="row-between tiny">
                              <span className="muted truncate">{pool.name}</span>
                              <span className="tabular">
                                {pool.usedPercent.toFixed(0)}%
                                {pool.resetAtIso
                                  ? ` · ${formatResetDate(pool.resetAtIso)} (${formatCountdown(pool.resetAtIso, nowMs)})`
                                  : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {acc.provider === 'antigravity' && snap?.sourceUsed === 'local' && (
                        <div className="tiny muted">
                          Local step estimate — click <strong>/usage</strong> to paste exact server % from Antigravity.
                        </div>
                      )}

                      <div className="metrics-3col">
                        {acc.provider === 'antigravity' ? (
                          <>
                            <div className="metric-box">
                              <span className="metric-label">
                                {acc.limits.rollingWindowHours}h Window
                              </span>
                              <span className="metric-val tabular">
                                {snap?.metrics.rollingSteps ?? 0} steps
                              </span>
                            </div>
                            <div className="metric-box">
                              <span className="metric-label">Today</span>
                              <span className="metric-val tabular">
                                {snap?.metrics.todaySteps ?? 0} / {snap?.metrics.todayRequests ?? 0} req
                              </span>
                            </div>
                            <div className="metric-box">
                              <span className="metric-label">7 Days</span>
                              <span className="metric-val tabular">
                                {snap?.metrics.weekSteps ?? 0} steps
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="metric-box">
                              <span className="metric-label">
                                {acc.limits.rollingWindowHours}h Window
                              </span>
                              <span className="metric-val tabular">
                                {formatTokens(snap?.metrics.rollingTokens ?? 0)}
                              </span>
                            </div>
                            <div className="metric-box">
                              <span className="metric-label">Today</span>
                              <span className="metric-val tabular">
                                {formatTokens(snap?.metrics.todayTokens ?? 0)} ·{' '}
                                {formatUsd(snap?.metrics.todayCostUsd ?? 0)}
                              </span>
                            </div>
                            <div className="metric-box">
                              <span className="metric-label">7 Days</span>
                              <span className="metric-val tabular">
                                {formatTokens(snap?.metrics.weekTokens ?? 0)} ·{' '}
                                {formatUsd(snap?.metrics.weekCostUsd ?? 0)}
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {snap && snap.modelBreakdown.length > 0 && (
                        <div className="tiny muted" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="metric-label">Top Models / Agents (7d)</span>
                          {snap.modelBreakdown.slice(0, 3).map((m) => (
                            <div key={m.model} className="row-between">
                              <span className="truncate">{m.model}</span>
                              <span className="tabular">
                                {acc.provider === 'antigravity'
                                  ? `${m.tokens} steps · ${m.requests} convs`
                                  : `${formatTokens(m.tokens)} · ${formatUsd(m.costUsd)}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {snap?.statusMessage && (
                        <div className="tiny muted truncate" title={snap.statusMessage}>
                          {snap.statusMessage}
                        </div>
                      )}

                      <div className="row-between" style={{ paddingTop: 2 }}>
                        <span className="tiny muted">
                          Updated {formatRelativeAge(snap?.fetchedAt, nowMs)}
                        </span>
                        <div className="row-center">
                          <button
                            className="btn btn-sm"
                            onClick={() => onRefreshOne(acc.id)}
                          >
                            <RefreshCw size={11} /> Sync
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => onOpenSnapshotModal(acc)}
                          >
                            <ClipboardPaste size={11} /> /usage
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => onEditAccount(acc)}
                          >
                            <Pencil size={11} /> Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'accounts' && (
        <div className="scroll-body">
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Multi-Account Manager</div>
              <div className="tiny muted">
                Configure isolated profile folders or API tokens per account across all 4 AI tools.
              </div>
            </div>
            <div className="row-center">
              <button className="btn btn-sm" onClick={onDiscover}>
                <ScanSearch size={13} /> Auto-Scan Local Profiles
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => onAddAccount()}>
                <Plus size={13} /> Add Account
              </button>
            </div>
          </div>

          {discovered.length > 0 && (
            <div className="card" style={{ borderColor: 'rgba(56, 189, 248, 0.35)' }}>
              <div className="row-between">
                <span style={{ fontWeight: 600 }}>
                  Discovered Local Profiles ({discovered.length})
                </span>
                {unaddedProfiles.length > 0 && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => onSeedDiscovered(unaddedProfiles)}
                  >
                    Add All New ({unaddedProfiles.length})
                  </button>
                )}
              </div>
              {discovered.map((p) => (
                <div
                  key={`${p.provider}-${p.profileDir}`}
                  className="row-between tiny"
                  style={{
                    padding: '5px 8px',
                    borderRadius: 6,
                    background: 'var(--bg-base)'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{p.suggestedLabel}</span>
                    <span className="muted"> — {p.profileDir}</span>
                    <div className="muted">{p.details}</div>
                  </div>
                  {p.alreadyAdded ? (
                    <span className="source-tag">Added</span>
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={() => onSeedDiscovered([p])}
                    >
                      <Plus size={11} /> Add
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {PROVIDER_ORDER.map((pid) => {
            const meta = PROVIDER_META[pid];
            const list = accounts.filter((a) => a.provider === pid);
            return (
              <div key={pid} className="card">
                <div className="row-between">
                  <div className="row-center">
                    <span
                      className="provider-dot"
                      style={{ backgroundColor: meta.accentColor }}
                    />
                    <span style={{ fontWeight: 600 }}>{meta.name}</span>
                    <span className="tiny muted">({list.length})</span>
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={() => onAddAccount(pid)}
                  >
                    <Plus size={11} /> Add {meta.shortName}
                  </button>
                </div>

                {list.length === 0 ? (
                  <div className="tiny muted">
                    {meta.description} Tip: {meta.envVarHint}.
                  </div>
                ) : (
                  list.map((acc) => (
                    <div
                      key={acc.id}
                      className="row-between"
                      style={{
                        padding: '7px 9px',
                        borderRadius: 8,
                        background: 'var(--bg-base)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="row-center">
                          <span style={{ fontWeight: 600 }}>{acc.label}</span>
                          <span className="source-tag">{acc.mode}</span>
                          {acc.liveSyncEnabled && (
                            <span className="source-tag">Live Sync</span>
                          )}
                          {acc.hasSecretToken && (
                            <span className="source-tag">Token Saved</span>
                          )}
                          {!acc.enabled && (
                            <span className="source-tag error">Disabled</span>
                          )}
                        </div>
                        <div className="tiny muted truncate">
                          {acc.profileDir || '(No local profile directory)'}
                        </div>
                      </div>

                      <div className="row-center" style={{ flexShrink: 0 }}>
                        <button
                          className={`icon-btn ${acc.pinnedToWidget ? 'active' : ''}`}
                          title={
                            acc.pinnedToWidget
                              ? 'Pinned to Mini Widget'
                              : 'Pin to Mini Widget'
                          }
                          onClick={() =>
                            onQuickToggleAccount({
                              ...acc,
                              pinnedToWidget: !acc.pinnedToWidget
                            })
                          }
                        >
                          {acc.pinnedToWidget ? <Pin size={13} /> : <PinOff size={13} />}
                        </button>
                        <button
                          className={`icon-btn ${acc.enabled ? 'active' : ''}`}
                          title={acc.enabled ? 'Disable account' : 'Enable account'}
                          onClick={() =>
                            onQuickToggleAccount({
                              ...acc,
                              enabled: !acc.enabled
                            })
                          }
                        >
                          <Power size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Update /usage snapshot"
                          onClick={() => onOpenSnapshotModal(acc)}
                        >
                          <ClipboardPaste size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Clone account"
                          onClick={() => onCloneAccount(acc)}
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Edit account"
                          onClick={() => onEditAccount(acc)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Delete account"
                          onClick={() => onDeleteAccount(acc.id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'settings' && (
        <div className="scroll-body">
          <div className="card">
            <div style={{ fontWeight: 600 }}>Widget & Polling Behavior</div>
            <div className="form-grid">
              <div className="field">
                <label>Auto-Refresh Interval</label>
                <select
                  className="select"
                  value={settings.pollIntervalSeconds}
                  onChange={(e) =>
                    onUpdateSettings({ pollIntervalSeconds: Number(e.target.value) })
                  }
                >
                  <option value={30}>Every 30 seconds</option>
                  <option value={60}>Every 60 seconds</option>
                  <option value={120}>Every 2 minutes</option>
                  <option value={300}>Every 5 minutes</option>
                </select>
              </div>
              <div className="field">
                <label>Startup Mode</label>
                <select
                  className="select"
                  value={settings.startMode}
                  onChange={(e) =>
                    onUpdateSettings({
                      startMode: e.target.value === 'expanded' ? 'expanded' : 'mini'
                    })
                  }
                >
                  <option value="mini">Mini Floating Widget</option>
                  <option value="expanded">Expanded Dashboard</option>
                </select>
              </div>
              <div className="field full">
                <label>
                  Window Opacity ({Math.round(settings.opacity * 100)}%)
                </label>
                <input
                  type="range"
                  min={0.6}
                  max={1}
                  step={0.02}
                  value={settings.opacity}
                  onChange={(e) =>
                    onUpdateSettings({ opacity: Number(e.target.value) })
                  }
                />
              </div>
              <div className="field full" style={{ gap: 8 }}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.alwaysOnTop}
                    onChange={(e) =>
                      onUpdateSettings({ alwaysOnTop: e.target.checked })
                    }
                  />
                  Always on top in floating widget mode
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.minimizeToTray}
                    onChange={(e) =>
                      onUpdateSettings({ minimizeToTray: e.target.checked })
                    }
                  />
                  Hide to Windows system tray on close
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.compactCards}
                    onChange={(e) =>
                      onUpdateSettings({ compactCards: e.target.checked })
                    }
                  />
                  Compact card spacing in Mini Widget
                </label>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 600 }}>Config Backup (Secrets Stripped)</div>
                <div className="tiny muted">
                  Export or import account setups without exposing DPAPI-encrypted tokens.
                </div>
              </div>
              <div className="row-center">
                <button className="btn btn-sm" onClick={() => void handleExport()}>
                  <Download size={12} /> Export JSON
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void handleImport()}
                >
                  <Upload size={12} /> Import JSON
                </button>
              </div>
            </div>
            <textarea
              className="textarea"
              placeholder="Click Export JSON or paste exported config JSON here to import..."
              value={backupJson}
              onChange={(e) => setBackupJson(e.target.value)}
            />
            {backupNotice && <div className="tiny muted">{backupNotice}</div>}
          </div>
        </div>
      )}
    </>
  );
}
