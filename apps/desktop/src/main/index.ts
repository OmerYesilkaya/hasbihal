import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron';
import { hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { RecoverRequest, SignInRequest, SignUpRequest } from '@hasbihal/protocol';
import { IPC, type AppInfo, type AuthResult } from '../shared/app-info.ts';
import { registerAppSchemePrivileges, serveRendererFromAppScheme } from './app-protocol.ts';
import { AuthSession } from './auth-session.ts';
import { DeepLinkRouter } from './deep-links.ts';
import { APP_ORIGIN, applyAppWideSecurity, contentSecurityPolicy } from './security.ts';
import { SafeStorageTokenStore } from './token-store.ts';

const devServerUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !app.isPackaged && devServerUrl !== undefined;

// Unpackaged builds (development, end-to-end tests) may point at another server and keep their
// data elsewhere, e.g. to run two signed-in copies side by side. Packaged builds never do.
const devOverride = (name: string) => (app.isPackaged ? undefined : process.env[name]);
const serverUrl =
  devOverride('HASBIHAL_SERVER_URL') ??
  import.meta.env.MAIN_VITE_SERVER_URL ??
  'http://localhost:8080';
const userDataDir = devOverride('HASBIHAL_USER_DATA_DIR');
if (userDataDir) app.setPath('userData', path.resolve(userDataDir));

app.enableSandbox();
registerAppSchemePrivileges();

const deepLinks = new DeepLinkRouter();
deepLinks.listen();

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
  deepLinks.setTarget(window.webContents);

  if (isDev) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(`${APP_ORIGIN}/index.html`);
  }
  return window;
}

/** "omers-macbook.local" → "omers-macbook"; shown in the sessions list. */
function deviceName(): string {
  return hostname().replace(/\.local$/, '') || (process.platform === 'darwin' ? 'Mac' : 'PC');
}

/**
 * Registers an IPC handler whose argument is validated first: the renderer is treated as
 * untrusted (ARCHITECTURE §4.2), so nothing it sends reaches the session unchecked.
 */
function handle<S extends z.ZodType, R>(
  channel: string,
  schema: S,
  run: (input: z.infer<S>) => Promise<AuthResult<R>>,
): void {
  ipcMain.handle(channel, (_event, input: unknown): Promise<AuthResult<R>> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return Promise.resolve({
        ok: false,
        error: { code: 'validation_failed', message: 'Invalid request.' },
      });
    }
    return run(parsed.data);
  });
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

  deepLinks.register();

  const auth = new AuthSession({
    serverUrl,
    deviceName: deviceName(),
    store: new SafeStorageTokenStore(path.join(app.getPath('userData'), 'session.bin')),
  });
  auth.onSessionEnded(() => mainWindow?.webContents.send(IPC.authSessionEnded));

  ipcMain.handle(IPC.getAppInfo, (): AppInfo => ({
    appVersion: app.getVersion(),
    platform:
      process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    serverUrl,
  }));
  handle(IPC.authRestore, z.undefined(), () => auth.restore());
  handle(IPC.authInviteInfo, z.string().min(1).max(200), (token) => auth.inviteInfo(token));
  // The device name is the main process's to set, so the renderer's requests leave it out.
  handle(IPC.authSignUp, SignUpRequest.omit({ deviceName: true }), (r) => auth.signUp(r));
  handle(IPC.authSignIn, SignInRequest.omit({ deviceName: true }), (r) => auth.signIn(r));
  handle(IPC.authRecover, RecoverRequest.omit({ deviceName: true }), (r) => auth.recover(r));
  handle(IPC.authAccessToken, z.undefined(), () => auth.accessToken());
  ipcMain.handle(IPC.authSignOut, () => auth.signOut());
  ipcMain.handle(IPC.deepLinkTakePending, () => deepLinks.takePending());

  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('second-instance', (_event, argv) => {
  deepLinks.handleArgv(argv);
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  // Tray behaviour (DECISIONS A38) arrives in M6; until then quit like a normal app off macOS.
  if (process.platform !== 'darwin') app.quit();
});
