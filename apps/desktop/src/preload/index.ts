import { contextBridge, ipcRenderer } from 'electron';
import type { DeepLink } from '../shared/deep-link.ts';
import {
  IPC,
  type AppInfo,
  type AuthBridge,
  type DeepLinkBridge,
  type ScreenBridge,
  type ScreenSource,
  type SystemBridge,
} from '../shared/app-info.ts';
import type { HasbihalBridge } from './api';

const takePending = () => ipcRenderer.invoke(IPC.deepLinkTakePending) as Promise<DeepLink | null>;

const auth: AuthBridge = {
  restore: () => ipcRenderer.invoke(IPC.authRestore),
  inviteInfo: (token) => ipcRenderer.invoke(IPC.authInviteInfo, token),
  signUp: (request) => ipcRenderer.invoke(IPC.authSignUp, request),
  signIn: (request) => ipcRenderer.invoke(IPC.authSignIn, request),
  recover: (request) => ipcRenderer.invoke(IPC.authRecover, request),
  accessToken: (refresh) => ipcRenderer.invoke(IPC.authAccessToken, refresh ?? false),
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

const system: SystemBridge = {
  isIdle: () => ipcRenderer.invoke(IPC.systemIsIdle) as Promise<boolean>,
  onIdleChanged: (listener) => {
    const handler = (_event: unknown, idle: boolean) => {
      listener(idle);
    };
    ipcRenderer.on(IPC.systemIdleChanged, handler);
    return () => ipcRenderer.off(IPC.systemIdleChanged, handler);
  },
  setHangoutShortcuts: (active) => {
    ipcRenderer.send(IPC.systemShortcuts, active);
  },
  onShortcut: (listener) => {
    const handler = (_event: unknown, action: 'mute' | 'deafen') => {
      listener(action);
    };
    ipcRenderer.on(IPC.shortcut, handler);
    return () => ipcRenderer.off(IPC.shortcut, handler);
  },
  focusWindow: () => {
    ipcRenderer.send(IPC.focusWindow);
  },
  launchAtStartup: () => ipcRenderer.invoke(IPC.launchAtStartup) as Promise<boolean | null>,
  setLaunchAtStartup: async (on) => {
    await ipcRenderer.invoke(IPC.setLaunchAtStartup, on);
  },
  setMentions: (count) => {
    ipcRenderer.send(IPC.mentions, count);
  },
};

const screen: ScreenBridge = {
  sources: () => ipcRenderer.invoke(IPC.screenSources) as Promise<ScreenSource[]>,
  choose: async (id, audio) => {
    await ipcRenderer.invoke(IPC.screenChoose, id, audio);
  },
};

/** The only main-process capabilities the renderer can reach (ARCHITECTURE §4.1). */
const bridge: HasbihalBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo) as Promise<AppInfo>,
  auth,
  deepLinks,
  system,
  screen,
};

contextBridge.exposeInMainWorld('hasbihal', bridge);
