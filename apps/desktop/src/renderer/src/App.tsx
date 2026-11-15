import { useMemo, useState, useSyncExternalStore } from 'react';
import { activeRooms, ChatStore } from '@hasbihal/core';
import type { PresenceMode, PresenceStatus, User } from '@hasbihal/protocol';
import type { AppInfo } from '../../shared/app-info.ts';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { useDeepLink, useSession } from './auth/useSession.ts';
import { ChatProvider, type Chat } from './chat/context.tsx';
import { ProfileDialog } from './chat/ProfileDialog.tsx';
import { RoomList } from './chat/RoomList.tsx';
import { RoomView } from './chat/RoomView.tsx';
import { Avatar } from './components/Avatar.tsx';
import { ConnectionBadge } from './components/ConnectionBadge.tsx';
import { MemberList, PRESENCE_LABEL } from './components/MemberList.tsx';
import { Tulip } from './components/Tulip.tsx';
import { I18nProvider, useT } from './i18n.tsx';
import { useGateway } from './useGateway.ts';

export function App({ info }: { info: AppInfo }) {
  return (
    <I18nProvider>
      <Root info={info} />
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
  const { status, setPresence, typing } = useGateway(info, store);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const chat = useMemo((): Chat => ({ info, store, typing }), [info, store, typing]);
  // The gateway's copy of me is the freshest; the sign-in answer covers the moment before it.
  const me = state.me ?? user;
  // The chosen room, or the first one; a deleted or archived choice falls back the same way.
  const [chosenRoom, setChosenRoom] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const rooms = activeRooms(state);
  const roomId = rooms.some((r) => r.id === chosenRoom) ? chosenRoom : (rooms[0]?.id ?? null);

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
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <Tulip />
            <div>
              <div className="brand__name">{t('app.name')}</div>
              <div className="brand__tagline">{t('app.tagline')}</div>
            </div>
          </div>
          <hr className="divider" />
          <RoomList selectedId={roomId} onSelect={setChosenRoom} />
          <UserPanel
            user={me}
            presence={state.presence.get(me.id) ?? 'offline'}
            onSetPresence={setPresence}
            onSignOut={onSignOut}
            onOpenProfile={() => {
              setProfileOpen(true);
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
                ×
              </button>
            </div>
          )}
          {roomId ? (
            <RoomView key={roomId} roomId={roomId} />
          ) : (
            <p className="content__placeholder">
              {t(me.role === 'admin' ? 'rooms.noneAdmin' : 'rooms.none')}
            </p>
          )}
        </main>

        <aside className="members" aria-label={t('members.heading')}>
          <header className="members__header">{t('members.heading')}</header>
          <MemberList store={store} />
        </aside>
      </div>
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
}

function UserPanel({ user, presence, onSetPresence, onSignOut, onOpenProfile }: UserPanelProps) {
  const t = useT();
  return (
    <div className="user-panel">
      <button
        type="button"
        className="user-panel__profile"
        title={t('profile.open')}
        onClick={onOpenProfile}
      >
        <Avatar user={user} presence={presence} />
      </button>
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
        <select
          className="user-panel__presence"
          aria-label={t('presence.choose')}
          value={presence === 'busy' ? 'busy' : 'available'}
          onChange={(e) => {
            onSetPresence(e.target.value === 'busy' ? 'busy' : 'available');
          }}
        >
          <option value="available">{t(PRESENCE_LABEL.available)}</option>
          <option value="busy">{t(PRESENCE_LABEL.busy)}</option>
        </select>
      </div>
      <button type="button" className="link user-panel__sign-out" onClick={onSignOut}>
        {t('auth.signOut')}
      </button>
    </div>
  );
}
