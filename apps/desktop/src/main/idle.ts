import { powerMonitor, type WebContents } from 'electron';
import { IPC } from '../shared/app-info.ts';

/** ARCHITECTURE §5.4: after 10 idle minutes the user shows as Uzakta (away). */
const IDLE_AFTER_SECONDS = 10 * 60;
const CHECK_EVERY_MS = 30_000;

/**
 * Watches system-wide input (not just this window) and tells the renderer when the computer
 * goes idle or comes back. A locked screen counts as idle straight away.
 */
export class IdleWatcher {
  #idle = false;
  #target: WebContents | null = null;

  start(): void {
    setInterval(() => {
      this.#set(powerMonitor.getSystemIdleTime() >= IDLE_AFTER_SECONDS);
    }, CHECK_EVERY_MS).unref();
    powerMonitor.on('lock-screen', () => {
      this.#set(true);
    });
    powerMonitor.on('unlock-screen', () => {
      this.#set(false);
    });
  }

  setTarget(contents: WebContents): void {
    this.#target = contents;
  }

  get idle(): boolean {
    return this.#idle;
  }

  #set(idle: boolean): void {
    if (idle === this.#idle) return;
    this.#idle = idle;
    if (this.#target && !this.#target.isDestroyed()) this.#target.send(IPC.systemIdleChanged, idle);
  }
}
