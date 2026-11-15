import { app, session, shell, type WebContents } from 'electron';

/**
 * Renderer hardening (ARCHITECTURE §4.2). The embedded Chromium is rarely
 * updated (DECISIONS A30), so the renderer gets as few capabilities as possible.
 */

export const APP_SCHEME = 'app';
export const APP_HOST = 'hasbihal';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

function toWebSocketOrigin(httpOrigin: string): string {
  return httpOrigin.replace(/^http/, 'ws');
}

export function contentSecurityPolicy(options: { serverUrl: string; dev: boolean }): string {
  const server = new URL(options.serverUrl).origin;
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    // Dev only: Vite's React Refresh preamble is an inline script.
    'script-src': options.dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': options.dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', server],
    'media-src': ["'self'", 'blob:', 'mediastream:', server],
    'connect-src': ["'self'", server, toWebSocketOrigin(server), ...(options.dev ? ['ws:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'notifications',
  'clipboard-sanitized-write',
]);

function isTrustedOrigin(url: string, devServerUrl: string | undefined): boolean {
  try {
    const origin = new URL(url).origin;
    if (origin === APP_ORIGIN) return true;
    return devServerUrl !== undefined && origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

function openExternally(url: string): void {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(url);
  } catch {
    // Not a URL: ignore.
  }
}

/** Global restrictions that apply to every window and web contents. */
export function applyAppWideSecurity(options: { devServerUrl: string | undefined }): void {
  const { devServerUrl } = options;

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(
      ALLOWED_PERMISSIONS.has(permission) && isTrustedOrigin(contents.getURL(), devServerUrl),
    );
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isTrustedOrigin(requestingOrigin, devServerUrl);
  });

  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    contents.on('will-navigate', (event, url) => {
      // The UI is a single page; any navigation is either a link click or an attack.
      event.preventDefault();
      openExternally(url);
    });
    contents.on('will-redirect', (event) => {
      event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      openExternally(url);
      return { action: 'deny' };
    });
  });
}
