import { useState, type FormEvent } from 'react';
import { FolderOpen, X } from 'lucide-react';
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  type AccountConfig,
  type LimitMetric,
  type ProviderId,
  type TrackingMode
} from '../../shared/types';
import { randomUUID } from '../../shared/uuid';

interface AccountModalProps {
  editing?: AccountConfig;
  cloneFrom?: AccountConfig;
  initialProvider?: ProviderId;
  onClose: () => void;
  onSave: (
    account: AccountConfig,
    secretToken?: string,
    clearSecret?: boolean
  ) => Promise<void>;
}

export function AccountModal({
  editing,
  cloneFrom,
  initialProvider,
  onClose,
  onSave
}: AccountModalProps) {
  const seed = editing ?? cloneFrom;
  const startingProvider: ProviderId =
    seed?.provider ?? initialProvider ?? 'claude-code';
  const startMeta = PROVIDER_META[startingProvider];

  const [provider, setProvider] = useState<ProviderId>(startingProvider);
  const [label, setLabel] = useState(seed?.label ?? `${startMeta.name} Account`);
  const [accountHint, setAccountHint] = useState(seed?.accountHint ?? '');
  const [mode, setMode] = useState<TrackingMode>(seed?.mode ?? 'hybrid');
  const [profileDir, setProfileDir] = useState(seed?.profileDir ?? '');
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(
    seed?.liveSyncEnabled ?? false
  );
  const [secretToken, setSecretToken] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [rollingWindowHours, setRollingWindowHours] = useState(
    seed?.limits.rollingWindowHours ?? startMeta.defaultRollingHours
  );
  const [rollingLimitMetric, setRollingLimitMetric] = useState<LimitMetric>(
    seed?.limits.rollingLimitMetric ?? startMeta.defaultLimitMetric
  );
  const [rollingLimitValue, setRollingLimitValue] = useState(
    seed?.limits.rollingLimitValue ?? startMeta.defaultLimitValue
  );
  const [weeklyLimitValue, setWeeklyLimitValue] = useState<string>(
    seed?.limits.weeklyLimitValue ? String(seed.limits.weeklyLimitValue) : ''
  );
  const [pinnedToWidget, setPinnedToWidget] = useState(
    seed?.pinnedToWidget ?? true
  );
  const [enabled, setEnabled] = useState(seed?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  const meta = PROVIDER_META[provider];

  const handleProviderChange = (nextProvider: ProviderId) => {
    setProvider(nextProvider);
    if (!editing) {
      const nextMeta = PROVIDER_META[nextProvider];
      setLabel(`${nextMeta.name} Account`);
      setRollingWindowHours(nextMeta.defaultRollingHours);
      setRollingLimitMetric(nextMeta.defaultLimitMetric);
      setRollingLimitValue(nextMeta.defaultLimitValue);
      if (nextProvider === 'antigravity') {
        setLiveSyncEnabled(false);
      }
    }
  };

  const handleBrowse = async () => {
    const picked = await window.aiTracker.windowPickDirectory(profileDir);
    if (picked) {
      setProfileDir(picked);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const parsedWeekly = Number(weeklyLimitValue);
      const account: AccountConfig = {
        id: editing?.id ?? cloneFrom?.id ?? randomUUID(),
        provider,
        label: label.trim() || `${meta.name} Account`,
        accountHint: accountHint.trim() || undefined,
        mode,
        profileDir: profileDir.trim(),
        liveSyncEnabled: provider === 'antigravity' ? false : liveSyncEnabled,
        hasSecretToken: editing?.hasSecretToken ?? false,
        limits: {
          rollingWindowHours: Math.max(1, Number(rollingWindowHours) || 5),
          rollingLimitMetric,
          rollingLimitValue: Math.max(1, Number(rollingLimitValue) || 100),
          weeklyLimitValue:
            weeklyLimitValue.trim() && Number.isFinite(parsedWeekly) && parsedWeekly > 0
              ? parsedWeekly
              : undefined
        },
        manualSnapshot: editing?.manualSnapshot,
        pinnedToWidget,
        enabled,
        createdAt: editing?.createdAt ?? nowIso,
        updatedAt: nowIso
      };
      await onSave(account, secretToken, clearSecret);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop no-drag" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {editing ? `Edit ${meta.name} Account` : 'Add AI Account'}
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="form-grid">
            <div className="field">
              <label>Provider</label>
              <select
                className="select"
                value={provider}
                disabled={Boolean(editing)}
                onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
              >
                {PROVIDER_ORDER.map((pid) => (
                  <option key={pid} value={pid}>
                    {PROVIDER_META[pid].name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Tracking Mode</label>
              <select
                className="select"
                value={mode}
                onChange={(e) => setMode(e.target.value as TrackingMode)}
              >
                <option value="hybrid">Hybrid (Local + Live/Manual)</option>
                <option value="local-only">Local Logs Only</option>
                <option value="live-api">Live Quota Only</option>
                <option value="manual">Manual / Paste /usage Only</option>
              </select>
            </div>

            <div className="field">
              <label>Account Label</label>
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Personal Pro, Work Team"
                required
              />
            </div>

            <div className="field">
              <label>Email / Handle (Optional)</label>
              <input
                className="input"
                value={accountHint}
                onChange={(e) => setAccountHint(e.target.value)}
                placeholder="e.g. dev@company.com"
              />
            </div>

            <div className="field full">
              <label>Local Profile Directory ({meta.defaultPathHint})</label>
              <div className="row-center">
                <input
                  className="input"
                  value={profileDir}
                  onChange={(e) => setProfileDir(e.target.value)}
                  placeholder={`Path to ${meta.name} profile folder`}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void handleBrowse()}
                  style={{ flexShrink: 0 }}
                >
                  <FolderOpen size={13} /> Browse
                </button>
              </div>
            </div>
          </div>

          <div className="hint-box">
            <strong>Multi-account tip:</strong> {meta.envVarHint}
          </div>

          {provider !== 'antigravity' && (
            <div className="card" style={{ padding: 9 }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={liveSyncEnabled}
                  onChange={(e) => setLiveSyncEnabled(e.target.checked)}
                />
                Enable opt-in live quota sync (min 5m cooldown, auto 429 backoff)
              </label>

              {liveSyncEnabled && (
                <div className="field" style={{ marginTop: 4 }}>
                  <label>
                    Optional Override Token / API Key{' '}
                    {editing?.hasSecretToken && !clearSecret
                      ? '(Saved securely with Windows DPAPI)'
                      : '(Leaves blank to read local CLI credentials)'}
                  </label>
                  <div className="row-center">
                    <input
                      type="password"
                      className="input"
                      value={secretToken}
                      onChange={(e) => {
                        setSecretToken(e.target.value);
                        setClearSecret(false);
                      }}
                      placeholder={
                        editing?.hasSecretToken && !clearSecret
                          ? '•••••••••••• (enter new token to replace)'
                          : 'Paste OAuth token (optional)'
                      }
                    />
                    {editing?.hasSecretToken && !clearSecret && (
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          setClearSecret(true);
                          setSecretToken('');
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="form-grid">
            <div className="field">
              <label>Rolling Window (Hours)</label>
              <input
                type="number"
                min={1}
                max={720}
                className="input"
                value={rollingWindowHours}
                onChange={(e) => setRollingWindowHours(Number(e.target.value))}
              />
            </div>

            <div className="field">
              <label>Local Cap Metric</label>
              <select
                className="select"
                value={rollingLimitMetric}
                onChange={(e) =>
                  setRollingLimitMetric(e.target.value as LimitMetric)
                }
              >
                <option value="tokens">Tokens</option>
                <option value="cost_usd">Est. Cost (USD)</option>
                <option value="requests">Requests / Sessions</option>
                <option value="steps">Agent Steps</option>
              </select>
            </div>

            <div className="field">
              <label>Rolling Cap Target</label>
              <input
                type="number"
                min={1}
                step="any"
                className="input"
                value={rollingLimitValue}
                onChange={(e) => setRollingLimitValue(Number(e.target.value))}
              />
            </div>

            <div className="field">
              <label>7d Weekly Cap (Optional)</label>
              <input
                type="number"
                min={1}
                step="any"
                className="input"
                value={weeklyLimitValue}
                onChange={(e) => setWeeklyLimitValue(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="row-between">
            <div className="row-center" style={{ gap: 14 }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={pinnedToWidget}
                  onChange={(e) => setPinnedToWidget(e.target.checked)}
                />
                Pin to Mini Widget
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Enabled
              </label>
            </div>

            <div className="row-center">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
