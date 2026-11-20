import { useSyncExternalStore } from 'react';
import { hangoutOf, sortMembers, type ChatStore } from '@hasbihal/core';
import type { MessageKey } from '@hasbihal/core';
import { type PresenceStatus, type User } from '@hasbihal/protocol';
import { useChat, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import { Avatar } from './Avatar.tsx';
import { Hand } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from './toast.ts';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';

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
  const call = useHangout();
  const members = sortMembers(state);
  return (
    <ul className="member-list">
      {members.map((member) => {
        const presence = state.presence.get(member.id) ?? 'offline';
        const voiceRoom = hangoutOf(state, member.id);
        const sharing =
          voiceRoom !== undefined &&
          (state.hangouts.get(voiceRoom)?.some((p) => p.userId === member.id && p.screenShare) ??
            false);
        // A13: from a call, call others in (not yourself, not people already there).
        const canNudge =
          call.roomId !== null && member.id !== state.me?.id && voiceRoom !== call.roomId;
        return (
          <li key={member.id} className="member" data-presence={presence} data-testid="member">
            <Avatar user={member} presence={presence} />
            <div className="member__names">
              <div className="member__name">{member.displayName}</div>
              <div className="member__status">
                {voiceRoom
                  ? t('members.inHangout', { room: state.rooms.get(voiceRoom)?.name ?? '?' })
                  : t(PRESENCE_LABEL[presence])}
                {sharing && <span className="live-badge">{t('share.live')}</span>}
              </div>
            </div>
            {canNudge && <NudgeButton member={member} roomId={call.roomId} />}
          </li>
        );
      })}
    </ul>
  );
}

/** "Sohbete çağır" (A13): a nudge into the call you're in; the answer comes as a toast. */
function NudgeButton({ member, roomId }: { member: User; roomId: string | null }) {
  const t = useT();
  const { client } = useChat();
  const nudge = async () => {
    if (!roomId) return;
    const res = await client.nudge({ toUserId: member.id, roomId });
    const busy = !res.ok && res.error.issues?.[0]?.code === 'recipient_busy';
    const name = member.displayName;
    if (res.ok) toast(t(res.value.delivered ? 'nudge.sent' : 'nudge.offline', { name }));
    else if (busy) toast(t('nudge.busy', { name }));
    else if (res.error.code === 'rate_limited') toast(t('nudge.tooSoon', { name }));
    else toastError(t('error.unexpected'));
  };
  return (
    <Tip label={t('nudge.action')}>
      <button
        type="button"
        className="icon-button member__nudge"
        aria-label={t('nudge.action')}
        onClick={() => void nudge()}
      >
        <Icon icon={Hand} />
      </button>
    </Tip>
  );
}
