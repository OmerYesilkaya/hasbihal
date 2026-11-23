import type { ProgressInfo, UpdateCheckResult } from 'electron-updater';
import type { UpdateState } from '../shared/app-info.ts';

/** How often to look for a newer release while the app runs (it usually runs all day, A38). */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** What `Updates` uses of electron-updater's `autoUpdater`, so tests can stand in for it. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

interface Options {
  updater: Updater;
  /**
   * Whether the app runs from /Applications (always true off macOS). Elsewhere (the dmg,
   * Downloads) macOS runs a read-only copy of it (App Translocation), which Squirrel.Mac can't
   * replace.
   */
  inApplicationsFolder: () => boolean;
  /** Moves the app to /Applications and starts it from there (Electron's own). */
  moveToApplicationsFolder: () => boolean;
  onChange: (state: UpdateState) => void;
  log?: (message: string, error?: unknown) => void;
}

/**
 * In-app updates (DECISIONS A30, ARCHITECTURE §4.5): looks for a newer published GitHub Release,
 * and when the user presses Update, downloads it, installs it, and restarts. Nothing installs
 * without that press. Spike S3 showed this works on macOS with our self-signed certificate.
 */
export class Updates {
  readonly #updater: Updater;
  readonly #options: Options;
  #state: UpdateState = { kind: 'none' };
  #checking: Promise<void> | null = null;
  #timers: ReturnType<typeof setInterval>[] = [];

  constructor(options: Options) {
    this.#options = options;
    this.#updater = options.updater;
    // Downloads wait for the Update button; one that did finish installs on quit at the latest.
    this.#updater.autoDownload = false;
    this.#updater.autoInstallOnAppQuit = true;
    this.#updater.on('download-progress', (info) => {
      if (this.#state.kind === 'downloading')
        this.#set({ ...this.#state, progress: Math.min(Math.max(info.percent / 100, 0), 1) });
    });
    // Also how Squirrel.Mac reports a failed install, after quitAndInstall has returned.
    this.#updater.on('error', (error) => {
      this.#log('update error', error);
      const state = this.#state;
      if (state.kind === 'downloading' || state.kind === 'installing')
        this.#set({ kind: 'failed', version: state.version });
    });
  }

  get state(): UpdateState {
    return this.#state;
  }

  /** Looks at once (one small request), so a screen that can't go on offers the update, then on the regular schedule. */
  start(): void {
    void this.check();
    this.#timers.push(setInterval(() => void this.check(), CHECK_INTERVAL_MS));
  }

  stop(): void {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
  }

  /** Looks for a newer release. Failures (offline, GitHub down) are only logged: the next try comes. */
  check(): Promise<void> {
    const busy = this.#state.kind === 'downloading' || this.#state.kind === 'installing';
    if (busy) return Promise.resolve();
    this.#checking ??= this.#check().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  async #check(): Promise<void> {
    try {
      const result = await this.#updater.checkForUpdates();
      const state = this.#state;
      // A download started while we were looking: leave it alone.
      if (state.kind === 'downloading' || state.kind === 'installing') return;
      if (!result?.isUpdateAvailable) {
        this.#set({ kind: 'none' });
        return;
      }
      const version = result.updateInfo.version;
      // After a failure, keep saying so until the user tries again.
      if (state.kind === 'failed' && state.version === version) return;
      this.#set({ kind: 'available', version, needsMove: !this.#options.inApplicationsFolder() });
    } catch (error) {
      this.#log('update check failed', error);
    }
  }

  /** The Update button. */
  async install(): Promise<void> {
    const state = this.#state;
    if (state.kind !== 'available' && state.kind !== 'failed') return;
    if (!this.#options.inApplicationsFolder()) {
      // Moves the app and starts it from /Applications, where the update then works.
      try {
        if (this.#options.moveToApplicationsFolder()) return;
      } catch (error) {
        this.#log('moving to /Applications failed', error);
      }
      this.#set({ kind: 'failed', version: state.version });
      return;
    }
    const { version } = state;
    this.#set({ kind: 'downloading', version, progress: 0 });
    try {
      await this.#updater.downloadUpdate();
    } catch (error) {
      this.#log('update download failed', error);
      this.#set({ kind: 'failed', version });
      return;
    }
    this.#set({ kind: 'installing', version });
    // Silent on Windows: the installer reuses the folder chosen at the first install, without
    // its wizard; then it starts the app again.
    this.#updater.quitAndInstall(true, true);
  }

  #set(state: UpdateState): void {
    this.#state = state;
    this.#options.onChange(state);
  }

  #log(message: string, error?: unknown): void {
    if (this.#options.log) this.#options.log(message, error);
    else console.warn(message, error);
  }
}
