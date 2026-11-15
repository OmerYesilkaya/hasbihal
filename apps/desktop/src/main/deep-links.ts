import { app, type WebContents } from 'electron';
import { APP_URL_SCHEME } from '@hasbihal/protocol';
import { IPC } from '../shared/app-info.ts';
import { deepLinkFromArgv, parseDeepLink, type DeepLink } from '../shared/deep-link.ts';

/**
 * `hasbihal://` links (DECISIONS A51). macOS delivers them as `open-url` events, even before the
 * app is ready; Windows passes them on the command line, to the first instance at launch or to
 * `second-instance` when the app is already running. The latest link is queued and the renderer is
 * pinged; it takes the link on the ping or when it starts, so none is lost to a startup race.
 */
export class DeepLinkRouter {
  #pending: DeepLink | null = null;
  #target: WebContents | null = null;

  /** Call before `app.whenReady()`, so a link that launched the app on macOS isn't missed. */
  listen(): void {
    app.on('open-url', (event, url) => {
      event.preventDefault();
      this.handle(url);
    });
    const fromLaunch = deepLinkFromArgv(process.argv);
    if (fromLaunch) this.#deliver(fromLaunch);
  }

  /** Makes the app the OS handler for `hasbihal://`. Only packaged builds register. */
  register(): void {
    if (!app.isPackaged) return; // a dev build would register the bare Electron binary
    app.setAsDefaultProtocolClient(APP_URL_SCHEME);
  }

  setTarget(contents: WebContents): void {
    this.#target = contents;
  }

  handle(url: string): void {
    const link = parseDeepLink(url);
    if (link) this.#deliver(link);
  }

  handleArgv(argv: readonly string[]): void {
    const link = deepLinkFromArgv(argv);
    if (link) this.#deliver(link);
  }

  takePending(): DeepLink | null {
    const link = this.#pending;
    this.#pending = null;
    return link;
  }

  #deliver(link: DeepLink): void {
    this.#pending = link;
    if (this.#target && !this.#target.isDestroyed()) this.#target.send(IPC.deepLinkReceived);
  }
}
