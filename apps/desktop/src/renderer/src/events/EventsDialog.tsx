import { useState } from 'react';
import type { MessageKey } from '@hasbihal/core';
import type { Occurrence, RoomEvent, RsvpResponse } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { Menu, MenuItem, MenuSeparator } from '../components/Popover.tsx';
import { useChat, useChatState } from '../chat/context.tsx';
import { formatWhen, formatTime, useT } from '../i18n.tsx';
import { EventForm, fromInputs, toInputs } from './EventForm.tsx';
import type { EventsView } from './useEvents.ts';
import { CalendarClock, CalendarX, Check, Ellipsis, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { confirm } from '../components/confirm.tsx';
import { Tip } from '../components/Tip.tsx';

/**
 * A room's events (A15, A16): what's coming up for four weeks, with RSVPs per occurrence for
 * everyone, and for admins adding, editing, skipping, moving, and deleting.
 */
export function EventsDialog({
  roomId,
  view,
  onClose,
}: {
  roomId: string;
  view: EventsView;
  onClose: () => void;
}) {
  const t = useT();
  const { me, rooms } = useChatState();
  const [editing, setEditing] = useState<RoomEvent | 'new' | null>(null);
  const isAdmin = me?.role === 'admin';
  const occurrences = view.occurrences.filter((o) => view.events.get(o.eventId)?.roomId === roomId);

  return (
    <Modal className="profile events-dialog" testId="events-dialog" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>
          {t('events.heading')} · #{rooms.get(roomId)?.name ?? ''}
        </ModalTitle>
        <ModalClose className="link">{t('attachment.close')}</ModalClose>
      </header>
      {editing ? (
        <section className="profile__section">
          <EventForm
            roomId={roomId}
            event={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null);
            }}
          />
        </section>
      ) : (
        <>
          {isAdmin && (
            <section className="profile__section events-dialog__add">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  setEditing('new');
                }}
              >
                {t('events.add')}
              </button>
            </section>
          )}
          <section className="profile__section">
            {!view.loaded ? (
              <p className="field__hint">{t('room.loading')}</p>
            ) : occurrences.length === 0 ? (
              <EmptyState>{t('events.none')}</EmptyState>
            ) : (
              <ul className="occurrences">
                {occurrences.map((o) => {
                  const event = view.events.get(o.eventId);
                  return event ? (
                    <OccurrenceRow
                      key={`${o.eventId}@${o.start}`}
                      event={event}
                      occurrence={o}
                      isAdmin={isAdmin}
                      onEdit={() => {
                        setEditing(event);
                      }}
                    />
                  ) : null;
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}

function OccurrenceRow({
  event,
  occurrence,
  isAdmin,
  onEdit,
}: {
  event: RoomEvent;
  occurrence: Occurrence;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const { info } = useChat();
  const { me, members } = useChatState();
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState(() => toInputs(occurrence.startsAt));
  const [error, setError] = useState<MessageKey | null>(null);
  const base = `/events/${event.id}/occurrences/${occurrence.start}`;
  const mine = occurrence.rsvps.find((r) => r.userId === me?.id)?.response;
  const names = (response: RsvpResponse) =>
    occurrence.rsvps
      .filter((r) => r.response === response)
      .map((r) => members.get(r.userId)?.displayName ?? '?');
  const coming = names('yes');
  const notComing = names('no');
  const invited = me ? event.inviteeIds.includes(me.id) : false;

  const call = async (method: 'PUT' | 'DELETE', path: string, body?: unknown) => {
    const result = await api(info.serverUrl, method, path, body === undefined ? {} : { body });
    setError(result.ok ? null : 'error.unexpected');
    return result.ok;
  };
  const rsvp = (response: RsvpResponse) =>
    mine === response ? call('DELETE', `${base}/rsvp`) : call('PUT', `${base}/rsvp`, { response });

  return (
    <li
      className="occurrence"
      data-skipped={occurrence.skipped ? true : undefined}
      data-testid="occurrence"
    >
      <div className="occurrence__when">
        <strong>
          {formatWhen(occurrence.startsAt, {
            today: t('events.today'),
            tomorrow: t('events.tomorrow'),
          })}
        </strong>
        <span>–{formatTime(occurrence.endsAt)}</span>
      </div>
      <div className="occurrence__what">
        <span className="occurrence__title">
          {event.title}
          {occurrence.skipped && <em> · {t('events.skipped')}</em>}
          {occurrence.moved && <em> · {t('events.moved')}</em>}
          {invited && <span className="occurrence__invited"> · {t('events.invited')}</span>}
        </span>
        {event.description && <span className="occurrence__description">{event.description}</span>}
        {!occurrence.skipped && (
          <span className="occurrence__rsvps">
            {coming.length > 0 && (
              <Tip label={coming.join(', ')}>
                <span data-testid="rsvp-coming">
                  <Icon icon={Check} /> {coming.join(', ')}
                </span>
              </Tip>
            )}
            {notComing.length > 0 && (
              <Tip label={notComing.join(', ')}>
                <span data-testid="rsvp-not-coming">
                  <Icon icon={X} /> {notComing.join(', ')}
                </span>
              </Tip>
            )}
          </span>
        )}
        {error && <span className="field__error">{t(error)}</span>}
        {moving && (
          <form
            className="occurrence__move"
            onSubmit={(e) => {
              e.preventDefault();
              void call('PUT', base, { kind: 'moved', startsAt: fromInputs(moveTo) }).then((ok) => {
                if (ok) setMoving(false);
              });
            }}
          >
            <input
              type="date"
              className="field__input"
              aria-label={t('events.date')}
              value={moveTo.date}
              onChange={(e) => {
                setMoveTo({ ...moveTo, date: e.target.value });
              }}
            />
            <input
              type="time"
              className="field__input"
              aria-label={t('events.time')}
              value={moveTo.time}
              onChange={(e) => {
                setMoveTo({ ...moveTo, time: e.target.value });
              }}
            />
            <button type="submit" className="button button--primary">
              {t('events.save')}
            </button>
          </form>
        )}
      </div>
      <div className="occurrence__actions">
        {!occurrence.skipped && (
          <>
            <button
              type="button"
              className="chip"
              aria-pressed={mine === 'yes'}
              onClick={() => void rsvp('yes')}
            >
              {t('events.going')}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={mine === 'no'}
              onClick={() => void rsvp('no')}
            >
              {t('events.notGoing')}
            </button>
          </>
        )}
        {isAdmin && (
          <Menu
            label={t('events.manage')}
            trigger={
              <Tip label={t('events.manage')}>
                <button type="button" className="icon-button" aria-label={t('events.manage')}>
                  <Icon icon={Ellipsis} />
                </button>
              </Tip>
            }
          >
            <>
              {occurrence.skipped || occurrence.moved ? (
                <MenuItem icon={<Icon icon={Undo2} />} onSelect={() => void call('DELETE', base)}>
                  {t('events.restore')}
                </MenuItem>
              ) : (
                <>
                  <MenuItem
                    icon={<Icon icon={CalendarX} />}
                    onSelect={() => void call('PUT', base, { kind: 'skipped' })}
                  >
                    {t('events.skip')}
                  </MenuItem>
                  <MenuItem
                    icon={<Icon icon={CalendarClock} />}
                    onSelect={() => {
                      setMoving((m) => !m);
                    }}
                  >
                    {t('events.move')}
                  </MenuItem>
                </>
              )}
              <MenuItem icon={<Icon icon={Pencil} />} onSelect={onEdit}>
                {t('events.edit')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<Icon icon={Trash2} />}
                danger
                onSelect={() =>
                  void confirm({
                    message: t('events.deleteConfirm', { title: event.title }),
                    action: t('events.delete'),
                    danger: true,
                  }).then((yes) => {
                    if (yes) void call('DELETE', `/events/${event.id}`);
                  })
                }
              >
                {t('events.delete')}
              </MenuItem>
            </>
          </Menu>
        )}
      </div>
    </li>
  );
}
