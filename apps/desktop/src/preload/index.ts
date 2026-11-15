import { contextBridge, ipcRenderer } from 'electron';
import type { DeepLink } from '../shared/deep-link.ts';
import { IPC, type AppInfo, type AuthBridge, type DeepLinkBridge } from '../shared/app-info.ts';
import type { HasbihalBridge } from './api';

const takePending = () => ipcRenderer.invoke(IPC.deepLinkTakePending) as Promise<DeepLink | null>;

const auth: AuthBridge = {
  restore: () => ipcRenderer.invoke(IPC.authRestore),
  inviteInfo: (token) => ipcRenderer.invoke(IPC.authInviteInfo, token),
  signUp: (request) => ipcRenderer.invoke(IPC.authSignUp, request),
  signIn: (request) => ipcRenderer.invoke(IPC.authSignIn, request),
  recover: (request) => ipcRenderer.invoke(IPC.authRecover, request),
  accessToken: () => ipcRenderer.invoke(IPC.authAccessToken),
  signOut: () => ipcRenderer.invoke(IPC.authSignOut),
  onSessionEnded: (listener) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(IPC.authSessionEnded, handler);
    return () => ipcRenderer.off(IPC.authSessionEnded, handler);
  },
};

const deepLinks: DeepLinkBridge = {
  takePending,
  onLink: (listener) => {
    // The main process only pings; the link itself is taken, so it is handled exactly once.
    const handler = () => {
      void takePending().then((link) => {
        if (link) listener(link);
      });
    };
    ipcRenderer.on(IPC.deepLinkReceived, handler);
    return () => ipcRenderer.off(IPC.deepLinkReceived, handler);
  },
};

/** The only main-process capabilities the renderer can reach (ARCHITECTURE §4.1). */
const bridge: HasbihalBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo) as Promise<AppInfo>,
  auth,
  deepLinks,
};

contextBridge.exposeInMainWorld('hasbihal', bridge);
