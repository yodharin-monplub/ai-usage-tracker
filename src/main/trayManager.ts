import { existsSync } from 'node:fs';
import path from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import type { UsageAggregator } from './aggregator';
import type { AppStore } from './store';
import type { WindowManager } from './windowManager';

export class TrayManager {
  private tray: Tray | null = null;
  private readonly store: AppStore;
  private readonly windowManager: WindowManager;
  private readonly aggregator: UsageAggregator;
  private readonly onQuit: () => void;

  constructor(
    store: AppStore,
    windowManager: WindowManager,
    aggregator: UsageAggregator,
    onQuit: () => void
  ) {
    this.store = store;
    this.windowManager = windowManager;
    this.aggregator = aggregator;
    this.onQuit = onQuit;
  }

  init(appRootDir: string): void {
    const unpackedRoot = appRootDir.replace('app.asar', 'app.asar.unpacked');
    const iconCandidates = [
      path.join(unpackedRoot, 'assets', 'tray-icon.png'),
      path.join(unpackedRoot, 'assets', 'icon.png'),
      path.join(appRootDir, 'assets', 'tray-icon.png'),
      path.join(appRootDir, 'assets', 'icon.png')
    ];
    let icon = nativeImage.createEmpty();
    for (const candidate of iconCandidates) {
      if (existsSync(candidate)) {
        icon = nativeImage.createFromPath(candidate);
        break;
      }
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('AI Tracker');
    this.tray.on('click', () => {
      this.windowManager.toggleVisibility();
    });

    this.refreshMenu();
  }

  refreshMenu(): void {
    if (!this.tray) return;
    const settings = this.store.getSettings();
    const currentMode = this.windowManager.getMode();

    const menu = Menu.buildFromTemplate([
      {
        label: 'Show / Hide Widget',
        click: () => this.windowManager.toggleVisibility()
      },
      { type: 'separator' },
      {
        label: 'Mini Widget',
        type: 'radio',
        checked: currentMode === 'mini',
        click: () => {
          this.windowManager.show();
          this.windowManager.setMode('mini');
        }
      },
      {
        label: 'Expanded Dashboard',
        type: 'radio',
        checked: currentMode === 'expanded',
        click: () => {
          this.windowManager.show();
          this.windowManager.setMode('expanded');
        }
      },
      { type: 'separator' },
      {
        label: 'Refresh All Now',
        click: () => {
          void this.aggregator.refreshAll();
        }
      },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (item) => {
          this.windowManager.setAlwaysOnTop(item.checked);
          this.refreshMenu();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit AI Tracker',
        click: () => this.onQuit()
      }
    ]);

    this.tray.setContextMenu(menu);
    this.tray.setToolTip(this.aggregator.buildTrayTooltip());
  }

  updateTooltip(): void {
    if (!this.tray) return;
    this.tray.setToolTip(this.aggregator.buildTrayTooltip());
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
