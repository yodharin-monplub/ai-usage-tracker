import { randomUUID } from '../shared/uuid';
import { useCallback, useEffect, useState } from 'react';
import {
  PROVIDER_META,
  type AccountConfig,
  type AccountUsageSnapshot,
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  type DiscoveredProfile,
  type ManualQuotaSnapshot,
  type ProviderId,
  type WidgetMode
} from '../shared/types';
import { AccountModal } from './components/AccountModal';
import { ExpandedDashboard } from './components/ExpandedDashboard';
import { MiniWidget } from './components/MiniWidget';
import { SnapshotModal } from './components/SnapshotModal';

export type ProviderFilter = 'all' | ProviderId;

export interface AccountModalState {
  open: boolean;
  editing?: AccountConfig;
  initialProvider?: ProviderId;
  cloneFrom?: AccountConfig;
}

export default function App() {
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, AccountUsageSnapshot>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [mode, setMode] = useState<WidgetMode>('mini');
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [discovered, setDiscovered] = useState<DiscoveredProfile[]>([]);
  const [accountModal, setAccountModal] = useState<AccountModalState>({ open: false });
  const [snapshotAccount, setSnapshotAccount] = useState<AccountConfig | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [accList, snapMap, appSettings, currentMode] = await Promise.all([
      window.aiTracker.accountsList(),
      window.aiTracker.usageGetAll(),
      window.aiTracker.settingsGet(),
      window.aiTracker.windowGetMode()
    ]);
    setAccounts(accList);
    setSnapshots(snapMap);
    setSettings(appSettings);
    setMode(currentMode);
  }, []);

  useEffect(() => {
    void loadAll();
    const unsubUsage = window.aiTracker.onUsageUpdated((next) => {
      setSnapshots(next);
    });
    const unsubMode = window.aiTracker.onWindowModeChanged((nextMode) => {
      setMode(nextMode);
    });
    const tick = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      unsubUsage();
      unsubMode();
      clearInterval(tick);
    };
  }, [loadAll]);

  const showError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    setErrorToast(msg);
    setTimeout(() => setErrorToast(null), 5000);
  };

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      const next = await window.aiTracker.usageRefreshAll();
      setSnapshots(next);
    } catch (err) {
      showError(err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefreshOne = async (id: string) => {
    setRefreshing(true);
    try {
      const snap = await window.aiTracker.usageRefreshOne(id);
      if (snap) {
        setSnapshots((prev) => ({ ...prev, [id]: snap }));
      }
    } catch (err) {
      showError(err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleMode = async (nextMode: WidgetMode) => {
    try {
      const updated = await window.aiTracker.windowSetMode(nextMode);
      setMode(updated);
    } catch (err) {
      showError(err);
    }
  };

  const handleTogglePinOnTop = async () => {
    try {
      const next = await window.aiTracker.windowSetAlwaysOnTop(!settings.alwaysOnTop);
      setSettings((prev) => ({ ...prev, alwaysOnTop: next }));
    } catch (err) {
      showError(err);
    }
  };

  const handleSaveAccount = async (
    account: AccountConfig,
    secretToken?: string,
    clearSecret?: boolean
  ) => {
    try {
      const saved = await window.aiTracker.accountsSave(account);
      if (clearSecret) {
        await window.aiTracker.accountsClearSecret(saved.id);
      } else if (secretToken && secretToken.trim()) {
        await window.aiTracker.accountsSetSecret(saved.id, secretToken.trim());
      }
      const list = await window.aiTracker.accountsList();
      setAccounts(list);
      const allSnaps = await window.aiTracker.usageGetAll();
      setSnapshots(allSnaps);
      setAccountModal({ open: false });
    } catch (err) {
      showError(err);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    try {
      await window.aiTracker.accountsDelete(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      showError(err);
    }
  };

  const handleDiscover = async () => {
    try {
      const found = await window.aiTracker.accountsDiscover();
      setDiscovered(found);
    } catch (err) {
      showError(err);
    }
  };

  const handleSeedDiscovered = async (profiles: DiscoveredProfile[]) => {
    try {
      await window.aiTracker.accountsSeedDiscovered(profiles);
      const [list, snapMap, found] = await Promise.all([
        window.aiTracker.accountsList(),
        window.aiTracker.usageGetAll(),
        window.aiTracker.accountsDiscover()
      ]);
      setAccounts(list);
      setSnapshots(snapMap);
      setDiscovered(found);
    } catch (err) {
      showError(err);
    }
  };

  const handleApplySnapshot = async (id: string, snapshot: ManualQuotaSnapshot) => {
    try {
      await window.aiTracker.accountsApplySnapshot(id, snapshot);
      const [list, snapMap] = await Promise.all([
        window.aiTracker.accountsList(),
        window.aiTracker.usageGetAll()
      ]);
      setAccounts(list);
      setSnapshots(snapMap);
      setSnapshotAccount(null);
    } catch (err) {
      showError(err);
    }
  };

  const handleUpdateSettings = async (partial: Partial<AppSettings>) => {
    try {
      const next = await window.aiTracker.settingsUpdate(partial);
      setSettings(next);
    } catch (err) {
      showError(err);
    }
  };

  const handleCloneAccount = (source: AccountConfig) => {
    const meta = PROVIDER_META[source.provider];
    const cloned: AccountConfig = {
      ...source,
      id: randomUUID(),
      label: `${source.label} Copy`,
      profileDir: '',
      hasSecretToken: false,
      manualSnapshot: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      limits: {
        ...source.limits,
        rollingLimitMetric: source.limits.rollingLimitMetric || meta.defaultLimitMetric
      }
    };
    setAccountModal({ open: true, cloneFrom: cloned });
  };

  return (
    <div className="app-shell">
      {mode === 'mini' ? (
        <MiniWidget
          accounts={accounts}
          snapshots={snapshots}
          settings={settings}
          filter={filter}
          refreshing={refreshing}
          nowMs={nowMs}
          onFilterChange={setFilter}
          onRefreshAll={() => void handleRefreshAll()}
          onRefreshOne={(id) => void handleRefreshOne(id)}
          onTogglePinOnTop={() => void handleTogglePinOnTop()}
          onExpand={() => void handleToggleMode('expanded')}
          onHide={() => void window.aiTracker.windowHide()}
          onAddAccount={() => setAccountModal({ open: true })}
          onAutoDiscover={async () => {
            const found = await window.aiTracker.accountsDiscover();
            const fresh = found.filter((p) => !p.alreadyAdded);
            if (fresh.length > 0) {
              await handleSeedDiscovered(fresh);
            } else {
              await handleToggleMode('expanded');
            }
          }}
          onOpenSnapshotModal={(acc) => setSnapshotAccount(acc)}
        />
      ) : (
        <ExpandedDashboard
          accounts={accounts}
          snapshots={snapshots}
          settings={settings}
          filter={filter}
          refreshing={refreshing}
          nowMs={nowMs}
          discovered={discovered}
          onFilterChange={setFilter}
          onRefreshAll={() => void handleRefreshAll()}
          onRefreshOne={(id) => void handleRefreshOne(id)}
          onTogglePinOnTop={() => void handleTogglePinOnTop()}
          onMinimizeToWidget={() => void handleToggleMode('mini')}
          onHide={() => void window.aiTracker.windowHide()}
          onAddAccount={(provider) =>
            setAccountModal({ open: true, initialProvider: provider })
          }
          onEditAccount={(acc) => setAccountModal({ open: true, editing: acc })}
          onCloneAccount={handleCloneAccount}
          onDeleteAccount={(id) => void handleDeleteAccount(id)}
          onQuickToggleAccount={(acc) =>
            void handleSaveAccount({ ...acc })
          }
          onDiscover={() => void handleDiscover()}
          onSeedDiscovered={(profiles) => void handleSeedDiscovered(profiles)}
          onOpenSnapshotModal={(acc) => setSnapshotAccount(acc)}
          onUpdateSettings={(partial) => void handleUpdateSettings(partial)}
          onReloadAll={() => void loadAll()}
        />
      )}

      {errorToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 12,
            right: 12,
            background: '#450a0a',
            border: '1px solid #ef4444',
            color: '#fecaca',
            padding: '7px 11px',
            borderRadius: 8,
            fontSize: 12,
            zIndex: 80,
            maxWidth: 320
          }}
        >
          {errorToast}
        </div>
      )}

      {accountModal.open && (
        <AccountModal
          editing={accountModal.editing}
          cloneFrom={accountModal.cloneFrom}
          initialProvider={accountModal.initialProvider}
          onClose={() => setAccountModal({ open: false })}
          onSave={handleSaveAccount}
        />
      )}

      {snapshotAccount && (
        <SnapshotModal
          account={snapshotAccount}
          onClose={() => setSnapshotAccount(null)}
          onApply={(snap) => void handleApplySnapshot(snapshotAccount.id, snap)}
        />
      )}
    </div>
  );
}
