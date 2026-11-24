import { useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Sliders,
  X
} from 'lucide-react';
import {
  PROVIDER_META,
  PROVIDER_ORDER,
  type AccountConfig,
  type AuthType,
  type DirectAuthStatus,
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

  const [accountId] = useState(editing?.id ?? cloneFrom?.id ?? randomUUID());
  const [provider, setProvider] = useState<ProviderId>(startingProvider);
  const [label, setLabel] = useState(seed?.label ?? `${startMeta.name} Account`);
  const [accountHint, setAccountHint] = useState(seed?.accountHint ?? '');
  const [mode, setMode] = useState<TrackingMode>(seed?.mode ?? 'hybrid');
  const [profileDir, setProfileDir] = useState(seed?.profileDir ?? '');
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(
    seed?.liveSyncEnabled ?? (seed?.authType === 'direct-signin' || true)
  );
  const [secretToken, setSecretToken] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [authType, setAuthType] = useState<AuthType>(
    seed?.authType ?? (seed?.hasSecretToken ? 'api-key' : 'direct-signin')
  );
  const [directAuthEmail, setDirectAuthEmail] = useState(seed?.directAuthEmail ?? '');
  const [directAuthStatus, setDirectAuthStatus] = useState<DirectAuthStatus>(
    seed?.directAuthStatus ?? (seed?.authType === 'direct-signin' ? 'signed-in' : 'signed-out')
  );
  const [signingIn, setSigningIn] = useState(false);
  const [signStatusMessage, setSignStatusMessage] = useState<string | null>(null);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [verifyStatusMessage, setVerifyStatusMessage] = useState<{
    text: string;
    success: boolean;
  } | null>(null);

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
    seed?.limits.weeklyLimitValue
      ? String(seed.limits.weeklyLimitValue)
      : String(startMeta.defaultWeeklyLimitValue)
  );
  const [pinnedToWidget, setPinnedToWidget] = useState(
    seed?.pinnedToWidget ?? true
  );
  const [enabled, setEnabled] = useState(seed?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'auth' | 'settings'>('auth');

  const meta = PROVIDER_META[provider];

  const handleProviderChange = (nextProvider: ProviderId) => {
    setProvider(nextProvider);
    const nextMeta = PROVIDER_META[nextProvider];
    if (!editing) {
      setLabel(`${nextMeta.name} Account`);
      setRollingWindowHours(nextMeta.defaultRollingHours);
      setRollingLimitMetric(nextMeta.defaultLimitMetric);
      setRollingLimitValue(nextMeta.defaultLimitValue);
      setWeeklyLimitValue(String(nextMeta.defaultWeeklyLimitValue));
    }
    setVerifyStatusMessage(null);
    setSignStatusMessage(null);
  };

  const handleBrowse = async () => {
    const picked = await window.aiTracker.windowPickDirectory(profileDir);
    if (picked) {
      setProfileDir(picked);
    }
  };

  const handleDirectSignIn = async () => {
    setSigningIn(true);
    setSignStatusMessage(`Opening sign-in window for ${meta.name}... Please authenticate in the popup.`);
    try {
      const res = await window.aiTracker.accountsStartDirectLogin(accountId, provider);
      if (res.success) {
        setAuthType('direct-signin');
        setDirectAuthStatus('signed-in');
        setLiveSyncEnabled(true);
        if (res.email) {
          setDirectAuthEmail(res.email);
          setAccountHint(res.email);
          if (!label || label === `${meta.name} Account`) {
            setLabel(`${meta.name} (${res.email})`);
          }
        }
        setSignStatusMessage(res.message || 'Direct sign-in successful! Session saved securely.');
      } else {
        setSignStatusMessage(res.message || 'Sign-in cancelled or not completed.');
      }
    } catch (err) {
      setSignStatusMessage(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSigningIn(false);
    }
  };

  const handleCancelDirectSignIn = async () => {
    await window.aiTracker.accountsCancelDirectLogin(accountId);
    setSigningIn(false);
    setSignStatusMessage('Sign-in cancelled.');
  };

  const handleSignOutDirect = async () => {
    await window.aiTracker.accountsSignOut(accountId);
    setDirectAuthStatus('signed-out');
    setDirectAuthEmail('');
    setClearSecret(true);
    setSecretToken('');
    setSignStatusMessage('Signed out of this account partition.');
  };

  const handleVerifyToken = async () => {
    if (!secretToken.trim()) return;
    setVerifyingToken(true);
    setVerifyStatusMessage(null);
    try {
      const res = await window.aiTracker.accountsVerifyCredentials(provider, secretToken.trim());
      if (res.valid) {
        let extra = '';
        if (res.primaryQuota) {
          extra += ` · 5h: ${res.primaryQuota.usedPercent}% used`;
        }
        if (res.secondaryQuota) {
          extra += ` · 7d: ${res.secondaryQuota.usedPercent}% used`;
        }
        setVerifyStatusMessage({
          text: `✓ ${res.message}${extra}`,
          success: true
        });
        setAuthType('api-key');
        setLiveSyncEnabled(true);
      } else {
        setVerifyStatusMessage({
          text: `❌ ${res.message}`,
          success: false
        });
      }
    } catch (err) {
      setVerifyStatusMessage({
        text: `❌ Verification failed: ${err instanceof Error ? err.message : String(err)}`,
        success: false
      });
    } finally {
      setVerifyingToken(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const parsedWeekly = Number(weeklyLimitValue);
      const account: AccountConfig = {
        id: accountId,
        provider,
        label: label.trim() || `${meta.name} Account`,
        accountHint: accountHint.trim() || (directAuthEmail ? directAuthEmail : undefined),
        mode,
        profileDir: profileDir.trim(),
        liveSyncEnabled: provider === 'antigravity' ? false : liveSyncEnabled,
        hasSecretToken: Boolean(secretToken.trim() || (editing?.hasSecretToken && !clearSecret)),
        authType,
        directAuthEmail: directAuthEmail || undefined,
        directAuthStatus: directAuthStatus,
        directAuthAt: directAuthStatus === 'signed-in' ? (editing?.directAuthAt ?? nowIso) : undefined,
        partitionId: `persist:account-${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
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
      <div className="modal-panel" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="row-between">
          <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: meta.accentColor
              }}
            />
            {editing ? `Edit ${meta.name} Account` : `Add ${meta.name} Account`}
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Navigation tabs */}
        <div className="tab-group" style={{ marginTop: 2, marginBottom: 8 }}>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'auth' ? 'active' : ''}`}
            onClick={() => setActiveTab('auth')}
          >
            <Lock size={12} style={{ marginRight: 4 }} />
            Authentication & Sync
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Sliders size={12} style={{ marginRight: 4 }} />
            Limits & Profile
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeTab === 'auth' ? (
            <>
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
                  <label>Account Label</label>
                  <input
                    className="input"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Personal, Work, Team 2"
                    required
                  />
                </div>
              </div>

              {/* Direct In-App Authentication Box */}
              <div
                className="card"
                style={{
                  padding: 12,
                  background: 'rgba(15, 23, 42, 0.65)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div className="row-between">
                  <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={14} style={{ color: '#38bdf8' }} />
                    In-App Direct Sign-In (Isolated Session)
                  </div>
                  {directAuthStatus === 'signed-in' && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 12,
                        background: 'rgba(34, 197, 94, 0.2)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      <CheckCircle2 size={11} /> Signed In
                    </span>
                  )}
                </div>

                <div className="tiny muted">
                  Each account runs in a dedicated Electron session partition (<code>persist:account-{accountId.slice(0, 8)}</code>).
                  Cookies, tokens, and storage never leak into other accounts.
                </div>

                {directAuthStatus === 'signed-in' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <div
                      style={{
                        fontSize: 12,
                        background: 'rgba(2, 6, 23, 0.5)',
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid rgba(51, 65, 85, 0.5)'
                      }}
                    >
                      <div>
                        <strong>Connected Account:</strong> {directAuthEmail || accountHint || 'Authenticated'}
                      </div>
                      <div className="tiny muted">Live quota sync active via isolated session</div>
                    </div>

                    <div className="row-center" style={{ gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void handleDirectSignIn()}
                        disabled={signingIn}
                      >
                        <RefreshCw size={12} className={signingIn ? 'spin' : ''} />
                        Re-authenticate / Switch
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => void handleSignOutDirect()}
                      >
                        <LogOut size={12} /> Sign Out
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    <div className="row-center">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => void handleDirectSignIn()}
                        disabled={signingIn}
                        style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }}
                      >
                        {signingIn ? (
                          <>
                            <RefreshCw size={13} className="spin" /> Opening Sign-In Window...
                          </>
                        ) : (
                          <>
                            <ExternalLink size={13} /> Sign in Directly with {meta.name}
                          </>
                        )}
                      </button>
                      {signingIn && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => void handleCancelDirectSignIn()}
                          style={{ marginLeft: 6 }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {signStatusMessage && (
                  <div
                    className="tiny"
                    style={{
                      padding: '5px 8px',
                      borderRadius: 4,
                      background: signStatusMessage.includes('successful') || signStatusMessage.includes('authenticated')
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'rgba(234, 179, 8, 0.15)',
                      color: signStatusMessage.includes('successful') || signStatusMessage.includes('authenticated')
                        ? '#86efac'
                        : '#fde047'
                    }}
                  >
                    {signStatusMessage}
                  </div>
                )}
              </div>

              {/* API Key / OAuth Token Alternative */}
              <div
                className="card"
                style={{
                  padding: 11,
                  background: 'rgba(15, 23, 42, 0.4)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <KeyRound size={13} style={{ color: '#a78bfa' }} />
                  Direct API Key or OAuth Token (Encrypted with Windows DPAPI)
                </div>

                <div className="tiny muted">
                  Paste an API key or OAuth Bearer token to connect directly without browser login.
                </div>

                <div className="row-center">
                  <input
                    type="password"
                    className="input"
                    value={secretToken}
                    onChange={(e) => {
                      setSecretToken(e.target.value);
                      setClearSecret(false);
                      setVerifyStatusMessage(null);
                    }}
                    placeholder={
                      editing?.hasSecretToken && !clearSecret
                        ? '•••••••••••••••• (Encrypted token stored)'
                        : `Paste ${meta.name} API Key or Token`
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void handleVerifyToken()}
                    disabled={verifyingToken || !secretToken.trim()}
                    style={{ flexShrink: 0 }}
                  >
                    {verifyingToken ? (
                      <RefreshCw size={12} className="spin" />
                    ) : (
                      <CheckCircle2 size={12} />
                    )}
                    Test & Verify
                  </button>
                  {editing?.hasSecretToken && !clearSecret && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        setClearSecret(true);
                        setSecretToken('');
                        setVerifyStatusMessage(null);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {verifyStatusMessage && (
                  <div
                    className="tiny"
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      background: verifyStatusMessage.success
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'rgba(239, 68, 68, 0.15)',
                      color: verifyStatusMessage.success ? '#86efac' : '#fca5a5'
                    }}
                  >
                    {verifyStatusMessage.text}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Profile & Limits tab */}
              <div className="form-grid">
                <div className="field">
                  <label>Tracking Mode</label>
                  <select
                    className="select"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as TrackingMode)}
                  >
                    <option value="hybrid">Hybrid (Local + Live Quota)</option>
                    <option value="live-api">Live API Only</option>
                    <option value="local-only">Local Logs Only</option>
                    <option value="manual">Manual / Paste /usage Only</option>
                  </select>
                </div>

                <div className="field">
                  <label>Email / User Handle</label>
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
                      placeholder={`Path to ${meta.name} profile directory`}
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
                <strong>Multi-account isolation:</strong> {meta.envVarHint}
              </div>

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
                  <label>5h Rolling Cap Target</label>
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
                  <label>7d Weekly Cap Target</label>
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
            </>
          )}

          <div className="row-between" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(51, 65, 85, 0.4)' }}>
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
              <button type="submit" className="btn btn-primary" disabled={saving || signingIn}>
                {saving ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
