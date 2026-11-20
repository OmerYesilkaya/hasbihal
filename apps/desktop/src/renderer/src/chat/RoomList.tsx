import { useId, useState } from 'react';
import { activeRooms } from '@hasbihal/core';
import { Room } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
import { nextOccurrence, useEvents } from '../events/useEvents.ts';
import { dayKey, formatTime, useT } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';
import { BellOff, Calendar } from 'lucide-react';
import { RoomMenu } from '../rooms/RoomMenu.tsx';
import { Icon } from '../components/Icon.tsx';
import { Tip } from '../components/Tip.tsx';

/**
 * The sidebar's rooms (A36): this member's favourites first, unread badges (A28), and a menu per
 * room; admins can add one (A12).
 */
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
  const favorites = rooms.filter((r) => r.prefs.favorite);
  const others = rooms.filter((r) => !r.prefs.favorite);
  const id = useId();
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

  const renderRoom = (room: (typeof rooms)[number]) => {
    const selected = room.id === selectedId;
    // A muted room keeps only its mention badge (A28).
    const muted = room.prefs.notify === 'muted';
    const unread = !selected && (muted ? room.unreadMentionCount > 0 : room.unreadCount > 0);
    const count = muted ? room.unreadMentionCount : room.unreadCount;
    return (
      <li key={room.id} className="room-row">
        <button
          type="button"
          className="room"
          data-testid="room"
          aria-current={selected ? 'page' : undefined}
          data-muted={muted ? true : undefined}
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
                <Icon icon={Calendar} /> {formatTime(next.startsAt)}
              </span>
            ) : null;
          })()}
          {muted && <Icon icon={BellOff} className="room__muted" />}
          {unread && (
            <span
              className="badge"
              data-mention={room.unreadMentionCount > 0 ? true : undefined}
              data-testid="unread"
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
        <RoomMenu roomId={room.id} roomName={room.name} />
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
  };

  return (
    <nav className="room-list" aria-label={t('rooms.heading')}>
      {favorites.length > 0 && (
        <>
          <h2 className="section-label" id={`${id}-favorites`}>
            {t('rooms.favorites')}
          </h2>
          <ul className="room-list__rooms" aria-labelledby={`${id}-favorites`}>
            {favorites.map(renderRoom)}
          </ul>
        </>
      )}
      <div className="room-list__heading">
        <h2 className="section-label">{t('rooms.heading')}</h2>
        {state.me?.role === 'admin' && (
          <Tip label={t('rooms.create')}>
            <button
              type="button"
              className="icon-button"
              aria-label={t('rooms.create')}
              onClick={() => {
                setCreating(true);
              }}
            >
              +
            </button>
          </Tip>
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
      <ul className="room-list__rooms">{others.map(renderRoom)}</ul>
      {!rooms.length && !creating && <p className="room-list__empty">{t('rooms.empty')}</p>}
    </nav>
  );
}
