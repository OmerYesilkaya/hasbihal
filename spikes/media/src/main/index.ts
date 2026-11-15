import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AccessToken } from 'livekit-server-sdk';

// LiveKit dev-mode credentials (infra/compose.dev.yml). Spike only.
const LIVEKIT_KEY = 'devkey';
const LIVEKIT_SECRET = 'secret';
const ROOM = 'spike';

// `--auto=<file.json>` runs the automatic S1 measurements, writes the results, and quits.
const autoOut = process.argv.find((a) => a.startsWith('--auto='))?.slice('--auto='.length);
// `--only=probe` limits the automatic run to the encoder probe (no LiveKit needed).
const autoOnly = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? '';
// S2 inputs: `--speech=<wav>` and `--tv=<wav>` (any format Chromium decodes).
const argValue = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function createWindow(role: 'publisher' | 'viewer' | 'auto', x: number, width = 760, height = 900, only = ''): BrowserWindow {
  const win = new BrowserWindow({
    width,
    height,
    x,
    y: 40,
    title: `Spike: ${role}`,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(`${devUrl}?role=${role}&only=${only}`);
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), { query: { role, only } });
  return win;
}

void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_c, _p, callback) => callback(true));

  // S1: answer getDisplayMedia with the first screen plus system audio loopback.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        const screen = sources[0];
        if (!screen) {
          callback({});
          return;
        }
        callback({ video: screen, audio: 'loopback' });
      });
    },
    { useSystemPicker: false },
  );

  ipcMain.handle('token', async (_event, identity: string) => {
    const token = new AccessToken(LIVEKIT_KEY, LIVEKIT_SECRET, { identity, ttl: '1h' });
    token.addGrant({ room: ROOM, roomJoin: true, canPublish: true, canSubscribe: true });
    return token.toJwt();
  });

  ipcMain.handle('metrics', () =>
    app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, cpu: m.cpu.percentCPUUsage })),
  );

  ipcMain.handle('info', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    os: `${process.platform} ${process.getSystemVersion()}`,
    arch: process.arch,
    packaged: app.isPackaged,
    // 'enabled' means Chromium may use the hardware video encoder (VideoToolbox on macOS).
    videoEncode: app.getGPUFeatureStatus().video_encode,
  }));

  // A bare file name goes to the Desktop, so it is easy to find on a family member's PC.
  const outFile = autoOut && (path.isAbsolute(autoOut) ? autoOut : path.join(app.getPath('desktop'), autoOut));

  ipcMain.handle('readInput', (_event, name: 'speech' | 'tv') => {
    const file = argValue(name);
    if (!file) return undefined;
    const bytes = readFileSync(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });

  // Writes an output (a WAV) next to the result file, as <result>-<name>.
  ipcMain.handle('saveOutput', (_event, name: string, data: Uint8Array) => {
    if (!outFile || !/^[\w.-]+$/.test(name)) return;
    writeFileSync(outFile.replace(/\.json$/, '') + `-${name}`, data);
  });

  ipcMain.handle('autoResult', (_event, result: unknown) => {
    if (!outFile) return;
    writeFileSync(outFile, JSON.stringify(result, null, 2));
    app.quit();
  });

  if (autoOut) {
    createWindow('auto', 0, 1400, 900, autoOnly);
  } else {
    createWindow('publisher', 20);
    createWindow('viewer', 800);
  }
});

app.on('window-all-closed', () => app.quit());
