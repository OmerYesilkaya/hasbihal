import type { AppInfo } from '../shared/app-info.ts';

export interface HasbihalBridge {
  getAppInfo(): Promise<AppInfo>;
}

declare global {
  interface Window {
    readonly hasbihal: HasbihalBridge;
  }
}
