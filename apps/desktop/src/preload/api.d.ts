import type { AppInfo, AuthBridge, ScreenBridge, SystemBridge } from '../shared/app-info.ts';

export interface HasbihalBridge {
  getAppInfo(): Promise<AppInfo>;
  auth: AuthBridge;
  system: SystemBridge;
  screen: ScreenBridge;
}

declare global {
  interface Window {
    readonly hasbihal: HasbihalBridge;
  }
}
