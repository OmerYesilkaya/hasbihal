import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayClient, type ChatStore, type GatewayStatus } from '@hasbihal/core';
import { MemberList, RoomList, type PresenceMode } from '@hasbihal/protocol';
import type { AppInfo } from '../../shared/app-info.ts';
import { apiGet } from './api.ts';

function toWebSocketUrl(serverUrl: string): string {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Connects the signed-in app to the gateway and keeps `store` up to date: a full load on the first
 * welcome and after a resync, then durable events and presence (ARCHITECTURE §5).
 */
export function useGateway(info: AppInfo, store: ChatStore) {
  const [status, setStatus] = useState<GatewayStatus>({ kind: 'connecting', attempt: 0 });
  const client = useRef<GatewayClient | null>(null);

  useEffect(() => {
    let loaded = false;
    const loadMembers = async () => {
      const list = await apiGet(info.serverUrl, '/members', MemberList);
      if (list) store.setMembers(list.members);
    };
    // Every welcome: unread counts may have moved on another device while this one was away.
    const loadRooms = async () => {
      const list = await apiGet(info.serverUrl, '/rooms', RoomList);
      if (list) store.setRooms(list.rooms);
    };

    const gateway = new GatewayClient({
      url: toWebSocketUrl(info.serverUrl),
      clientVersion: info.appVersion,
      createSocket: (url) => new WebSocket(url),
      getAccessToken: async ({ refresh }) => {
        const result = await window.hasbihal.auth.accessToken(refresh);
        if (result.ok) return result.value;
        // Ended: the main process tells the UI, which signs out. Anything else: retry later.
        if (result.error.code === 'unauthorized') return null;
        throw new Error(result.error.code);
      },
      onStatus: setStatus,
      onWelcome: (welcome) => {
        store.setMe(welcome.me);
        store.setPresenceSnapshot(welcome.presence);
        if (welcome.resync) store.forgetMessages();
        if (!loaded || welcome.resync) {
          loaded = true;
          void loadMembers();
        }
        void loadRooms();
      },
      onEvent: (event) => {
        store.apply(event);
      },
      onPresence: (userId, presence) => {
        store.setPresence(userId, presence);
      },
      onTyping: (roomId, userId) => {
        store.setTyping(roomId, userId);
      },
      onReadState: (roomId, messageId) => {
        store.setReadMarker(roomId, messageId);
      },
    });
    client.current = gateway;
    gateway.start();

    void window.hasbihal.system.isIdle().then((idle) => {
      gateway.setIdle(idle);
    });
    const stopIdle = window.hasbihal.system.onIdleChanged((idle) => {
      gateway.setIdle(idle);
    });

    return () => {
      stopIdle();
      gateway.stop();
      client.current = null;
      store.reset();
    };
  }, [info.serverUrl, info.appVersion, store]);

  const setPresence = useCallback((mode: PresenceMode) => {
    client.current?.setPresence(mode);
  }, []);

  const typing = useCallback((roomId: string) => {
    client.current?.typing(roomId);
  }, []);

  return { status, setPresence, typing };
}
