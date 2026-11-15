import type { AppInfo, AuthBridge, DeepLinkBridge } from '../shared/app-info.ts';

export interface HasbihalBridge {
  getAppInfo(): Promise<AppInfo>;
  auth: AuthBridge;
  deepLinks: DeepLinkBridge;
}

declare global {
  interface Window {
    readonly hasbihal: HasbihalBridge;
  }
}
