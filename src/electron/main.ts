import { app, BrowserWindow, shell, Menu, ipcMain, Notification, session, Tray, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DockerConnectionManager } from './docker/connectionManager';
import { registerIpc, abortAllStreams } from './docker/ipcHandlers';
import { sweepStaleComposeTls } from './docker/composeRunner';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let manager: DockerConnectionManager;
let tray: Tray | null = null;
let minimizeToTray = false;
let quitting = false;

const APP_DISPLAY_NAME = 'Docker 管理器';

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/** System tray: quick show/quit; keeps the app reachable while hidden. */
function createTray() {
  try {
    const iconPath = path.join(__dirname, '../build/icon.ico');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    tray = new Tray(image);
    tray.setToolTip(APP_DISPLAY_NAME);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showMainWindow() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ])
    );
    tray.on('click', () => showMainWindow());
  } catch (err) {
    console.error('[main] tray init failed:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#2B2B2B',
    title: APP_DISPLAY_NAME,
    autoHideMenuBar: true,
    // dark chrome so the native frame matches the app theme
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#2b2b2b', symbolColor: '#d8d8d8', height: 34 }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();

  // Show even if ready-to-show is delayed (e.g. dev server not up yet).
  let shown = false;
  const showOnce = () => {
    if (shown || !mainWindow) return;
    shown = true;
    if (!mainWindow.isDestroyed()) mainWindow.show();
  };
  mainWindow.once('ready-to-show', showOnce);
  setTimeout(showOnce, 2000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[window] load failed ${code} ${desc} @ ${url}`);
    showOnce();
  });

  if (isDev) {
    void mainWindow
      .loadURL('http://127.0.0.1:5173')
      .catch((e) => {
        console.error('[window] loadURL failed:', e);
        showOnce();
      });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // close-to-tray: hide instead of quitting when enabled (real quit goes
  // through the tray menu / a second close while already hidden)
  mainWindow.on('close', (e) => {
    if (minimizeToTray && !quitting && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// single instance: a second launch must not fight over userData (config
// writes, compose TLS staging dirs) — it just focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
if (gotLock) app.on('second-instance', () => showMainWindow());

app.whenReady().then(() => {
  if (!gotLock) return; // losing the lock → quitting, never create a window
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') {
    // required for toast notifications to attribute to this app
    app.setAppUserModelId('com.dockyard.docker-manager');
  }
  // 数据目录（旧构建曾写死为 'idea-docker'，已改名 'config'）
  const dataDir = path.join(app.getPath('userData'), 'config');
  // 一次性迁移：将旧的 'idea-docker' 目录改名为 'config'，保留已有连接数据
  const legacyDir = path.join(app.getPath('userData'), 'idea-docker');
  if (!fs.existsSync(dataDir) && fs.existsSync(legacyDir)) {
    try {
      fs.renameSync(legacyDir, dataDir);
      console.log(`[main] 已迁移旧数据目录 ${legacyDir} -> ${dataDir}`);
    } catch (err) {
      console.error(`[main] 迁移旧数据目录失败（将以空配置启动）:`, err);
    }
  }
  manager = new DockerConnectionManager(dataDir);
  registerIpc(manager);
  sweepStaleComposeTls(dataDir);

  // Production-only CSP (dev needs Vite's inline HMR scripts/styles).
  // style-src unsafe-inline is required: components use inline style props.
  if (!isDev) {
    const CSP = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
    ].join('; ');
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
        },
      });
    });
  }

  // OS notification bridge for the renderer (e.g. abnormal container exits)
  ipcMain.on('ui:notify', (_e, p: { title?: string; body?: string }) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: p.title || 'Docker 管理器', body: p.body || '' }).show();
      }
    } catch {
      /* ignore */
    }
  });

  // behavior toggles pushed from the renderer settings page (localStorage is
  // renderer-only, so the values are mirrored here on change and at startup)
  ipcMain.on('ui:setMinimizeToTray', (_e, v: boolean) => {
    minimizeToTray = !!v;
  });
  ipcMain.on('ui:setAutoLaunch', (_e, v: boolean) => {
    try {
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: !!v, path: process.execPath });
      }
    } catch (err) {
      console.error('[main] setLoginItemSettings failed:', err);
    }
  });

  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
  try {
    tray?.destroy();
    tray = null;
  } catch {
    /* ignore */
  }
  // kill live log/stats/exec/event streams first so their HTTP responses
  // cannot fire after the window is destroyed
  abortAllStreams();
  void manager?.disconnectAll();
});
