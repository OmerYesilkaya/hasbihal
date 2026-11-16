import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { createTranslator, resolveLocale } from '@hasbihal/core';
import trayPng from '../../resources/tray.png?asset';
import tray2xPng from '../../resources/tray@2x.png?asset';
import templatePng from '../../resources/trayTemplate.png?asset';
import template2xPng from '../../resources/trayTemplate@2x.png?asset';

/**
 * A bundled resource's real path. In a packaged app, resources/ is unpacked next to app.asar
 * (electron-builder.yml), and the bundler's asset paths still point inside the archive.
 */
const unpacked = (file: string) =>
  file.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

/** Started by the OS at login (A39): stay in the tray rather than open a window. */
const HIDDEN_ARG = '--hidden';

interface Settings {
  /** A39: on unless the user turned it off; unset means "never decided". */
  launchAtStartup?: boolean;
  /** The "still running in the tray" note has been shown once (Windows). */
  trayNoteShown?: boolean;
}

/**
 * Keeps Hasbihal running in the background (A38, A39): closing the window hides it to the tray
 * (Windows) or menu bar (macOS), so nudges, mentions, and reminders still arrive; it starts with
 * the computer unless turned off.
 */
export class Background {
  readonly #settingsFile: string;
  /** Packaged builds only: development and test runs never touch login items. */
  readonly #manageStartup: boolean;
  readonly #t = createTranslator(resolveLocale([app.getLocale()]));
  #settings: Settings = {};
  #tray: Tray | null = null;
  #window: BrowserWindow | null = null;
  #quitting = false;
  #mentions = 0;

  constructor(options: { manageStartup: boolean }) {
    this.#settingsFile = path.join(app.getPath('userData'), 'settings.json');
    this.#manageStartup = options.manageStartup;
    app.on('before-quit', () => {
      this.#quitting = true;
    });
  }

  /** Whether this launch was the OS starting us at login, so no window should appear. */
  get startedHidden(): boolean {
    if (process.argv.includes(HIDDEN_ARG)) return true;
    return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
  }

  async start(): Promise<void> {
    this.#settings = await readFile(this.#settingsFile, 'utf8')
      .then((text) => JSON.parse(text) as Settings)
      .catch(() => ({}));
    if (this.#manageStartup && this.#settings.launchAtStartup === undefined)
      await this.setLaunchAtStartup(true); // A39: on by default
    this.#createTray();
  }

  /** Closing hides the window instead (quitting is from the tray menu or ⌘Q). */
  attach(window: BrowserWindow): void {
    this.#window = window;
    window.on('close', (event) => {
      if (this.#quitting) return;
      event.preventDefault();
      window.hide();
      void this.#noteOnce();
    });
  }

  show(): void {
    const window = this.#window;
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** null when this build doesn't manage it (development). */
  launchAtStartup(): boolean | null {
    return this.#manageStartup ? (this.#settings.launchAtStartup ?? true) : null;
  }

  async setLaunchAtStartup(on: boolean): Promise<void> {
    if (!this.#manageStartup) return;
    app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_ARG] });
    await this.#save({ launchAtStartup: on });
    this.#updateMenu();
  }

  /** Unread mentions: on the macOS dock and in the tray's tooltip. */
  setMentions(count: number): void {
    this.#mentions = count;
    if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '');
    this.#tray?.setToolTip(
      count > 0 ? `Hasbihal · ${this.#t('tray.mentions', { count })}` : 'Hasbihal',
    );
  }

  #createTray(): void {
    const mac = process.platform === 'darwin';
    const image = nativeImage.createEmpty();
    image.addRepresentation({
      scaleFactor: 1,
      buffer: nativeImage.createFromPath(unpacked(mac ? templatePng : trayPng)).toPNG(),
    });
    image.addRepresentation({
      scaleFactor: 2,
      buffer: nativeImage.createFromPath(unpacked(mac ? template2xPng : tray2xPng)).toPNG(),
    });
    // The menu bar tints a template image to match light and dark menus.
    if (mac) image.setTemplateImage(true);
    this.#tray = new Tray(image);
    this.#tray.setToolTip('Hasbihal');
    // Windows: a click on the tray icon brings the window back (macOS shows the menu).
    this.#tray.on('click', () => {
      if (!mac) this.show();
    });
    this.#updateMenu();
    this.setMentions(this.#mentions);
  }

  #updateMenu(): void {
    if (!this.#tray) return;
    const startup = this.launchAtStartup();
    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: this.#t('tray.open'),
          click: () => {
            this.show();
          },
        },
        { type: 'separator' },
        ...(startup === null
          ? []
          : [
              {
                label: this.#t('tray.launchAtStartup'),
                type: 'checkbox' as const,
                checked: startup,
                click: (item: Electron.MenuItem) => void this.setLaunchAtStartup(item.checked),
              },
              { type: 'separator' as const },
            ]),
        {
          label: this.#t('tray.quit'),
          click: () => {
            app.quit();
          },
        },
      ]),
    );
  }

  /** The first time the window "closes" on Windows, say it's still running, once. */
  async #noteOnce(): Promise<void> {
    if (process.platform !== 'win32' || this.#settings.trayNoteShown || !this.#tray) return;
    this.#tray.displayBalloon({
      title: this.#t('tray.stillRunningTitle'),
      content: this.#t('tray.stillRunningBody'),
      iconType: 'info',
    });
    await this.#save({ trayNoteShown: true });
  }

  async #save(change: Settings): Promise<void> {
    this.#settings = { ...this.#settings, ...change };
    await writeFile(this.#settingsFile, JSON.stringify(this.#settings, null, 2)).catch(
      () => undefined,
    );
  }
}
