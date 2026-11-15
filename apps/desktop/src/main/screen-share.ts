import { desktopCapturer, type NativeImage, type Session } from 'electron';
import type { ScreenSource } from '../shared/app-info.ts';

/** Typed as always there, but null for screens and for windows without an icon. */
function windowIcon(icon: NativeImage | null): string | null {
  return icon && !icon.isEmpty() ? icon.toDataURL() : null;
}

/** The pick, waiting for the renderer's `getDisplayMedia` call that follows it. */
interface Choice {
  id: string;
  audio: boolean;
  at: number;
}

/** A pick older than this is stale (the renderer never asked); it isn't used. */
const CHOICE_TTL_MS = 10_000;
/** The stand-in source for end-to-end tests: the requesting page itself, no OS permission needed. */
export const FAKE_SOURCE_ID = 'fake:page';

/**
 * Screen sharing (ARCHITECTURE §6.2, A14). The app shows its own picker: the renderer lists the
 * sources, the user picks one, and the renderer calls `getDisplayMedia`. Electron then asks this
 * class, which answers with the picked source and, if asked for, the system audio ("loopback").
 */
export class ScreenSources {
  readonly #fake: boolean;
  readonly #isTrusted: (url: string) => boolean;
  #choice: Choice | null = null;

  /**
   * @param fake    Offer only the app's own page (end-to-end tests: no screen-recording permission).
   * @param isTrusted Whether a requesting page is the app's own UI.
   */
  constructor(options: { fake: boolean; isTrusted: (url: string) => boolean }) {
    this.#fake = options.fake;
    this.#isTrusted = options.isTrusted;
  }

  /** Screens first, then windows, with small thumbnails for the picker. */
  async list(): Promise<ScreenSource[]> {
    if (this.#fake) {
      return [{ id: FAKE_SOURCE_ID, name: 'Test', kind: 'screen', thumbnail: '', icon: null }];
    }
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => !s.thumbnail.isEmpty())
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
        thumbnail: s.thumbnail.toDataURL(),
        icon: windowIcon(s.appIcon),
      }))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1));
  }

  /** Remembers the pick for the next `getDisplayMedia` call. */
  choose(id: string, audio: boolean): void {
    this.#choice = { id, audio, at: Date.now() };
  }

  install(session: Session): void {
    session.setDisplayMediaRequestHandler((request, callback) => {
      const choice = this.#choice;
      this.#choice = null;
      // Refusing is answering with nothing: getDisplayMedia rejects in the renderer.
      if (
        !choice ||
        Date.now() - choice.at > CHOICE_TTL_MS ||
        !this.#isTrusted(request.securityOrigin)
      ) {
        callback({});
        return;
      }
      if (this.#fake) {
        callback(request.frame ? { video: request.frame } : {});
        return;
      }
      void desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then(
          (sources) => {
            const source = sources.find((s) => s.id === choice.id);
            // The window may have closed since the picker showed it.
            if (!source) {
              callback({});
              return;
            }
            callback(choice.audio ? { video: source, audio: 'loopback' } : { video: source });
          },
          () => {
            callback({});
          },
        );
    });
  }
}
