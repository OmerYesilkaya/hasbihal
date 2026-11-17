import { app, BrowserWindow, ipcMain, nativeTheme, session } from 'electron';
import { hostname } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { RecoverRequest, SignInRequest, SignUpRequest } from '@hasbihal/protocol';
import { IPC, type AppInfo, type AuthResult } from '../shared/app-info.ts';
import { registerAppSchemePrivileges, serveRendererFromAppScheme } from './app-protocol.ts';
import { AuthSession } from './auth-session.ts';
import { Background } from './background.ts';
import { DeepLinkRouter } from './deep-links.ts';
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

app.enableSandbox();
registerAppSchemePrivileges();

// Windows names notifications and groups taskbar buttons by this ID, which must match the
// installer's shortcut (appId in electron-builder.yml) to show as "Hasbihal". Unpackaged runs
// have no such shortcut and keep Electron's own ID, under which notifications still show.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('com.hasbihal.desktop');

const deepLinks = new DeepLinkRouter();
const idleWatcher = new IdleWatcher();
const shortcuts = new HangoutShortcuts();
// Packaged builds only: development and test runs never register a login item.
const background = new Background({ manageStartup: app.isPackaged });
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

  // Windows and Linux put Electron's default menu (File, Edit, View…) inside the window; macOS
  // shows it in the system menu bar. Hide it so the window looks the same everywhere. The menu
  // stays set, so its shortcuts (copy, paste, reload, developer tools) keep working.
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false);

  window.once('ready-to-show', () => {
    // Started with the computer (A39): stay in the tray until wanted.
    if (!background.startedHidden) window.show();
  });
  background.attach(window);
  deepLinks.setTarget(window.webContents);
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
  handle(IPC.authAccessToken, z.boolean(), (refresh) => auth.accessToken(refresh));
  ipcMain.handle(IPC.authSignOut, () => auth.signOut());
  ipcMain.handle(IPC.deepLinkTakePending, () => deepLinks.takePending());
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

  mainWindow = createMainWindow();

  // macOS: clicking the Dock icon brings the hidden window back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    else background.show();
  });
});

app.on('second-instance', (_event, argv) => {
  deepLinks.handleArgv(argv);
  background.show();
});

// Closing the window only hides it (A38, Background), so this happens only while quitting.
app.on('window-all-closed', () => {
  app.quit();
});
