import { app, BrowserWindow, ipcMain, nativeTheme, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { LOCALES } from '@hasbihal/core';
import { IPC, type AppInfo, type AuthResult, type UpdateState } from '../shared/app-info.ts';
import { registerAppSchemePrivileges, serveRendererFromAppScheme } from './app-protocol.ts';
import { AuthSession } from './auth-session.ts';
import { Background } from './background.ts';
import { GOOGLE_ENDPOINTS, GoogleSignIn, type GoogleClient } from './google-sign-in.ts';
import { IdleWatcher } from './idle.ts';
import { ScreenSources } from './screen-share.ts';
import { HangoutShortcuts } from './shortcuts.ts';
import {
  APP_ORIGIN,
  applyAppWideSecurity,
  contentSecurityPolicy,
  isTrustedOrigin,
} from './security.ts';
import { SafeStorageTokenStore } from './token-store.ts';
import { Updates } from './updates.ts';

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
// A LiveKit on its own origin (local test runs); production LiveKit shares the server's.
const livekitUrl = devOverride('HASBIHAL_LIVEKIT_URL');
if (userDataDir) app.setPath('userData', path.resolve(userDataDir));

/**
 * The Google OAuth client people sign in with (A25), built in like the server address. Unpackaged
 * builds may use a stand-in Google instead (end-to-end tests), visited by a headless "browser",
 * and suggest which of its accounts to use.
 */
const fakeGoogleUrl = devOverride('HASBIHAL_GOOGLE_URL');
function googleSignIn(): GoogleSignIn | undefined {
  if (fakeGoogleUrl) {
    return new GoogleSignIn({
      client: {
        clientId: 'hasbihal-e2e',
        clientSecret: 'e2e',
        authUrl: `${fakeGoogleUrl}/authorize`,
        tokenUrl: `${fakeGoogleUrl}/token`,
      },
      openBrowser: async (url) => {
        await fetch(url);
      },
      loginHint: devOverride('HASBIHAL_GOOGLE_LOGIN_HINT'),
    });
  }
  const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  const client: GoogleClient = { clientId, clientSecret, ...GOOGLE_ENDPOINTS };
  return new GoogleSignIn({ client, openBrowser: (url) => shell.openExternal(url) });
}

app.enableSandbox();
registerAppSchemePrivileges();

// Windows names notifications and groups taskbar buttons by this ID, which must match the
// installer's shortcut (appId in electron-builder.yml) to show as "Hasbihal". Unpackaged runs
// have no such shortcut and keep Electron's own ID, under which notifications still show.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('com.hasbihal.desktop');

const idleWatcher = new IdleWatcher();
const shortcuts = new HangoutShortcuts();
// Packaged builds only: development and test runs never register a login item.
const background = new Background({ manageStartup: app.isPackaged });

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

  // Windows and Linux put Electron's default menu (File, Edit, View…) inside the window; macOS
  // shows it in the system menu bar. Hide it so the window looks the same everywhere. The menu
  // stays set, so its shortcuts (copy, paste, reload, developer tools) keep working.
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false);

  window.once('ready-to-show', () => {
    // Started with the computer (A39): stay in the tray until wanted.
    if (!background.startedHidden) window.show();
  });
  background.attach(window);
  idleWatcher.setTarget(window.webContents);
  shortcuts.setTarget(window.webContents);

  if (isDev) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadURL(`${APP_ORIGIN}/index.html`);
  }
  return window;
}

/**
 * The name shown in the sessions list: the computer's name ("omers-macbook.local" → "omers-macbook"),
 * or "Mac"/"Windows PC" when it has none worth showing (empty, or just an IP address).
 */
function deviceName(): string {
  const name = hostname().replace(/\.(local|lan|home)$/i, '');
  const meaningless = !name || /^[\d.]+$/.test(name) || name.includes(':');
  if (!meaningless) return name;
  return process.platform === 'darwin'
    ? 'Mac'
    : process.platform === 'win32'
      ? 'Windows PC'
      : 'Linux';
}

function canUpdate(): boolean {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
}

function createUpdates(): Updates {
  return new Updates({
    updater: electronUpdater.autoUpdater,
    inApplicationsFolder: () => process.platform !== 'darwin' || app.isInApplicationsFolder(),
    moveToApplicationsFolder: () => app.moveToApplicationsFolder(),
    onChange: (state) => mainWindow?.webContents.send(IPC.updateChanged, state),
  });
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

void app.whenReady().then(async () => {
  const csp = contentSecurityPolicy({
    serverUrl,
    dev: isDev,
    ...(livekitUrl ? { livekitUrl } : {}),
  });
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

  const auth = new AuthSession({
    serverUrl,
    google: googleSignIn(),
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
  handle(IPC.authGoogle, z.undefined(), async () => {
    const result = await auth.signInWithGoogle();
    // The browser has the focus now: bring the app back to where the person continues.
    background.show();
    return result;
  });
  ipcMain.on(IPC.authGoogleCancel, () => {
    auth.cancelGoogleSignIn();
  });
  handle(IPC.authRequestAccess, z.undefined(), () => auth.requestAccess());
  handle(IPC.authAccessToken, z.boolean(), (refresh) => auth.accessToken(refresh));
  ipcMain.handle(IPC.authSignOut, () => auth.signOut());
  ipcMain.handle(IPC.systemIsIdle, () => idleWatcher.idle);
  ipcMain.on(IPC.systemShortcuts, (_event, active: unknown) => {
    shortcuts.setActive(active === true);
  });
  ipcMain.on(IPC.focusWindow, () => {
    background.show();
  });
  ipcMain.handle(IPC.launchAtStartup, () => background.launchAtStartup());
  ipcMain.handle(IPC.setLaunchAtStartup, (_event, on: unknown) =>
    background.setLaunchAtStartup(on === true),
  );
  ipcMain.handle(IPC.language, () => background.language());
  ipcMain.handle(IPC.setLanguage, async (_event, language: unknown) => {
    if (language === null) await background.setLanguage(null);
    const locale = LOCALES.find((l) => l === language);
    if (locale) await background.setLanguage(locale);
  });
  ipcMain.on(IPC.mentions, (_event, count: unknown) => {
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0)
      background.setMentions(count);
  });
  await background.start();
  // End-to-end tests share the app's own page instead of a real screen (no OS permission).
  const screens = new ScreenSources({
    fake: devOverride('HASBIHAL_FAKE_SCREEN') === '1',
    isTrusted: (url) => isTrustedOrigin(url, isDev ? devServerUrl : undefined),
  });
  screens.install(session.defaultSession);
  ipcMain.handle(IPC.screenSources, () => screens.list());
  ipcMain.handle(IPC.screenChoose, (_event, id: unknown, audio: unknown) => {
    if (typeof id === 'string' && id.length < 200) screens.choose(id, audio === true);
  });
  idleWatcher.start();

  // In-app updates (A30): installed builds for macOS and Windows only. Development and test runs
  // have nothing to update, and electron-updater wouldn't find its app-update.yml.
  const updates = canUpdate() ? createUpdates() : undefined;
  ipcMain.handle(IPC.updateState, (): UpdateState => updates?.state ?? { kind: 'none' });
  ipcMain.on(IPC.updateCheck, () => {
    void updates?.check();
  });
  ipcMain.on(IPC.updateInstall, () => {
    void updates?.install();
  });
  updates?.start();

  mainWindow = createMainWindow();

  // macOS: clicking the Dock icon brings the hidden window back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    else background.show();
  });
});

app.on('second-instance', () => {
  background.show();
});

// Closing the window only hides it (A38, Background), so this happens only while quitting.
app.on('window-all-closed', () => {
  app.quit();
});
