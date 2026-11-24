import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Occurrence, RoomEvent, RsvpResponse, User } from '@hasbihal/protocol';
import { Avatar } from '../components/Avatar.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { Menu, MenuItem, MenuSeparator } from '../components/Popover.tsx';
import { useChat, useChatState } from '../chat/context.tsx';
import type { ApiResult } from '../api.ts';
import { unwrap } from '../queries.ts';
import {
  formatDateParts,
  formatList,
  formatShortDate,
  formatTime,
  relativeDay,
  toUpper,
  useT,
} from '../i18n.tsx';
import { EventForm, fromInputs, toInputs } from './EventForm.tsx';
import { useNow, useRefreshEvents, type EventsView } from './useEvents.ts';
import {
  CalendarClock,
  CalendarX,
  Check,
  ChevronLeft,
  Clock,
  Ellipsis,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { confirm } from '../components/confirm.tsx';
import { Tip } from '../components/Tip.tsx';

/**
 * A room's events (A15, A16) as invitation cards: each event once, at its next date, with the
 * RSVP in the same place on every card; its other dates in the four weeks are pills that switch
 * the card to them (#40). Admins add from the header and manage each date from the card's menu.
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
  const close = t('events.close');

  return (
    <Modal className="events-dialog" testId="events-dialog" onClose={onClose}>
      <header className="events-dialog__header">
        {editing && (
          <Tip label={t('events.back')}>
            <button
              type="button"
              className="icon-button"
              aria-label={t('events.back')}
              onClick={() => {
                setEditing(null);
              }}
            >
              <Icon icon={ChevronLeft} />
            </button>
          </Tip>
        )}
        <div className="events-dialog__heading">
          <ModalTitle>
            {editing === 'new' ? t('events.new') : editing ? t('events.edit') : t('events.heading')}
          </ModalTitle>
          {!editing && <p>{t('events.subtitle', { room: rooms.get(roomId)?.name ?? '' })}</p>}
        </div>
        {!editing && isAdmin && (
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              setEditing('new');
            }}
          >
            <Icon icon={Plus} /> {t('events.new')}
          </button>
        )}
        <Tip label={close}>
          <ModalClose className="icon-button" aria-label={close}>
            <Icon icon={X} />
          </ModalClose>
        </Tip>
      </header>
      {editing ? (
        <EventForm
          roomId={roomId}
          event={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
          }}
        />
      ) : (
        <div className="events-dialog__body">
          {!view.loaded ? (
            <p className="field__hint">{t('room.loading')}</p>
          ) : occurrences.length === 0 ? (
            <EmptyState>{t('events.none')}</EmptyState>
          ) : (
            groupByEvent(occurrences).map(([eventId, list]) => {
              const event = view.events.get(eventId);
              return event ? (
                <EventCard
                  key={eventId}
                  event={event}
                  occurrences={list}
                  isAdmin={isAdmin}
                  onEdit={() => {
                    setEditing(event);
                  }}
                />
              ) : null;
            })
          )}
        </div>
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
  const next = (list: Occurrence[]) => (list.find((o) => !o.skipped) ?? list[0])?.startsAt ?? '';
  return [...groups].sort(([, a], [, b]) => Date.parse(next(a)) - Date.parse(next(b)));
}

/** "Her hafta · Çar, Cum"; null for a one-off event. */
function describeRepeat(event: RoomEvent, t: ReturnType<typeof useT>): string | null {
  const r = event.recurrence;
  if (!r) return null;
  const how =
    r.freq === 'weekly' && r.interval === 2
      ? t('events.repeat.biweekly')
      : t(`events.repeat.${r.freq}`);
  const names = t('events.weekdays').split(',');
  const days = r.freq === 'weekly' ? r.weekdays.map((d) => names[d] ?? '').join(', ') : '';
  return [how, days].filter(Boolean).join(' · ');
}

/** One event: the card for its next date, or for the date picked from its pills. */
function EventCard({
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
  const next = occurrences.find((o) => !o.skipped) ?? occurrences[0];
  const [picked, setPicked] = useState<string | null>(null);
  const shown = occurrences.find((o) => o.start === picked) ?? next;
  if (!shown) return null;
  const dates =
    occurrences.length > 1 ? (
      <div className="event-card__dates">
        <span>{t('events.otherDates')}</span>
        {occurrences.map((o) => (
          <button
            key={o.start}
            type="button"
            className="event-card__date"
            aria-pressed={o === shown}
            data-skipped={o.skipped ? true : undefined}
            data-testid="event-date"
            title={o.skipped ? t('events.skipped') : undefined}
            onClick={() => {
              setPicked(o.start);
            }}
          >
            {formatShortDate(o.startsAt)}
          </button>
        ))}
      </div>
    ) : null;
  return (
    <OccurrenceCard
      // A fresh card per date, so a half-done move doesn't carry over to another date.
      key={shown.start}
      event={event}
      occurrence={shown}
      isNext={shown === next}
      dates={dates}
      isAdmin={isAdmin}
      onEdit={onEdit}
    />
  );
}

function OccurrenceCard({
  event,
  occurrence,
  isNext,
  dates,
  isAdmin,
  onEdit,
}: {
  event: RoomEvent;
  occurrence: Occurrence;
  isNext: boolean;
  dates: ReactNode;
  isAdmin: boolean;
  onEdit: () => void;
}) {
  const t = useT();
  const { client } = useChat();
  const { me, members } = useChatState();
  const now = useNow();
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState(() => toInputs(occurrence.startsAt));
  const date = client.events.occurrence(event.id, occurrence.start);
  const mine = occurrence.rsvps.find((r) => r.userId === me?.id)?.response;
  const people = (response: RsvpResponse) =>
    occurrence.rsvps
      .filter((r) => r.response === response)
      .map((r) => members.get(r.userId))
      .filter((m): m is User => m !== undefined);
  const coming = people('yes');
  const notComing = people('no');
  const invited = me ? event.inviteeIds.includes(me.id) : false;
  const running =
    !occurrence.skipped &&
    Date.parse(occurrence.startsAt) <= now &&
    now < Date.parse(occurrence.endsAt);
  const relative = relativeDay(occurrence.startsAt);
  const parts = formatDateParts(occurrence.startsAt);
  const repeat = describeRepeat(event, t);

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

  const names = coming.map((m) => m.displayName);
  const comingText =
    names.length === 0
      ? t('events.comingNone')
      : t('events.coming', {
          count: names.length,
          names: formatList(
            names.length <= 3
              ? names
              : [...names.slice(0, 2), t('events.comingMore', { count: names.length - 2 })],
          ),
        });
  const whoTip = [
    names.length ? names.join(', ') : null,
    notComing.length
      ? t('events.notComing', { names: notComing.map((m) => m.displayName).join(', ') })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article
      className="event-card"
      data-next={isNext ? true : undefined}
      data-running={running ? true : undefined}
      data-skipped={occurrence.skipped ? true : undefined}
      data-testid="event-card"
    >
      <div className="event-card__top">
        <div className="event-card__page" aria-hidden>
          <span className="event-card__month">
            {running
              ? toUpper(t('events.now'))
              : relative
                ? toUpper(t(`events.${relative}`))
                : parts.month}
          </span>
          <span className="event-card__day">{parts.day}</span>
          <span className="event-card__weekday">{parts.weekday}</span>
        </div>
        <div className="event-card__what">
          <div className="event-card__title">
            <span>{event.title}</span>
            {invited && <span className="tag">{t('events.invited')}</span>}
            {occurrence.moved && <span className="tag tag--warn">{t('events.moved')}</span>}
          </div>
          <div className="event-card__meta">
            <Icon icon={Clock} />
            <span>
              {formatTime(occurrence.startsAt)}–{formatTime(occurrence.endsAt)}
            </span>
            <span aria-hidden>·</span>
            {repeat && <Icon icon={Repeat} />}
            <span data-testid="event-repeat">{repeat ?? t('events.oneOff')}</span>
          </div>
          {event.description && <p className="event-card__description">{event.description}</p>}
          {dates}
        </div>
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
      {(moving || change.isError) && (
        <div className="event-card__extra">
          {change.isError && <p className="field__error">{t('error.unexpected')}</p>}
          {moving && (
            <form
              className="event-card__move"
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
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  setMoving(false);
                }}
              >
                {t('composer.cancel')}
              </button>
              <button type="submit" className="button button--small button--primary">
                {t('events.save')}
              </button>
            </form>
          )}
        </div>
      )}
      <div className="event-card__foot">
        {occurrence.skipped ? (
          <p className="event-card__note">
            <Icon icon={CalendarX} /> {t('events.skippedNote')}
          </p>
        ) : (
          <>
            <Tip label={whoTip || comingText}>
              <div className="event-card__who">
                {coming.length > 0 && (
                  <span className="event-card__faces">
                    {coming.slice(0, 4).map((m) => (
                      <Avatar key={m.id} user={m} />
                    ))}
                  </span>
                )}
                <span data-testid="rsvp-coming">{comingText}</span>
              </div>
            </Tip>
            <div className="rsvp">
              <button
                type="button"
                className="rsvp__yes"
                aria-pressed={mine === 'yes'}
                onClick={() => void rsvp('yes')}
              >
                <Icon icon={Check} /> {t('events.going')}
              </button>
              <button
                type="button"
                className="rsvp__no"
                aria-pressed={mine === 'no'}
                onClick={() => void rsvp('no')}
              >
                <Icon icon={X} /> {t('events.notGoing')}
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
