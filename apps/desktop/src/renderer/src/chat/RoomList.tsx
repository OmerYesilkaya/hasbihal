import { useState } from 'react';
import { activeRooms } from '@hasbihal/core';
import { Room } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
import { nextOccurrence, useEvents } from '../events/useEvents.ts';
import { dayKey, formatTime, useT } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';

/** The sidebar's rooms (A36), with unread badges (A28); admins can add one (A12). */
export function RoomList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const t = useT();
  // A16: rooms with an event today show its time.
  const events = useEvents(null, 1);
  const today = dayKey(new Date().toISOString());
  const { info, store } = useChat();
  const state = useChatState();
  const rooms = activeRooms(state);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState(false);

  const create = async () => {
    const result = await api(info.serverUrl, 'POST', '/rooms', { body: { name }, schema: Room });
    if (!result.ok || !result.value) {
      setError(true);
      return;
    }
    store.apply({ type: 'room_created', room: result.value });
    setCreating(false);
    setName('');
    setError(false);
    onSelect(result.value.id);
  };

  return (
    <nav className="room-list" aria-label={t('rooms.heading')}>
      <div className="room-list__heading">
        <h2 className="section-label">{t('rooms.heading')}</h2>
        {state.me?.role === 'admin' && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('rooms.create')}
            title={t('rooms.create')}
            onClick={() => {
              setCreating(true);
            }}
          >
            +
          </button>
        )}
      </div>
      {creating && (
        <form
          className="room-list__create"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input
            className="field__input"
            value={name}
            placeholder={t('rooms.namePlaceholder')}
            aria-label={t('rooms.name')}
            aria-invalid={error ? true : undefined}
            maxLength={50}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setCreating(false);
            }}
          />
        </form>
      )}
      <ul>
        {rooms.map((room) => {
          const selected = room.id === selectedId;
          const unread = !selected && room.unreadCount > 0;
          return (
            <li key={room.id}>
              <button
                type="button"
                className="room"
                data-testid="room"
                aria-current={selected ? 'page' : undefined}
                data-unread={unread ? true : undefined}
                onClick={() => {
                  onSelect(room.id);
                }}
              >
                <span className="room__hash" aria-hidden>
                  #
                </span>
                <span className="room__name">{room.name}</span>
                {(() => {
                  const next = nextOccurrence(events, room.id);
                  return next && dayKey(next.startsAt) === today ? (
                    <span className="room__event" data-testid="room-event">
                      📅 {formatTime(next.startsAt)}
                    </span>
                  ) : null;
                })()}
                {unread && (
                  <span
                    className="badge"
                    data-mention={room.unreadMentionCount > 0 ? true : undefined}
                    data-testid="unread"
                  >
                    {room.unreadCount > 99 ? '99+' : room.unreadCount}
                  </span>
                )}
              </button>
              {(state.hangouts.get(room.id)?.length ?? 0) > 0 && (
                <ul
                  className="room__voice"
                  aria-label={t('hangout.inRoom', {
                    count: state.hangouts.get(room.id)?.length ?? 0,
                  })}
                >
                  {state.hangouts.get(room.id)?.map((p) => {
                    const member = state.members.get(p.userId);
                    return member ? (
                      <li key={p.userId}>
                        <Avatar user={member} />
                        <span>{member.displayName}</span>
                        {p.screenShare && <span className="live-badge">{t('share.live')}</span>}
                      </li>
                    ) : null;
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {!rooms.length && !creating && <p className="room-list__empty">{t('rooms.empty')}</p>}
    </nav>
  );
}
