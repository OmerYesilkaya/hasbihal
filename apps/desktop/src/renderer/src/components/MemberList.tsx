import { useState, useSyncExternalStore } from 'react';
import { hangoutOf, sortMembers, type ChatStore } from '@hasbihal/core';
import type { MessageKey } from '@hasbihal/core';
import { NudgeResult, type PresenceStatus, type User } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useChat, useHangout } from '../chat/context.tsx';
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
  const call = useHangout();
  const members = sortMembers(state);
  return (
    <ul className="member-list">
      {members.map((member) => {
        const presence = state.presence.get(member.id) ?? 'offline';
        const voiceRoom = hangoutOf(state, member.id);
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
              </div>
            </div>
            {canNudge && <NudgeButton member={member} roomId={call.roomId} />}
          </li>
        );
      })}
    </ul>
  );
}

/** "Sohbete çağır" (A13): a nudge into the call you're in, with the answer shown briefly. */
function NudgeButton({ member, roomId }: { member: User; roomId: string | null }) {
  const t = useT();
  const { info } = useChat();
  const [result, setResult] = useState<MessageKey | null>(null);
  const nudge = async () => {
    if (!roomId) return;
    const res = await api(info.serverUrl, 'POST', '/nudges', {
      body: { toUserId: member.id, roomId },
      schema: NudgeResult,
    });
    const busy = !res.ok && res.error.issues?.[0]?.code === 'recipient_busy';
    setResult(
      res.ok
        ? res.value?.delivered
          ? 'nudge.sent'
          : 'nudge.offline'
        : busy
          ? 'nudge.busy'
          : res.error.code === 'rate_limited'
            ? 'nudge.tooSoon'
            : 'error.unexpected',
    );
    setTimeout(() => {
      setResult(null);
    }, 3000);
  };
  return result ? (
    <span className="member__nudge-result">{t(result)}</span>
  ) : (
    <button
      type="button"
      className="icon-button member__nudge"
      title={t('nudge.action')}
      aria-label={t('nudge.action')}
      onClick={() => void nudge()}
    >
      👋
    </button>
  );
}
