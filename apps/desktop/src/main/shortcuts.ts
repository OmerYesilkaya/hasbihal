import { globalShortcut, type WebContents } from 'electron';
import { IPC } from '../shared/app-info.ts';

/** A37: mute and deafen from anywhere, while in a hangout. */
export const SHORTCUTS = {
  mute: 'CommandOrControl+Alt+M',
  deafen: 'CommandOrControl+Alt+D',
} as const;

/**
 * Global shortcuts are taken from every other app while registered, so they're active only
 * while this app is in a hangout.
 */
export class HangoutShortcuts {
  #target: WebContents | null = null;
  #active = false;

  setTarget(contents: WebContents): void {
    this.#target = contents;
  }

  setActive(active: boolean): void {
    if (active === this.#active) return;
    this.#active = active;
    if (!active) {
      globalShortcut.unregister(SHORTCUTS.mute);
      globalShortcut.unregister(SHORTCUTS.deafen);
      return;
    }
    for (const [action, accelerator] of Object.entries(SHORTCUTS)) {
      // Fails quietly when another app already owns the combination.
      globalShortcut.register(accelerator, () => {
        if (this.#target && !this.#target.isDestroyed()) this.#target.send(IPC.shortcut, action);
      });
    }
  }
}
