import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from 'electron-updater';
import type { UpdateState } from '../shared/app-info.ts';
import { CHECK_INTERVAL_MS, Updates, type Updater } from './updates.ts';

/** Stands in for electron-updater's autoUpdater. */
class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  latest: string | null = null;
  checkForUpdates = vi.fn(() =>
    Promise.resolve(
      (this.latest
        ? { isUpdateAvailable: true, updateInfo: { version: this.latest } }
        : { isUpdateAvailable: false, updateInfo: { version: '0.5.0' } }) as UpdateCheckResult,
    ),
  );
  downloadUpdate = vi.fn((): Promise<unknown> => Promise.resolve([]));
  quitAndInstall = vi.fn();
}

function setUp(options: { inApplications?: boolean; moves?: boolean } = {}) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const moveToApplicationsFolder = vi.fn(() => options.moves ?? true);
  const updates = new Updates({
    updater,
    inApplicationsFolder: () => options.inApplications ?? true,
    moveToApplicationsFolder,
    onChange: (state) => states.push(state),
    log: () => undefined,
  });
  return { updater, updates, states, moveToApplicationsFolder };
}

describe('Updates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never downloads on its own', () => {
    const { updater } = setUp();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('offers a newer release, and says nothing when there is none', async () => {
    const { updater, updates } = setUp();
    await updates.check();
    expect(updates.state).toEqual({ kind: 'none' });
    updater.latest = '0.6.0';
    await updates.check();
    expect(updates.state).toEqual({ kind: 'available', version: '0.6.0', needsMove: false });
  });

  it('only logs a failed check, keeping what it knew', async () => {
    const { updater, updates } = setUp();
    updater.latest = '0.6.0';
    await updates.check();
    updater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    await updates.check();
    expect(updates.state).toEqual({ kind: 'available', version: '0.6.0', needsMove: false });
  });

  it('asks only once at a time', async () => {
    const { updater, updates } = setUp();
    await Promise.all([updates.check(), updates.check()]);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('downloads, then installs and restarts, on the Update button', async () => {
    const { updater, updates, states } = setUp();
    updater.latest = '0.6.0';
    await updates.check();
    updater.downloadUpdate.mockImplementationOnce(() => {
      updater.emit('download-progress', { percent: 40 });
      return Promise.resolve([]);
    });
    await updates.install();
    expect(states.slice(1)).toEqual([
      { kind: 'downloading', version: '0.6.0', progress: 0 },
      { kind: 'downloading', version: '0.6.0', progress: 0.4 },
      { kind: 'installing', version: '0.6.0' },
    ]);
    // Silent on Windows (no wizard), and the app starts again.
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('does nothing on the button when there is no update', async () => {
    const { updater, updates } = setUp();
    await updates.install();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('reports a failed download, and tries again on the button', async () => {
    const { updater, updates } = setUp();
    updater.latest = '0.6.0';
    await updates.check();
    updater.downloadUpdate.mockRejectedValueOnce(new Error('network'));
    await updates.install();
    expect(updates.state).toEqual({ kind: 'failed', version: '0.6.0' });
    // The regular check doesn't hide the failure.
    await updates.check();
    expect(updates.state).toEqual({ kind: 'failed', version: '0.6.0' });
    await updates.install();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('reports a failed install (Squirrel.Mac answers with an error event)', async () => {
    const { updater, updates } = setUp();
    updater.latest = '0.6.0';
    await updates.check();
    await updates.install();
    updater.emit('error', new Error('Cannot update while running on a read-only volume'));
    expect(updates.state).toEqual({ kind: 'failed', version: '0.6.0' });
  });

  it('ignores error events of background checks', async () => {
    const { updater, updates } = setUp();
    updater.latest = '0.6.0';
    await updates.check();
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect(updates.state.kind).toBe('available');
  });

  it('leaves a download alone while checking', async () => {
    const { updater, updates } = setUp();
    updater.latest = '0.6.0';
    await updates.check();
    const download = Promise.withResolvers<unknown>();
    updater.downloadUpdate.mockImplementationOnce(() => download.promise);
    const installing = updates.install();
    await updates.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updates.state.kind).toBe('downloading');
    download.resolve([]);
    await installing;
  });

  describe('outside /Applications (macOS)', () => {
    it('moves the app there instead of downloading', async () => {
      const { updater, updates, moveToApplicationsFolder } = setUp({ inApplications: false });
      updater.latest = '0.6.0';
      await updates.check();
      expect(updates.state).toEqual({ kind: 'available', version: '0.6.0', needsMove: true });
      await updates.install();
      expect(moveToApplicationsFolder).toHaveBeenCalledOnce();
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
    });

    it('reports a move that failed', async () => {
      const { updater, updates } = setUp({ inApplications: false, moves: false });
      updater.latest = '0.6.0';
      await updates.check();
      await updates.install();
      expect(updates.state).toEqual({ kind: 'failed', version: '0.6.0' });
    });
  });

  it('looks at startup, then on a schedule', async () => {
    vi.useFakeTimers();
    const { updater, updates } = setUp();
    updates.start();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    updates.stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});
