// Spike S3 (issue #50): electron-updater on macOS with the self-signed certificate (A50).
// Throwaway. Logs everything to ~/Library/Logs/@hasbihal/spike-updater/spike.log.
//
//   --auto   check, download and install without clicks (the relaunched app logs its own state).
const { app, BrowserWindow, ipcMain, systemPreferences } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const auto = process.argv.includes('--auto');
let win;
let logFile;

function log(...parts) {
  const line = `${new Date().toISOString()} [v${app.getVersion()} pid ${process.pid}] ${parts.join(' ')}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
  // The updater keeps logging while the app quits, after the window is gone.
  if (win && !win.isDestroyed()) win.webContents.send('log', line);
}

// stdout and stderr together: codesign prints its details on stderr.
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return r.status === 0 ? out : `exit ${r.status}: ${out}`;
}

// The .app bundle we run from, e.g. /Applications/Hasbihal Update Spike.app.
function bundlePath() {
  return path.resolve(path.dirname(app.getPath('exe')), '../..');
}

function reportState() {
  const bundle = bundlePath();
  log('bundle:', bundle);
  log('translocated:', String(bundle.includes('/AppTranslocation/')), 'isInApplicationsFolder:', String(app.isInApplicationsFolder()));
  log('quarantine xattr:', run('xattr', ['-p', 'com.apple.quarantine', bundle]));
  log('designated requirement:', run('codesign', ['-d', '-r-', bundle]).replace(/\s+/g, ' '));
  log('cdhash:', (run('codesign', ['-dvvv', bundle]).match(/CDHash=(\w+)/) || [])[1] || '?');
  log('microphone:', systemPreferences.getMediaAccessStatus('microphone'));
}

function setUpUpdater() {
  autoUpdater.logger = { info: (m) => log('updater:', m), warn: (m) => log('updater WARN:', m), error: (m) => log('updater ERROR:', m), debug: () => {} };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', (i) => log('event update-available', i.version));
  autoUpdater.on('update-not-available', (i) => log('event update-not-available', i.version));
  autoUpdater.on('download-progress', (p) => log('event download-progress', Math.round(p.percent) + '%'));
  autoUpdater.on('update-downloaded', (i) => log('event update-downloaded', i.version, i.downloadedFile || ''));
  autoUpdater.on('error', (e) => log('event error', e && e.stack ? e.stack : String(e)));
}

async function check() {
  const r = await autoUpdater.checkForUpdates();
  return r && r.isUpdateAvailable ? r.updateInfo.version : null;
}

async function download() {
  await autoUpdater.downloadUpdate();
}

function install() {
  log('quitAndInstall');
  autoUpdater.quitAndInstall(false, true);
}

ipcMain.handle('check', () => check().catch((e) => log('check failed', e.stack)));
ipcMain.handle('download', () => download().catch((e) => log('download failed', e.stack)));
ipcMain.handle('install', () => install());
ipcMain.handle('ask-mic', async () => log('askForMediaAccess(microphone):', String(await systemPreferences.askForMediaAccess('microphone'))));
ipcMain.handle('state', () => reportState());
// Electron's own fix for a translocated or misplaced app: moves it to /Applications and relaunches.
ipcMain.handle('move', () => {
  try {
    log('moveToApplicationsFolder:', String(app.moveToApplicationsFolder()));
  } catch (e) {
    log('moveToApplicationsFolder failed', e.stack);
  }
});

app.whenReady().then(async () => {
  fs.mkdirSync(app.getPath('logs'), { recursive: true });
  logFile = path.join(app.getPath('logs'), 'spike.log');
  win = new BrowserWindow({
    width: 900,
    height: 600,
    title: `Update spike v${app.getVersion()}`,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  log('started', auto ? '(auto)' : '', 'argv:', JSON.stringify(process.argv.slice(1)));
  reportState();
  setUpUpdater();
  if (auto) {
    try {
      const v = await check();
      if (!v) return log('auto: no update');
      await download();
      install();
    } catch (e) {
      log('auto failed', e.stack);
    }
  }
});

app.on('window-all-closed', () => app.quit());
