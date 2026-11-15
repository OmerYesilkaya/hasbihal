import { useSyncExternalStore } from 'react';
import { sortMembers, type ChatStore } from '@hasbihal/core';
import type { MessageKey } from '@hasbihal/core';
import type { PresenceStatus } from '@hasbihal/protocol';
import { useT } from '../i18n.tsx';
import { Avatar } from './Avatar.tsx';

export const PRESENCE_LABEL: Record<PresenceStatus, MessageKey> = {
  available: 'presence.available',
  away: 'presence.away',
  busy: 'presence.busy',
  offline: 'presence.offline',
};

/** The right-hand column (A36): everyone, present people first, with their status (A21). */
export function MemberList({ store }: { store: ChatStore }) {
  const t = useT();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const members = sortMembers(state);
  return (
    <ul className="member-list">
      {members.map((member) => {
        const presence = state.presence.get(member.id) ?? 'offline';
        return (
          <li key={member.id} className="member" data-presence={presence} data-testid="member">
            <Avatar user={member} presence={presence} />
            <div className="member__names">
              <div className="member__name">{member.displayName}</div>
              <div className="member__status">{t(PRESENCE_LABEL[presence])}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
