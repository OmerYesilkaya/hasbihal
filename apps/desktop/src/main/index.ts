import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron';
import path from 'node:path';
import { IPC, type AppInfo } from '../shared/app-info.ts';
import { registerAppSchemePrivileges, serveRendererFromAppScheme } from './app-protocol.ts';
import { APP_ORIGIN, applyAppWideSecurity, contentSecurityPolicy } from './security.ts';

const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !app.isPackaged && devServerUrl !== undefined;
const serverUrl = import.meta.env.MAIN_VITE_SERVER_URL ?? 'http://localhost:8080';

app.enableSandbox();
registerAppSchemePrivileges();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Hasbihal',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#241A17' : '#FBF6EE',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  if (isDev) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(`${APP_ORIGIN}/index.html`);
  }
  return window;
}

void app.whenReady().then(() => {
  const csp = contentSecurityPolicy({ serverUrl, dev: isDev });
  applyAppWideSecurity({ devServerUrl: isDev ? devServerUrl : undefined });

  if (isDev) {
    // The Vite dev server doesn't send our CSP, so attach it to every response.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      });
    });
  } else {
    serveRendererFromAppScheme(path.join(import.meta.dirname, '../renderer'), csp);
  }

  ipcMain.handle(IPC.getAppInfo, (): AppInfo => ({
    appVersion: app.getVersion(),
    platform:
      process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    serverUrl,
  }));

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  // Tray behaviour (DECISIONS A38) arrives in M6; until then quit like a normal app off macOS.
  if (process.platform !== 'darwin') app.quit();
});
