import type { AppInfo, AuthBridge, DeepLinkBridge, SystemBridge } from '../shared/app-info.ts';

export interface HasbihalBridge {
  getAppInfo(): Promise<AppInfo>;
  auth: AuthBridge;
  deepLinks: DeepLinkBridge;
  system: SystemBridge;
}

declare global {
  interface Window {
    readonly hasbihal: HasbihalBridge;
  }
}
