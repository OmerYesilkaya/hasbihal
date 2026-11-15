/** Information the main process hands to the renderer at startup. */
export interface AppInfo {
  appVersion: string;
  platform: 'darwin' | 'win32' | 'linux';
  /** Base URL of the Hasbihal server, e.g. https://api.hasbihal.example */
  serverUrl: string;
}

export const IPC = {
  getAppInfo: 'app:get-info',
} as const;
