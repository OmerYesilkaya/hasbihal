import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'electron';

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }));
const { ScreenSources } = await import('./screen-share.ts');

type Handler = (
  request: { securityOrigin: string; frame: object | null },
  callback: (r: object) => void,
) => void;

/** The handler ScreenSources installs, called the way Electron would. */
function setUp() {
  let handler: Handler | undefined;
  const session = {
    setDisplayMediaRequestHandler: (h: Handler) => {
      handler = h;
    },
  } as unknown as Session;
  const sources = new ScreenSources({
    fake: true,
    isTrusted: (url) => url === 'app://hasbihal',
  });
  sources.install(session);
  const frame = { page: true };
  const request = (origin = 'app://hasbihal') =>
    new Promise<object>((resolve) => {
      handler?.({ securityOrigin: origin, frame }, resolve);
    });
  return { sources, request, frame };
}

describe('ScreenSources', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a getDisplayMedia call with the picked source, once', async () => {
    const { sources, request, frame } = setUp();
    sources.choose('fake:page', false);
    expect(await request()).toEqual({ video: frame });
    expect(await request()).toEqual({});
  });

  it('refuses without a pick', async () => {
    const { request } = setUp();
    expect(await request()).toEqual({});
  });

  it('refuses a stale pick', async () => {
    vi.useFakeTimers();
    const { sources, request } = setUp();
    sources.choose('fake:page', false);
    vi.advanceTimersByTime(11_000);
    expect(await request()).toEqual({});
  });

  it('refuses pages that are not the app', async () => {
    const { sources, request } = setUp();
    sources.choose('fake:page', false);
    expect(await request('https://evil.example')).toEqual({});
  });
});
