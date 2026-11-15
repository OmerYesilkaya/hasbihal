import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spike', {
  token: (identity: string) => ipcRenderer.invoke('token', identity) as Promise<string>,
  metrics: () => ipcRenderer.invoke('metrics') as Promise<{ type: string; pid: number; cpu: number }[]>,
  info: () => ipcRenderer.invoke('info') as Promise<Record<string, unknown>>,
  autoResult: (result: unknown) => ipcRenderer.invoke('autoResult', result) as Promise<void>,
  readInput: (name: 'speech' | 'tv') => ipcRenderer.invoke('readInput', name) as Promise<ArrayBuffer | undefined>,
  saveOutput: (name: string, data: Uint8Array) => ipcRenderer.invoke('saveOutput', name, data) as Promise<void>,
});
