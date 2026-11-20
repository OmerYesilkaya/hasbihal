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
import { useDeepLink, useSession } from './auth/useSession.ts';
import { ChatProvider, type Chat } from './chat/context.tsx';
import { ProfileDialog } from './chat/ProfileDialog.tsx';
import { RoomList } from './chat/RoomList.tsx';
import { RoomView } from './chat/RoomView.tsx';
import { Avatar } from './components/Avatar.tsx';
import { ConnectionBadge } from './components/ConnectionBadge.tsx';
import { AdminDialog } from './admin/AdminDialog.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { MemberList, PRESENCE_LABEL } from './components/MemberList.tsx';
import { SearchPanel } from './components/SearchPanel.tsx';
import { Tulip } from './components/Tulip.tsx';
import { formatTime, I18nProvider, useT } from './i18n.tsx';
import { HangoutSession } from './hangout/session.ts';
import { playChime } from './sound.ts';
import { useGateway } from './useGateway.ts';
import { PanelsProvider, PanelToggle, usePanelsState } from './layout/panels.tsx';
import { SettingsDialog } from './settings/SettingsDialog.tsx';
import { Settings, Shield, X } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { ConfirmHost } from './components/confirm.tsx';
import { Icon } from './components/Icon.tsx';
import { Select } from './components/controls.tsx';
import { Tip, TipProvider } from './components/Tip.tsx';

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
          },
        }}
      />
    </I18nProvider>
  );
}

function Root({ info }: { info: AppInfo }) {
  const t = useT();
  const session = useSession();
  const [link, clearLink] = useDeepLink();
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
      </main>
    );
  }

  if (state.kind === 'signedOut') {
    return (
      <AuthScreen
        key={link ? `${link.kind}:${link.token}` : 'none'}
        link={link}
        sessionEnded={state.ended}
        onSignedIn={(user) => {
          clearLink();
          session.signedIn(user);
        }}
      />
    );
  }

  return (
    <Shell
      info={info}
      user={state.user}
      linkWhileSignedIn={link !== null}
      onDismissLink={clearLink}
      onSignOut={() => void session.signOut()}
    />
  );
}

interface ShellProps {
  info: AppInfo;
  user: User;
  linkWhileSignedIn: boolean;
  onDismissLink: () => void;
  onSignOut: () => void;
}

function Shell({ info, user, linkWhileSignedIn, onDismissLink, onSignOut }: ShellProps) {
  const t = useT();
  // One store per signed-in session: signing out unmounts the shell and drops it.
  const [store] = useState(() => new ChatStore());
  // One call per signed-in session too; signing out leaves it.
  const [hangout] = useState(() => new HangoutSession(info.serverUrl));
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
   * `onClick`. Our own chime instead of the system sound, so it's the same everywhere.
   */
  const notify = (
    occasion: Occasion,
    roomId: string,
    title: string,
    body: string,
    onClick: () => void,
  ) => {
    const viewingRoom = document.hasFocus() && shownRoom.current === roomId;
    const notice = noticeFor(occasion, { ...situation(), viewingRoom });
    if (!notice.notify) return;
    if (notice.sound) playChime();
    const notification = new Notification(title, { body, silent: true });
    notification.onclick = () => {
      window.hasbihal.system.focusWindow();
      onClick();
    };
  };
  const nameOf = (userId: string) => store.getSnapshot().members.get(userId)?.displayName ?? '?';
  const roomName = (roomId: string) => store.getSnapshot().rooms.get(roomId)?.name ?? '?';
  const { status, setPresence, typing } = useGateway(info, store, {
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
  });
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const chat = useMemo(
    (): Chat => ({ info, store, typing, hangout }),
    [info, store, typing, hangout],
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
        toast.error(t(notice));
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
    hangoutState.settings.mode === 'ptt' && inCall ? hangoutState.settings.pttKey : null;
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
  const [adminOpen, setAdminOpen] = useState(false);
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
      </main>
    );
  }

  return (
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
            {me.role === 'admin' && (
              <button
                type="button"
                className="sidebar__admin"
                onClick={() => {
                  setAdminOpen(true);
                }}
              >
                <Icon icon={Shield} /> {t('admin.heading')}
              </button>
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
            {linkWhileSignedIn && (
              <div className="banner" role="status">
                <span>{t('auth.linkWhileSignedIn')}</span>
                <button type="button" className="link" onClick={onDismissLink} aria-label="×">
                  <Icon icon={X} />
                </button>
              </div>
            )}
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
  return (
    <div className="user-panel">
      <Tip label={t('profile.open')}>
        <button type="button" className="user-panel__profile" onClick={onOpenProfile}>
          <Avatar user={user} presence={presence} />
        </button>
      </Tip>
      <div className="user-panel__names">
        <button
          type="button"
          className="user-panel__display"
          data-testid="current-user"
          onClick={onOpenProfile}
        >
          {user.displayName}
        </button>
        {/* Müsait or Meşgul (A21); Uzakta and Çevrimdışı follow from activity. */}
        <Select
          className="user-panel__presence"
          label={t('presence.choose')}
          hideLabel
          value={presence === 'busy' ? 'busy' : 'available'}
          onChange={onSetPresence}
          options={(['available', 'busy'] as const).map((mode) => ({
            value: mode,
            label: t(PRESENCE_LABEL[mode]),
          }))}
        />
      </div>
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
      <button type="button" className="link user-panel__sign-out" onClick={onSignOut}>
        {t('auth.signOut')}
      </button>
    </div>
  );
}
