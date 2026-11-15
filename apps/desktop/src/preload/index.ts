import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type AppInfo } from '../shared/app-info.ts';
import type { HasbihalBridge } from './api';

/** The only main-process capabilities the renderer can reach (ARCHITECTURE §4.1). */
const bridge: HasbihalBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld('hasbihal', bridge);
