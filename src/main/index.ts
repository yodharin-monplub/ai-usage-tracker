import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { UsageAggregator } from './aggregator';
import { AuthManager } from './authManager';
import { createAccountFromDiscovered, discoverLocalProfiles } from './discovery';
import { registerIpcHandlers } from './ipc';
import { AppStore, createElectronSecretCipher } from './store';
import { TrayManager } from './trayManager';
import { WindowManager } from './windowManager';

const isSmokeTest = process.env.AI_TRACKER_SMOKE_TEST?.trim() === '1' || process.argv.includes('--smoke');

if (!isSmokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
}

let store: AppStore | null = null;
let aggregator: UsageAggregator | null = null;
let windowManager: WindowManager | null = null;
let trayManager: TrayManager | null = null;
let authManager: AuthManager | null = null;
let smokeTempDir: string | null = null;

async function bootstrap(): Promise<void> {
  const appRootDir = app.getAppPath();
  const dataDir = isSmokeTest
    ? (smokeTempDir = mkdtempSync(path.join(os.tmpdir(), 'ai-tracker-smoke-')))
    : app.getPath('userData');

  const cipher = createElectronSecretCipher(safeStorage);
  store = new AppStore(dataDir, cipher);
  aggregator = new UsageAggregator(store);
  windowManager = new WindowManager(store);
  authManager = new AuthManager({ store });

  if (!isSmokeTest) {
    // Seed auto-discovered profiles once on fresh install
    if (store.getAccounts().length === 0) {
      const discovered = await discoverLocalProfiles(undefined, []);
      for (const profile of discovered) {
        store.saveAccount(createAccountFromDiscovered(profile));
      }
    }

    trayManager = new TrayManager(store, windowManager, aggregator, () => {
      windowManager?.markQuitting();
      aggregator?.stop();
      trayManager?.destroy();
      app.quit();
    });
    trayManager.init(appRootDir);
  }

  registerIpcHandlers(store, aggregator, windowManager, trayManager, authManager);

  const win = windowManager.createWindow(appRootDir, isSmokeTest);

  windowManager.onModeChanged(() => {
    trayManager?.refreshMenu();
  });

  aggregator.onUpdated((snapshots) => {
    if (!win.isDestroyed()) {
      win.webContents.send('usage:updated', snapshots);
    }
    trayManager?.updateTooltip();
  });

  if (isSmokeTest) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Smoke test timed out waiting for renderer load')), 15_000);
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        clearTimeout(timer);
        reject(new Error(`Renderer failed to load (${code}): ${desc}`));
      });
    });

    const snapshots = await aggregator.refreshAll();
    console.log(`[SMOKE_OK] renderer loaded, snapshots=${Object.keys(snapshots).length}`);
    if (smokeTempDir) {
      try {
        rmSync(smokeTempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure on exit
      }
    }
    app.exit(0);
    return;
  }

  await aggregator.refreshAll();
  aggregator.start(store.getSettings().pollIntervalSeconds);
}

app.on('second-instance', () => {
  windowManager?.show();
});

app.on('before-quit', () => {
  windowManager?.markQuitting();
  aggregator?.stop();
  trayManager?.destroy();
});

app.on('window-all-closed', () => {
  // Keep alive in Windows tray unless quitting explicitly
  if (isSmokeTest) {
    app.quit();
  }
});

app.whenReady().then(() => {
  void bootstrap().catch((err) => {
    console.error('Fatal bootstrap error:', err);
    if (isSmokeTest) {
      process.exit(1);
    }
  });
});
