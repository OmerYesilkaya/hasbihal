import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  activeRooms,
  ChatStore,
  noticeFor,
  parseMarkdown,
  toPlainText,
  type Occasion,
} from '@hasbihal/core';
import {
  DEFAULT_ROOM_PREFS,
  type PresenceMode,
  type PresenceStatus,
  type User,
} from '@hasbihal/protocol';
import type { AppInfo } from '../../shared/app-info.ts';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { useSession } from './auth/useSession.ts';
import { ChatProvider, type Chat } from './chat/context.tsx';
import { ProfileDialog } from './chat/ProfileDialog.tsx';
import { RoomList } from './chat/RoomList.tsx';
import { RoomView } from './chat/RoomView.tsx';
import { Avatar } from './components/Avatar.tsx';
import { ConnectionBadge } from './components/ConnectionBadge.tsx';
import { AdminButton, AdminDialog } from './admin/AdminDialog.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { MemberList, PRESENCE_LABEL } from './components/MemberList.tsx';
import { SearchPanel } from './components/SearchPanel.tsx';
import { Tulip } from './components/Tulip.tsx';
import { UpdateCard } from './update/UpdateCard.tsx';
import { formatTime, I18nProvider, useT } from './i18n.tsx';
import { HangoutSession } from './hangout/session.ts';
import { playSound, ring, stopRing } from './sound.ts';
import { createClient } from './client.ts';
import { createQueryClient, queryKeys } from './queries.ts';
import { QueryClientProvider } from '@tanstack/react-query';
import { useGateway } from './useGateway.ts';
import { PanelsProvider, PanelToggle, usePanelsState } from './layout/panels.tsx';
import { SettingsDialog } from './settings/SettingsDialog.tsx';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Knocking } from './mahrem/knocking.ts';
import { toastError } from './components/toast.ts';
import { ConfirmHost } from './components/confirm.tsx';
import { Icon } from './components/Icon.tsx';
import { Tip, TipProvider } from './components/Tip.tsx';
import { Menu, MenuItem, MenuLabel, MenuRadioGroup, MenuSeparator } from './components/Popover.tsx';

/** The in-app prompt for one knock (A55), so whoever answers can close it everywhere. */
const knockToast = (roomId: string, userId: string) => `knock:${roomId}:${userId}`;

export function App({ info }: { info: AppInfo }) {
  return (
    <I18nProvider>
      <TipProvider>
        <Root info={info} />
      </TipProvider>
      <ConfirmHost />
      <Toaster
        position="bottom-right"
        offset={16}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: 'toast',
            title: 'toast__title',
            error: 'toast--error',
            success: 'toast--success',
            description: 'toast__description',
            actionButton: 'button button--primary',
            cancelButton: 'button',
          },
        }}
      />
    </I18nProvider>
  );
}

function Root({ info }: { info: AppInfo }) {
  const t = useT();
  const session = useSession();
  const { state } = session;

  if (state.kind === 'restoring' || state.kind === 'offline') {
    return (
      <main className="splash">
        <Tulip size={56} />
        <p>{state.kind === 'restoring' ? t('auth.restoring') : t('auth.offline')}</p>
        {state.kind === 'offline' && (
          <button className="button" type="button" onClick={() => void session.retry()}>
            {t('auth.retry')}
          </button>
        )}
        <UpdateCard />
      </main>
    );
  }

  if (state.kind === 'signedOut') {
    return (
      <AuthScreen
        sessionEnded={state.ended}
        onSignedIn={(user) => {
          session.signedIn(user);
        }}
      />
    );
  }

  return <Shell info={info} user={state.user} onSignOut={() => void session.signOut()} />;
}

interface ShellProps {
  info: AppInfo;
  user: User;
  onSignOut: () => void;
}

function Shell({ info, user, onSignOut }: ShellProps) {
  const t = useT();
  // One store per signed-in session: signing out unmounts the shell and drops it.
  const [store] = useState(() => new ChatStore());
  const [client] = useState(() => createClient(info.serverUrl));
  const [queryClient] = useState(createQueryClient);
  const [adminOpen, setAdminOpen] = useState(false);
  // One call per signed-in session too; signing out leaves it.
  const [hangout] = useState(() => new HangoutSession(client));
  const [knocking] = useState(() => new Knocking());
  const hangoutState = useSyncExternalStore(hangout.subscribe, hangout.getSnapshot);
  const [chosenRoom, setChosenRoom] = useState<string | null>(null);

  /** The room on screen, for "they're already looking at it" (kept current below). */
  const shownRoom = useRef<string | null>(null);
  const situation = () => {
    const snapshot = store.getSnapshot();
    const myId = snapshot.me?.id ?? '';
    return { myId, busy: snapshot.presence.get(myId) === 'busy', now: Date.now() };
  };
  const prefsOf = (roomId: string) =>
    store.getSnapshot().rooms.get(roomId)?.prefs ?? DEFAULT_ROOM_PREFS;

  /**
   * A system notification, if the A28 rules want one: it brings the app forward and runs
   * `onClick`. Our own sound (#37) instead of the system's, so it's the same everywhere: the
   * alert, or for a nudge the ringtone.
   */
  const notify = (
    occasion: Occasion,
    /** The room it's about, if any: no notification while it's on screen. */
    roomId: string | null,
    title: string,
    body: string,
    onClick: () => void,
  ) => {
    const viewingRoom = roomId !== null && document.hasFocus() && shownRoom.current === roomId;
    const notice = noticeFor(occasion, { ...situation(), viewingRoom });
    if (!notice.notify) return;
    if (notice.sound) {
      if (occasion.kind === 'nudge') ring();
      else playSound('alert');
    }
    const notification = new Notification(title, { body, silent: true });
    notification.onclick = () => {
      stopRing();
      window.hasbihal.system.focusWindow();
      onClick();
    };
  };
  const nameOf = (userId: string) => store.getSnapshot().members.get(userId)?.displayName ?? '?';
  const roomName = (roomId: string) => store.getSnapshot().rooms.get(roomId)?.name ?? '?';
  const { status, setPresence, typing } = useGateway(info, client, store, {
    message: (message) => {
      const text = toPlainText(parseMarkdown(message.body)).replace(/\s+/g, ' ').trim();
      notify(
        { kind: 'message', message, prefs: prefsOf(message.roomId) },
        message.roomId,
        `${nameOf(message.authorId)} · #${roomName(message.roomId)}`,
        text.slice(0, 200) || t('attachment.only'),
        () => {
          setChosenRoom(message.roomId);
        },
      );
    },
    hangoutStarted: (roomId, userId) => {
      if (hangoutState.roomId === roomId) return; // already there
      notify(
        { kind: 'hangout_started', prefs: prefsOf(roomId) },
        roomId,
        t('hangoutStarted.title', { name: nameOf(userId) }),
        t('hangoutStarted.body', { room: roomName(roomId) }),
        () => {
          setChosenRoom(roomId);
        },
      );
    },
    nudge: (fromUserId, roomId) => {
      notify(
        { kind: 'nudge' },
        roomId,
        t('nudge.notificationTitle', { name: nameOf(fromUserId) }),
        t('nudge.notificationBody', { room: roomName(roomId) }),
        () => {
          setChosenRoom(roomId);
          void hangout.join(roomId);
        },
      );
    },
    // A15: "Ders · 09:00, in 10 minutes".
    eventReminder: ({ roomId, title, startsAt }) => {
      notify(
        { kind: 'event_reminder' },
        roomId,
        t('events.reminderTitle', { title }),
        t('events.reminderBody', { time: formatTime(startsAt), room: roomName(roomId) }),
        () => {
          setChosenRoom(roomId);
        },
      );
    },
    // A55: someone knocks on a Mahrem room this member is on the list of. Anyone on the list
    // answers; the prompt closes everywhere once someone has (knockAnswered).
    knock: ({ roomId, userId }) => {
      const answer = async (admit: boolean) => {
        const result = await client.rooms.answerKnock(roomId, userId, { admit });
        if (!result.ok)
          toastError(t(result.error.code === 'conflict' ? 'mahrem.answered' : 'error.unexpected'));
      };
      toast(t('mahrem.knockTitle', { name: nameOf(userId) }), {
        id: knockToast(roomId, userId),
        description: t('mahrem.knockBody', { room: roomName(roomId) }),
        duration: Infinity,
        action: {
          label: t('mahrem.admit'),
          onClick: () => void answer(true),
        },
        cancel: {
          label: t('mahrem.decline'),
          onClick: () => void answer(false),
        },
      });
      notify(
        { kind: 'knock' },
        roomId,
        t('mahrem.knockTitle', { name: nameOf(userId) }),
        t('mahrem.knockBody', { room: roomName(roomId) }),
        () => {
          setChosenRoom(roomId);
        },
      );
    },
    knockAnswered: ({ roomId, userId, admit, byUserId }) => {
      toast.dismiss(knockToast(roomId, userId));
      if (userId !== store.getSnapshot().me?.id) return;
      // My own knock: in I go, or not.
      knocking.stop(roomId);
      if (admit) {
        toast.success(t('mahrem.admitted', { name: nameOf(byUserId) }));
        setChosenRoom(roomId);
        void hangout.join(roomId);
      } else {
        toast(t('mahrem.declined', { name: nameOf(byUserId) }));
      }
    },
    mahremChanged: ({ roomId, byUserId, memberIds, added, removed }) => {
      const myId = store.getSnapshot().me?.id;
      const names = (ids: string[]) =>
        ids.map((id) => (id === myId ? t('mahrem.you') : nameOf(id))).join(', ');
      const values = { room: roomName(roomId), name: nameOf(byUserId) };
      if (!memberIds.length) {
        toast(t('mahrem.turnedOff', values));
        return;
      }
      const turnedOn = added.length === memberIds.length;
      const description = [
        ...(!turnedOn && added.length ? [t('mahrem.added', { names: names(added) })] : []),
        ...(removed.length ? [t('mahrem.removed', { names: names(removed) })] : []),
      ].join(' · ');
      toast(t(turnedOn ? 'mahrem.turnedOn' : 'mahrem.listChanged', values), {
        ...(description ? { description } : {}),
      });
    },
    // A25: "Kemal (kemal@gmail.com) wants to join". The admin page lists it, with a badge.
    accessRequested: ({ email, name }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.access });
      notify(
        { kind: 'access_request' },
        null,
        t('admin.requestTitle', { name }),
        t('admin.requestBody', { email }),
        () => {
          setAdminOpen(true);
        },
      );
    },
  });
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // #46: what screens fetched may have changed while the connection was down; refresh it on
  // every (re)connect. Event windows also when the gateway says events changed.
  const connected = status.kind === 'connected';
  useEffect(() => {
    if (connected) void queryClient.invalidateQueries();
  }, [connected, queryClient]);
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.events });
  }, [state.eventsRevision, queryClient]);
  const chat = useMemo(
    (): Chat => ({ info, client, store, typing, hangout, knocking }),
    [info, client, store, typing, hangout, knocking],
  );

  useEffect(
    () => () => {
      void hangout.leave();
    },
    [hangout],
  );
  // Call problems (couldn't join, no microphone, …) as toasts, wherever the person is looking.
  useEffect(
    () =>
      hangout.onNotice((notice) => {
        toastError(t(notice));
      }),
    [hangout, t],
  );
  // A37: mute and deafen from anywhere, but only while in a call.
  const inCall = hangoutState.roomId !== null;
  useEffect(() => {
    window.hasbihal.system.setHangoutShortcuts(inCall);
  }, [inCall]);
  useEffect(
    () =>
      window.hasbihal.system.onShortcut((action) => {
        void (action === 'mute' ? hangout.toggleMute() : hangout.toggleDeafen());
      }),
    [hangout],
  );
  // Push-to-talk while the app is focused (a global one needs a native keyboard hook).
  const pttKey =
    hangoutState.settings.mode === 'ptt' && (inCall || hangoutState.micTest)
      ? hangoutState.settings.pttKey
      : null;
  useEffect(() => {
    if (!pttKey) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === pttKey) hangout.setPushToTalk(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === pttKey) hangout.setPushToTalk(false);
    };
    const release = () => {
      hangout.setPushToTalk(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [pttKey, hangout]);
  // The gateway's copy of me is the freshest; the sign-in answer covers the moment before it.
  const me = state.me ?? user;
  // The chosen room, or the first one; a deleted or archived choice falls back the same way.
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // ⌘, (Ctrl+, on Windows) opens Settings, as in most desktop apps.
  useEffect(() => {
    const open = (e: KeyboardEvent) => {
      if (e.key === ',' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', open);
    return () => {
      window.removeEventListener('keydown', open);
    };
  }, []);
  const panels = usePanelsState();
  const rooms = activeRooms(state);
  const roomId = rooms.some((r) => r.id === chosenRoom) ? chosenRoom : (rooms[0]?.id ?? null);
  useEffect(() => {
    shownRoom.current = roomId;
  }, [roomId]);
  // Unread mentions on the macOS dock and in the tray's tooltip.
  const mentions = [...state.rooms.values()].reduce((sum, r) => sum + r.unreadMentionCount, 0);
  useEffect(() => {
    window.hasbihal.system.setMentions(mentions);
  }, [mentions]);

  if (status.kind === 'upgrade_required') {
    return (
      <main className="splash">
        <Tulip size={56} />
        <p>{t('connection.upgradeRequired')}</p>
        <UpdateCard required />
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ChatProvider chat={chat}>
        <PanelsProvider value={panels}>
          <div
            className="shell"
            data-rooms-hidden={panels.panels.rooms ? undefined : true}
            data-members-hidden={panels.panels.members ? undefined : true}
          >
            <aside className="sidebar" inert={!panels.panels.rooms}>
              <div className="brand">
                <Tulip />
                <div>
                  <div className="brand__name">{t('app.name')}</div>
                  <div className="brand__tagline">{t('app.tagline')}</div>
                </div>
              </div>
              <hr className="divider" />
              <RoomList selectedId={roomId} onSelect={setChosenRoom} />
              <UpdateCard inCall={inCall} />
              {me.role === 'admin' && (
                <AdminButton
                  onOpen={() => {
                    setAdminOpen(true);
                  }}
                />
              )}
              <UserPanel
                user={me}
                presence={state.presence.get(me.id) ?? 'offline'}
                onSetPresence={setPresence}
                onSignOut={onSignOut}
                onOpenProfile={() => {
                  setProfileOpen(true);
                }}
                onOpenSettings={() => {
                  setSettingsOpen(true);
                }}
              />
            </aside>

            <main className="content">
              <div className="content__status">
                <ConnectionBadge status={status} />
              </div>
              {roomId ? (
                <RoomView key={roomId} roomId={roomId} />
              ) : (
                <>
                  <header className="content__header">
                    <PanelToggle side="rooms" />
                    <span className="content__spacer" />
                    <PanelToggle side="members" />
                  </header>
                  <div className="content__placeholder">
                    <EmptyState>
                      {t(me.role === 'admin' ? 'rooms.noneAdmin' : 'rooms.none')}
                    </EmptyState>
                  </div>
                </>
              )}
            </main>

            <aside
              className="members"
              aria-label={t('members.heading')}
              inert={!panels.panels.members}
            >
              <SearchPanel onOpenRoom={setChosenRoom}>
                <header className="members__header">{t('members.heading')}</header>
                <MemberList store={store} />
              </SearchPanel>
            </aside>
          </div>
        </PanelsProvider>
        {adminOpen && (
          <AdminDialog
            onClose={() => {
              setAdminOpen(false);
            }}
          />
        )}
        {settingsOpen && (
          <SettingsDialog
            onClose={() => {
              setSettingsOpen(false);
            }}
          />
        )}
        {profileOpen && (
          <ProfileDialog
            onClose={() => {
              setProfileOpen(false);
            }}
          />
        )}
      </ChatProvider>
    </QueryClientProvider>
  );
}

interface UserPanelProps {
  user: User;
  presence: PresenceStatus;
  onSetPresence: (mode: PresenceMode) => void;
  onSignOut: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
}

function UserPanel({
  user,
  presence,
  onSetPresence,
  onSignOut,
  onOpenProfile,
  onOpenSettings,
}: UserPanelProps) {
  const t = useT();
  const mode = presence === 'busy' ? 'busy' : 'available';
  return (
    <div className="user-panel">
      {/* As in Discord: you, your status, and what you can do about it, behind your name. */}
      <Menu
        label={t('user.menu')}
        side="top"
        align="start"
        className="user-menu"
        trigger={
          <button type="button" className="user-panel__me" aria-label={t('user.menu')}>
            <Avatar user={user} presence={presence} />
            <span className="user-panel__names">
              <span className="user-panel__display" data-testid="current-user">
                {user.displayName}
              </span>
              <span className="user-panel__status" data-testid="current-status">
                {t(PRESENCE_LABEL[presence])}
              </span>
            </span>
          </button>
        }
      >
        <MenuLabel>
          <span className="user-menu__name">{user.displayName}</span>
          <span className="user-menu__username">@{user.username}</span>
        </MenuLabel>
        <MenuSeparator />
        {/* Müsait or Meşgul (A21); Uzakta and Çevrimdışı follow from activity. */}
        <MenuRadioGroup
          value={mode}
          onChange={onSetPresence}
          options={(['available', 'busy'] as const).map((value) => ({
            value,
            label: t(PRESENCE_LABEL[value]),
            icon: <span className="presence-dot" data-presence={value} aria-hidden />,
          }))}
        />
        <MenuSeparator />
        <MenuItem icon={<Icon icon={UserRound} />} onSelect={onOpenProfile}>
          {t('profile.edit')}
        </MenuItem>
        <MenuItem icon={<Icon icon={Settings} />} onSelect={onOpenSettings}>
          {t('settings.open')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Icon icon={LogOut} />} danger onSelect={onSignOut}>
          {t('auth.signOut')}
        </MenuItem>
      </Menu>
      <Tip label={t('settings.open')}>
        <button
          type="button"
          className="icon-button user-panel__settings"
          aria-label={t('settings.open')}
          data-testid="open-settings"
          onClick={onOpenSettings}
        >
          <Icon icon={Settings} />
        </button>
      </Tip>
    </div>
  );
}
