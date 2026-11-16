import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { ChatState, ChatStore } from '@hasbihal/core';
import type { User } from '@hasbihal/protocol';
import type { AppInfo } from '../../../shared/app-info.ts';
import type { HangoutSession, HangoutState } from '../hangout/session.ts';

/** What the chat screens share: the store, the server, and the live connection. */
export interface Chat {
  info: AppInfo;
  store: ChatStore;
  /** Tells others this member is typing in a room (throttle at the caller). */
  typing: (roomId: string) => void;
  /** The voice and video call this app is in, if any. */
  hangout: HangoutSession;
}

const ChatContext = createContext<Chat | null>(null);

export function ChatProvider({ chat, children }: { chat: Chat; children: ReactNode }) {
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export function useChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error('useChat outside ChatProvider');
  return chat;
}

/** The store's current snapshot; re-renders on every change. */
export function useChatState(): ChatState {
  const { store } = useChat();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Members by username, for rendering @mentions. */
export function useMembersByUsername(): ReadonlyMap<string, User> {
  const { members } = useChatState();
  return useMemo(() => new Map([...members.values()].map((m) => [m.username, m])), [members]);
}

/** The hangout's current state; re-renders on every change. */
export function useHangout(): HangoutState {
  const { hangout } = useChat();
  return useSyncExternalStore(hangout.subscribe, hangout.getSnapshot);
}
