import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayClient, type ChatStore, type GatewayStatus } from '@hasbihal/core';
import { MemberList, RoomList, type Message, type PresenceMode } from '@hasbihal/protocol';
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
/** What the gateway can ask the UI to show: notifications (A28, A13). */
export interface GatewayNotices {
  /** A new message from someone, to weigh for a notification (A28). */
  message: (message: Message) => void;
  hangoutStarted: (roomId: string, userId: string) => void;
  nudge: (fromUserId: string, roomId: string) => void;
  eventReminder: (reminder: { roomId: string; title: string; startsAt: string }) => void;
}

export function useGateway(info: AppInfo, store: ChatStore, notices: GatewayNotices) {
  const [status, setStatus] = useState<GatewayStatus>({ kind: 'connecting', attempt: 0 });
  const client = useRef<GatewayClient | null>(null);
  // The latest handlers, without reconnecting when they change.
  const latestNotices = useRef(notices);
  useEffect(() => {
    latestNotices.current = notices;
  });

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
        store.setHangouts(welcome.hangouts);
        store.eventsChanged(); // they may have changed while this client was away
        if (welcome.resync) store.forgetMessages();
        if (!loaded || welcome.resync) {
          loaded = true;
          void loadMembers();
        }
        void loadRooms();
      },
      onEvent: (event) => {
        store.apply(event);
        if (event.type === 'message_created') latestNotices.current.message(event.message);
      },
      onRoomPrefs: (roomId, prefs) => {
        store.setRoomPrefs(roomId, prefs);
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
      onHangout: (roomId, participants) => {
        store.setHangout(roomId, participants);
      },
      onHangoutStarted: (roomId, userId) => {
        latestNotices.current.hangoutStarted(roomId, userId);
      },
      onNudge: (fromUserId, roomId) => {
        latestNotices.current.nudge(fromUserId, roomId);
      },
      onEventReminder: (reminder) => {
        latestNotices.current.eventReminder(reminder);
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
