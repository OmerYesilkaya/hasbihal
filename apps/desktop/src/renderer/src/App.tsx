import { useState, useSyncExternalStore } from 'react';
import { ChatStore } from '@hasbihal/core';
import type { PresenceMode, PresenceStatus, User } from '@hasbihal/protocol';
import type { AppInfo } from '../../shared/app-info.ts';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { useDeepLink, useSession } from './auth/useSession.ts';
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
  const { status, setPresence } = useGateway(info, store);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // The gateway's copy of me is the freshest; the sign-in answer covers the moment before it.
  const me = state.me ?? user;

  if (status.kind === 'upgrade_required') {
    return (
      <main className="splash">
        <Tulip size={56} />
        <p>{t('connection.upgradeRequired')}</p>
      </main>
    );
  }

  return (
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
        <h2 className="section-label">{t('rooms.heading')}</h2>
        <div className="sidebar__spacer" />
        <UserPanel
          user={me}
          presence={state.presence.get(me.id) ?? 'offline'}
          onSetPresence={setPresence}
          onSignOut={onSignOut}
        />
      </aside>

      <main className="content">
        <header className="content__header">
          <span className="content__spacer" />
          <ConnectionBadge status={status} />
        </header>
        {linkWhileSignedIn && (
          <div className="banner" role="status">
            <span>{t('auth.linkWhileSignedIn')}</span>
            <button type="button" className="link" onClick={onDismissLink} aria-label="×">
              ×
            </button>
          </div>
        )}
        <p className="content__placeholder">{t('placeholder.welcome')}</p>
      </main>

      <aside className="members" aria-label={t('members.heading')}>
        <header className="members__header">{t('members.heading')}</header>
        <MemberList store={store} />
      </aside>
    </div>
  );
}

interface UserPanelProps {
  user: User;
  presence: PresenceStatus;
  onSetPresence: (mode: PresenceMode) => void;
  onSignOut: () => void;
}

function UserPanel({ user, presence, onSetPresence, onSignOut }: UserPanelProps) {
  const t = useT();
  return (
    <div className="user-panel">
      <Avatar user={user} presence={presence} />
      <div className="user-panel__names">
        <div className="user-panel__display" data-testid="current-user">
          {user.displayName}
        </div>
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
