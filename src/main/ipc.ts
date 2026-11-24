import { dialog, ipcMain } from 'electron';
import type {
  AccountConfig,
  AppSettings,
  CredentialVerifyResult,
  DirectAuthResult,
  DiscoveredProfile,
  ManualQuotaSnapshot,
  ProviderId,
  WidgetMode
} from '../shared/types';
import type { UsageAggregator } from './aggregator';
import { AuthManager } from './authManager';
import { createAccountFromDiscovered, discoverLocalProfiles } from './discovery';
import type { AppStore } from './store';
import type { TrayManager } from './trayManager';
import type { WindowManager } from './windowManager';

export function registerIpcHandlers(
  store: AppStore,
  aggregator: UsageAggregator,
  windowManager: WindowManager,
  trayManager: TrayManager | null,
  authManager?: AuthManager
): void {
  const auth = authManager ?? new AuthManager({ store });

  ipcMain.handle('accounts:list', () => store.getAccounts());

  ipcMain.handle('accounts:save', async (_event, account: AccountConfig) => {
    const saved = store.saveAccount(account);
    await aggregator.refreshOne(saved.id);
    trayManager?.updateTooltip();
    return saved;
  });

  ipcMain.handle('accounts:delete', async (_event, id: string) => {
    await auth.signOut(id);
    store.deleteAccount(id);
    aggregator.removeAccount(id);
    trayManager?.updateTooltip();
  });

  ipcMain.handle('accounts:setSecret', async (_event, id: string, secret: string) => {
    store.setAccountSecret(id, secret);
    await aggregator.refreshOne(id);
  });

  ipcMain.handle('accounts:clearSecret', async (_event, id: string) => {
    store.clearAccountSecret(id);
    await aggregator.refreshOne(id);
  });

  ipcMain.handle(
    'accounts:startDirectLogin',
    async (_event, accountId: string, provider: ProviderId): Promise<DirectAuthResult> => {
      const res = await auth.startDirectLogin(accountId, provider);
      if (res.success) {
        await aggregator.refreshOne(accountId);
        trayManager?.updateTooltip();
      }
      return res;
    }
  );

  ipcMain.handle('accounts:cancelDirectLogin', (_event, accountId: string) => {
    auth.cancelDirectLogin(accountId);
  });

  ipcMain.handle(
    'accounts:verifyCredentials',
    async (_event, provider: ProviderId, token: string): Promise<CredentialVerifyResult> => {
      return await auth.verifyCredentials(provider, token);
    }
  );

  ipcMain.handle('accounts:signOut', async (_event, accountId: string) => {
    await auth.signOut(accountId);
    await aggregator.refreshOne(accountId);
    trayManager?.updateTooltip();
  });

  ipcMain.handle('accounts:discover', () =>
    discoverLocalProfiles(undefined, store.getAccounts())
  );

  ipcMain.handle(
    'accounts:seedDiscovered',
    async (_event, profiles: DiscoveredProfile[]) => {
      const existing = store.getAccounts();
      const existingKeys = new Set(
        existing.map((a) => `${a.provider}::${a.profileDir.toLowerCase()}`)
      );
      const created: AccountConfig[] = [];

      for (const p of profiles) {
        const key = `${p.provider}::${p.profileDir.toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        const acc = store.saveAccount(createAccountFromDiscovered(p));
        existingKeys.add(key);
        created.push(acc);
      }

      if (created.length > 0) {
        await aggregator.refreshAll();
        trayManager?.updateTooltip();
      }
      return created;
    }
  );

  ipcMain.handle(
    'accounts:applySnapshot',
    async (_event, id: string, snapshot: ManualQuotaSnapshot) => {
      const existing = store.getAccount(id);
      if (!existing) {
        throw new Error(`Account ${id} not found.`);
      }
      const updated = store.saveAccount({
        ...existing,
        manualSnapshot: snapshot
      });
      await aggregator.refreshOne(id);
      trayManager?.updateTooltip();
      return updated;
    }
  );

  ipcMain.handle('usage:getAll', () => aggregator.getAllSnapshots());

  ipcMain.handle('usage:refreshAll', async () => {
    const res = await aggregator.refreshAll();
    trayManager?.updateTooltip();
    return res;
  });

  ipcMain.handle('usage:refreshOne', async (_event, id: string) => {
    const res = await aggregator.refreshOne(id);
    trayManager?.updateTooltip();
    return res;
  });

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:update', (_event, partial: Partial<AppSettings>) => {
    const prev = store.getSettings();
    const updated = store.updateSettings(partial);
    windowManager.applySettings(updated);
    if (prev.pollIntervalSeconds !== updated.pollIntervalSeconds) {
      aggregator.start(updated.pollIntervalSeconds);
    }
    trayManager?.refreshMenu();
    return updated;
  });

  ipcMain.handle('settings:exportJson', () => store.exportSanitizedJson());

  ipcMain.handle('settings:importJson', async (_event, rawJson: string) => {
    const res = store.importSanitizedJson(rawJson);
    windowManager.applySettings(res.settings);
    aggregator.start(res.settings.pollIntervalSeconds);
    await aggregator.refreshAll();
    trayManager?.refreshMenu();
    return res;
  });

  ipcMain.handle('window:getMode', () => windowManager.getMode());

  ipcMain.handle('window:setMode', (_event, mode: WidgetMode) => {
    const next = windowManager.setMode(mode);
    trayManager?.refreshMenu();
    return next;
  });

  ipcMain.handle('window:setAlwaysOnTop', (_event, value: boolean) => {
    const next = windowManager.setAlwaysOnTop(value);
    trayManager?.refreshMenu();
    return next;
  });

  ipcMain.handle('window:hide', () => {
    windowManager.hide();
  });

  ipcMain.handle('window:pickDirectory', async (_event, defaultPath?: string) => {
    const win = windowManager.getWindow();
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      defaultPath: defaultPath && defaultPath.trim() ? defaultPath.trim() : undefined
    };
    const res = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
}
