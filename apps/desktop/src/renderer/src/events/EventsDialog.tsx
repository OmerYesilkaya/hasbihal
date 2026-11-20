import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Occurrence, RoomEvent, RsvpResponse } from '@hasbihal/protocol';
import { EmptyState } from '../components/EmptyState.tsx';
import { Menu, MenuItem, MenuSeparator } from '../components/Popover.tsx';
import { useChat, useChatState } from '../chat/context.tsx';
import type { ApiResult } from '../api.ts';
import { unwrap } from '../queries.ts';
import { formatWhen, formatTime, useT } from '../i18n.tsx';
import { EventForm, fromInputs, toInputs } from './EventForm.tsx';
import { useRefreshEvents, type EventsView } from './useEvents.ts';
import { CalendarClock, CalendarX, Check, Ellipsis, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { confirm } from '../components/confirm.tsx';
import { Tip } from '../components/Tip.tsx';

/**
 * A room's events (A15, A16): each event once, at its next time, with RSVPs for everyone, and
 * for admins adding, editing, skipping, moving, and deleting. Later dates (four weeks ahead)
 * open on request, so two weekly events don't fill the dialog (#40).
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
                {groupByEvent(occurrences).map(([eventId, list]) => {
                  const event = view.events.get(eventId);
                  return event ? (
                    <EventGroup
                      key={eventId}
                      event={event}
                      occurrences={list}
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

/** Occurrences by event, in the order each event next happens. */
function groupByEvent(occurrences: Occurrence[]): [string, Occurrence[]][] {
  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const list = groups.get(o.eventId);
    if (list) list.push(o);
    else groups.set(o.eventId, [o]);
  }
  return [...groups];
}

/** "Her hafta · Çar, Cum · 09:00"; null for a one-off event. */
function describeRepeat(event: RoomEvent, t: ReturnType<typeof useT>): string | null {
  const r = event.recurrence;
  if (!r) return null;
  const how =
    r.freq === 'weekly' && r.interval === 2
      ? t('events.repeat.biweekly')
      : t(`events.repeat.${r.freq}`);
  const names = t('events.weekdays').split(',');
  const days = r.freq === 'weekly' ? r.weekdays.map((d) => names[d] ?? '').join(', ') : '';
  return [how, days, formatTime(event.startsAt)].filter(Boolean).join(' · ');
}

/**
 * One event: its next occurrence (and any skipped ones before it, so a skip stays visible),
 * then its later dates when asked for.
 */
function EventGroup({
  event,
  occurrences,
  isAdmin,
  onEdit,
}: {
  event: RoomEvent;
  occurrences: Occurrence[];
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const next = occurrences.findIndex((o) => !o.skipped);
  const shownCount = next === -1 ? occurrences.length : next + 1;
  const later = occurrences.length - shownCount;
  const shown = expanded ? occurrences : occurrences.slice(0, shownCount);
  const repeat = describeRepeat(event, t);
  return (
    <li className="event-group" data-testid="event-group">
      <ul className="occurrences">
        {shown.map((o, i) => (
          <OccurrenceRow
            key={o.start}
            event={event}
            occurrence={o}
            repeat={i === 0 ? repeat : null}
            isAdmin={isAdmin}
            onEdit={onEdit}
          />
        ))}
      </ul>
      {later > 0 && (
        <button
          type="button"
          className="link event-group__more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          {expanded ? t('events.fewerDates') : t('events.laterDates', { count: later })}
        </button>
      )}
    </li>
  );
}

function OccurrenceRow({
  event,
  occurrence,
  repeat,
  isAdmin,
  onEdit,
}: {
  event: RoomEvent;
  occurrence: Occurrence;
  /** How the event repeats, on its first row. */
  repeat: string | null;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const { client } = useChat();
  const { me, members } = useChatState();
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState(() => toInputs(occurrence.startsAt));
  const date = client.events.occurrence(event.id, occurrence.start);
  const mine = occurrence.rsvps.find((r) => r.userId === me?.id)?.response;
  const names = (response: RsvpResponse) =>
    occurrence.rsvps
      .filter((r) => r.response === response)
      .map((r) => members.get(r.userId)?.displayName ?? '?');
  const coming = names('yes');
  const notComing = names('no');
  const invited = me ? event.inviteeIds.includes(me.id) : false;

  const refreshEvents = useRefreshEvents();
  // Any change to this date or its event: on success every event window reloads.
  const change = useMutation({
    mutationFn: (request: () => Promise<ApiResult<unknown>>) => unwrap(request()),
    onSuccess: refreshEvents,
  });
  const call = (request: () => Promise<ApiResult<unknown>>) =>
    change.mutateAsync(request).then(
      () => true,
      () => false,
    );
  const rsvp = (response: RsvpResponse) =>
    call(() => (mine === response ? date.clearRsvp() : date.rsvp({ response })));

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
        {repeat && (
          <span className="occurrence__repeat" data-testid="event-repeat">
            {repeat}
          </span>
        )}
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
        {change.isError && <span className="field__error">{t('error.unexpected')}</span>}
        {moving && (
          <form
            className="occurrence__move"
            onSubmit={(e) => {
              e.preventDefault();
              void call(() => date.change({ kind: 'moved', startsAt: fromInputs(moveTo) })).then(
                (ok) => {
                  if (ok) setMoving(false);
                },
              );
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
                <MenuItem icon={<Icon icon={Undo2} />} onSelect={() => void call(date.restore)}>
                  {t('events.restore')}
                </MenuItem>
              ) : (
                <>
                  <MenuItem
                    icon={<Icon icon={CalendarX} />}
                    onSelect={() => void call(() => date.change({ kind: 'skipped' }))}
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
                    if (yes) void call(() => client.events.delete(event.id));
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
