import { contextBridge, ipcRenderer } from 'electron';
import type { Locale } from '@hasbihal/core';
import {
  IPC,
  type AppInfo,
  type AuthBridge,
  type ScreenBridge,
  type ScreenSource,
  type SystemBridge,
} from '../shared/app-info.ts';
import type { HasbihalBridge } from './api';

const auth: AuthBridge = {
  restore: () => ipcRenderer.invoke(IPC.authRestore),
  signInWithGoogle: () => ipcRenderer.invoke(IPC.authGoogle),
  cancelGoogleSignIn: () => {
    ipcRenderer.send(IPC.authGoogleCancel);
  },
  requestAccess: () => ipcRenderer.invoke(IPC.authRequestAccess),
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
  language: () => ipcRenderer.invoke(IPC.language) as Promise<Locale | null>,
  setLanguage: async (language) => {
    await ipcRenderer.invoke(IPC.setLanguage, language);
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
  system,
  screen,
};

contextBridge.exposeInMainWorld('hasbihal', bridge);
