import { existsSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { AppSettings, WidgetMode } from '../shared/types';
import type { AppStore } from './store';

const MINI_SIZE = { width: 356, height: 420 };
const EXPANDED_SIZE = { width: 880, height: 620 };

export class WindowManager {
  private readonly store: AppStore;
  private win: BrowserWindow | null = null;
  private mode: WidgetMode;
  private isQuitting = false;
  private boundsSaveTimer: NodeJS.Timeout | null = null;
  private onModeChangeCb?: (mode: WidgetMode) => void;

  constructor(store: AppStore) {
    this.store = store;
    this.mode = store.getSettings().startMode;
  }

  onModeChanged(cb: (mode: WidgetMode) => void): void {
    this.onModeChangeCb = cb;
  }

  getWindow(): BrowserWindow | null {
    return this.win;
  }

  getMode(): WidgetMode {
    return this.mode;
  }

  markQuitting(): void {
    this.isQuitting = true;
  }

  private clampToScreen(rect: Partial<Rectangle>, fallbackW: number, fallbackH: number): Rectangle {
    const width = Math.max(300, rect.width ?? fallbackW);
    const height = Math.max(220, rect.height ?? fallbackH);

    const displays = screen.getAllDisplays();
    const targetDisplay =
      typeof rect.x === 'number' && typeof rect.y === 'number'
        ? screen.getDisplayNearestPoint({ x: rect.x, y: rect.y })
        : screen.getPrimaryDisplay();
    const area = (targetDisplay ?? displays[0]).workArea;

    const clampedW = Math.min(width, area.width);
    const clampedH = Math.min(height, area.height);
    const x =
      typeof rect.x === 'number'
        ? Math.max(area.x, Math.min(rect.x, area.x + area.width - clampedW))
        : area.x + area.width - clampedW - 24;
    const y =
      typeof rect.y === 'number'
        ? Math.max(area.y, Math.min(rect.y, area.y + area.height - clampedH))
        : area.y + area.height - clampedH - 24;

    return { x, y, width: clampedW, height: clampedH };
  }

  createWindow(appRootDir: string, smokeTest = false): BrowserWindow {
    const settings = this.store.getSettings();
    const defaultSize = this.mode === 'mini' ? MINI_SIZE : EXPANDED_SIZE;
    const saved = this.store.getWindowBounds();
    const initialBounds = this.clampToScreen(
      {
        x: saved?.x,
        y: saved?.y,
        width: defaultSize.width,
        height: defaultSize.height
      },
      defaultSize.width,
      defaultSize.height
    );

    const unpackedRoot = appRootDir.replace('app.asar', 'app.asar.unpacked');
    const iconCandidates = [
      path.join(unpackedRoot, 'assets', 'icon.png'),
      path.join(appRootDir, 'assets', 'icon.png')
    ];
    const iconPath = iconCandidates.find((p) => existsSync(p));
    this.win = new BrowserWindow({
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
      minWidth: 300,
      minHeight: 220,
      frame: false,
      transparent: false,
      backgroundColor: '#0a0e16',
      show: false,
      resizable: true,
      skipTaskbar: false,
      alwaysOnTop: settings.alwaysOnTop,
      opacity: settings.opacity,
      icon: iconPath,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    this.win.once('ready-to-show', () => {
      if (!smokeTest && this.win && !this.win.isDestroyed()) {
        this.win.show();
      }
    });

    const scheduleBoundsSave = () => {
      if (!this.win || this.win.isDestroyed()) return;
      if (this.boundsSaveTimer) clearTimeout(this.boundsSaveTimer);
      this.boundsSaveTimer = setTimeout(() => {
        if (!this.win || this.win.isDestroyed()) return;
        const b = this.win.getBounds();
        this.store.setWindowBounds(b);
      }, 350);
    };

    this.win.on('moved', scheduleBoundsSave);
    this.win.on('resized', scheduleBoundsSave);

    this.win.on('close', (event) => {
      if (!this.isQuitting && this.store.getSettings().minimizeToTray && this.win) {
        event.preventDefault();
        this.win.hide();
      }
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      void this.win.loadURL(devServerUrl);
    } else {
      const distHtml = path.join(appRootDir, 'dist', 'index.html');
      void this.win.loadFile(distHtml);
    }

    return this.win;
  }

  setMode(nextMode: WidgetMode): WidgetMode {
    this.mode = nextMode;
    const size = nextMode === 'mini' ? MINI_SIZE : EXPANDED_SIZE;
    if (this.win && !this.win.isDestroyed()) {
      const current = this.win.getBounds();
      const clamped = this.clampToScreen(
        { x: current.x, y: current.y, width: size.width, height: size.height },
        size.width,
        size.height
      );
      this.win.setBounds(clamped, true);
      this.win.webContents.send('window:modeChanged', nextMode);
    }
    this.onModeChangeCb?.(nextMode);
    return nextMode;
  }

  setAlwaysOnTop(value: boolean): boolean {
    this.store.updateSettings({ alwaysOnTop: value });
    if (this.win && !this.win.isDestroyed()) {
      this.win.setAlwaysOnTop(value, 'floating');
    }
    return value;
  }

  applySettings(settings: AppSettings): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
    this.win.setOpacity(settings.opacity);
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  hide(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.hide();
  }

  toggleVisibility(): void {
    if (!this.win || this.win.isDestroyed()) return;
    if (this.win.isVisible()) this.hide();
    else this.show();
  }
}
