import type {
  AppInfo,
  AuthBridge,
  DeepLinkBridge,
  ScreenBridge,
  SystemBridge,
} from '../shared/app-info.ts';

export interface HasbihalBridge {
  getAppInfo(): Promise<AppInfo>;
  auth: AuthBridge;
  deepLinks: DeepLinkBridge;
  system: SystemBridge;
  screen: ScreenBridge;
}

declare global {
  interface Window {
    readonly hasbihal: HasbihalBridge;
  }
}
