import { useState } from 'react';
import { activeRooms } from '@hasbihal/core';
import { Room } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useT } from '../i18n.tsx';
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
            </li>
          );
        })}
      </ul>
      {!rooms.length && !creating && <p className="room-list__empty">{t('rooms.empty')}</p>}
    </nav>
  );
}
