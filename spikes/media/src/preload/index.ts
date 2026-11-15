import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spike', {
  token: (identity: string) => ipcRenderer.invoke('token', identity) as Promise<string>,
  metrics: () => ipcRenderer.invoke('metrics') as Promise<{ type: string; pid: number; cpu: number }[]>,
  info: () => ipcRenderer.invoke('info') as Promise<Record<string, unknown>>,
  autoResult: (result: unknown) => ipcRenderer.invoke('autoResult', result) as Promise<void>,
});
