import { app, BrowserWindow, shell, Menu, ipcMain, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DockerConnectionManager } from './docker/connectionManager';
import { registerIpc, abortAllStreams } from './docker/ipcHandlers';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let manager: DockerConnectionManager;

const APP_DISPLAY_NAME = 'Docker 管理器';

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
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
  registerIpc(manager, () => (mainWindow ? [mainWindow] : []));

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
  // kill live log/stats/exec/event streams first so their HTTP responses
  // cannot fire after the window is destroyed
  abortAllStreams();
  void manager?.disconnectAll();
});
