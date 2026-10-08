import { app, BrowserWindow, shell, Menu, ipcMain, Notification } from 'electron';
import * as path from 'path';
import { DockerConnectionManager } from './docker/connectionManager';
import { registerIpc } from './docker/ipcHandlers';

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
  manager = new DockerConnectionManager(path.join(app.getPath('userData'), 'idea-docker'));
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
  void manager?.disconnectAll();
});
