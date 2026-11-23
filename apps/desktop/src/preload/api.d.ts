import type {
  AppInfo,
  AuthBridge,
  ScreenBridge,
  SystemBridge,
  UpdatesBridge,
} from '../shared/app-info.ts';

export interface HasbihalBridge {
  getAppInfo(): Promise<AppInfo>;
  auth: AuthBridge;
  system: SystemBridge;
  screen: ScreenBridge;
  updates: UpdatesBridge;
}

declare global {
  interface Window {
    readonly hasbihal: HasbihalBridge;
  }
}
