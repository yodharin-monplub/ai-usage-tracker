import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountConfig,
  AccountUsageSnapshot,
  AiTrackerApi,
  AppSettings,
  DiscoveredProfile,
  ManualQuotaSnapshot,
  ProviderId,
  WidgetMode
} from '../shared/types';

const api: AiTrackerApi = {
  accountsList: () => ipcRenderer.invoke('accounts:list'),
  accountsSave: (account: AccountConfig) => ipcRenderer.invoke('accounts:save', account),
  accountsDelete: (id: string) => ipcRenderer.invoke('accounts:delete', id),
  accountsSetSecret: (id: string, secret: string) =>
    ipcRenderer.invoke('accounts:setSecret', id, secret),
  accountsClearSecret: (id: string) => ipcRenderer.invoke('accounts:clearSecret', id),
  accountsStartDirectLogin: (accountId: string, provider: ProviderId) =>
    ipcRenderer.invoke('accounts:startDirectLogin', accountId, provider),
  accountsCancelDirectLogin: (accountId: string) =>
    ipcRenderer.invoke('accounts:cancelDirectLogin', accountId),
  accountsVerifyCredentials: (provider: ProviderId, token: string) =>
    ipcRenderer.invoke('accounts:verifyCredentials', provider, token),
  accountsSignOut: (accountId: string) =>
    ipcRenderer.invoke('accounts:signOut', accountId),
  accountsDiscover: () => ipcRenderer.invoke('accounts:discover'),
  accountsSeedDiscovered: (profiles: DiscoveredProfile[]) =>
    ipcRenderer.invoke('accounts:seedDiscovered', profiles),
  accountsApplySnapshot: (id: string, snapshot: ManualQuotaSnapshot) =>
    ipcRenderer.invoke('accounts:applySnapshot', id, snapshot),
  usageGetAll: () => ipcRenderer.invoke('usage:getAll'),
  usageRefreshAll: () => ipcRenderer.invoke('usage:refreshAll'),
  usageRefreshOne: (id: string) => ipcRenderer.invoke('usage:refreshOne', id),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', partial),
  settingsExportJson: () => ipcRenderer.invoke('settings:exportJson'),
  settingsImportJson: (rawJson: string) =>
    ipcRenderer.invoke('settings:importJson', rawJson),
  windowGetMode: () => ipcRenderer.invoke('window:getMode'),
  windowSetMode: (mode: WidgetMode) => ipcRenderer.invoke('window:setMode', mode),
  windowSetAlwaysOnTop: (value: boolean) =>
    ipcRenderer.invoke('window:setAlwaysOnTop', value),
  windowHide: () => ipcRenderer.invoke('window:hide'),
  windowPickDirectory: (defaultPath?: string) =>
    ipcRenderer.invoke('window:pickDirectory', defaultPath),
  onUsageUpdated: (callback: (snapshots: Record<string, AccountUsageSnapshot>) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshots: Record<string, AccountUsageSnapshot>
    ) => {
      callback(snapshots);
    };
    ipcRenderer.on('usage:updated', listener);
    return () => {
      ipcRenderer.removeListener('usage:updated', listener);
    };
  },
  onWindowModeChanged: (callback: (mode: WidgetMode) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, mode: WidgetMode) => {
      callback(mode);
    };
    ipcRenderer.on('window:modeChanged', listener);
    return () => {
      ipcRenderer.removeListener('window:modeChanged', listener);
    };
  }
};

contextBridge.exposeInMainWorld('aiTracker', api);
