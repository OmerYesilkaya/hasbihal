import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fromWall, toWall, type MessageKey } from '@hasbihal/core';
import type { RoomEvent, SaveEventRequest } from '@hasbihal/protocol';
import { REMINDER_CHOICES, type Recurrence } from '@hasbihal/protocol';
import { useChat, useChatState } from '../chat/context.tsx';
import { unwrap } from '../queries.ts';
import { useRefreshEvents } from './useEvents.ts';
import { useT } from '../i18n.tsx';
import { Checkbox, Select } from '../components/controls.tsx';

/** Date and time fields hold Istanbul wall time (A17), whatever the computer's zone. */
export function toInputs(iso: string): { date: string; time: string } {
  const wall = toWall(new Date(iso)).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

export function fromInputs({ date, time }: { date: string; time: string }): string {
  return fromWall(new Date(`${date}T${time}:00Z`)).toISOString();
}

type Repeat = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

const repeatOf = (r: Recurrence | null): Repeat =>
  !r ? 'none' : r.freq === 'weekly' ? (r.interval === 2 ? 'biweekly' : 'weekly') : r.freq;

/** Monday = 0 (as the week runs in Turkey), from a `YYYY-MM-DD` day. */
const weekdayOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Creating or editing an event (A16, admins only). */
export function EventForm({
  roomId,
  event,
  onDone,
}: {
  roomId: string;
  event: RoomEvent | null;
  onDone: () => void;
}) {
  const t = useT();
  const id = useId();
  const { client } = useChat();
  const { members, rooms } = useChatState();
  // A55: in a Mahrem room, only its list can be invited.
  const mahrem = rooms.get(roomId)?.mahremMemberIds ?? [];
  const startInputs = toInputs(event?.startsAt ?? nextHour());
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [date, setDate] = useState(startInputs.date);
  const [time, setTime] = useState(startInputs.time);
  const [duration, setDuration] = useState(event?.durationMin ?? 60);
  const [repeat, setRepeat] = useState<Repeat>(repeatOf(event?.recurrence ?? null));
  const [weekdays, setWeekdays] = useState<number[]>(event?.recurrence?.weekdays ?? []);
  const [until, setUntil] = useState(event?.recurrence?.until ?? '');
  const [reminder, setReminder] = useState(event?.reminderMin ?? 10);
  const [invitees, setInvitees] = useState<string[]>(event?.inviteeIds ?? []);
  const [error, setError] = useState<MessageKey | null>(null);
  const refreshEvents = useRefreshEvents();
  const saveEvent = useMutation({
    mutationFn: (body: SaveEventRequest) =>
      unwrap(event ? client.events.update(event.id, body) : client.events.create(body)),
    onSuccess: () => {
      refreshEvents();
      onDone();
    },
    onError: () => {
      setError('error.unexpected');
    },
  });

  const days = t('events.weekdays').split(',');
  const recurrence = (): Recurrence | null => {
    if (repeat === 'none') return null;
    const weekly = repeat === 'weekly' || repeat === 'biweekly';
    return {
      freq: weekly ? 'weekly' : repeat === 'daily' ? 'daily' : 'monthly',
      interval: repeat === 'biweekly' ? 2 : 1,
      weekdays: weekly ? (weekdays.length ? weekdays : [weekdayOf(date)]) : [],
      until: until || null,
    };
  };

  const save = () => {
    if (!title.trim() || !date || !time) {
      setError('events.incomplete');
      return;
    }
    const body: SaveEventRequest = {
      roomId,
      title,
      description: description.trim() || null,
      startsAt: fromInputs({ date, time }),
      durationMin: duration,
      recurrence: recurrence(),
      reminderMin: reminder,
      inviteeIds: invitees.filter((id) => !mahrem.length || mahrem.includes(id)),
    };
    saveEvent.mutate(body);
  };

  const people = [...members.values()]
    .filter((m) => !mahrem.length || mahrem.includes(m.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));
  return (
    <form
      className="event-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="field__label" htmlFor={`${id}-title`}>
        {t('events.title')}
      </label>
      <input
        id={`${id}-title`}
        className="field__input"
        value={title}
        maxLength={80}
        required
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <label className="field__label" htmlFor={`${id}-description`}>
        {t('events.description')}
      </label>
      <input
        id={`${id}-description`}
        className="field__input"
        value={description}
        maxLength={500}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
      />
      <div className="event-form__row">
        <label>
          <span className="field__label">{t('events.date')}</span>
          <input
            type="date"
            className="field__input"
            value={date}
            required
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="field__label">{t('events.time')}</span>
          <input
            type="time"
            className="field__input"
            value={time}
            required
            onChange={(e) => {
              setTime(e.target.value);
            }}
          />
        </label>
        <Select
          label={t('events.duration')}
          value={String(duration)}
          onChange={(value) => {
            setDuration(Number(value));
          }}
          options={DURATIONS.map((m) => ({
            value: String(m),
            label: t('events.minutes', { count: m }),
          }))}
        />
      </div>
      <div className="event-form__row">
        <Select
          label={t('events.repeat')}
          value={repeat}
          onChange={(value) => {
            setRepeat(value);
          }}
          options={REPEATS.map((r) => ({ value: r, label: t(`events.repeat.${r}`) }))}
        />
        {repeat !== 'none' && (
          <label>
            <span className="field__label">{t('events.until')}</span>
            <input
              type="date"
              className="field__input"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
              }}
            />
          </label>
        )}
        <Select
          label={t('events.reminder')}
          value={String(reminder)}
          onChange={(value) => {
            setReminder(Number(value));
          }}
          options={REMINDER_CHOICES.map((m) => ({
            value: String(m),
            label: m === 0 ? t('events.noReminder') : t('events.before', { count: m }),
          }))}
        />
      </div>
      {(repeat === 'weekly' || repeat === 'biweekly') && (
        <fieldset className="event-form__days">
          <legend className="field__label">{t('events.onDays')}</legend>
          {days.map((label, day) => {
            const on = weekdays.length ? weekdays.includes(day) : day === weekdayOf(date);
            return (
              <button
                key={label}
                type="button"
                className="chip"
                aria-pressed={on}
                onClick={() => {
                  const current = weekdays.length ? weekdays : [weekdayOf(date)];
                  setWeekdays(
                    on ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b),
                  );
                }}
              >
                {label}
              </button>
            );
          })}
        </fieldset>
      )}
      <fieldset className="event-form__invitees">
        <legend className="field__label">{t('events.invitees')}</legend>
        <p className="field__hint">
          {t(mahrem.length ? 'events.inviteesMahrem' : 'events.inviteesHint')}
        </p>
        {people.map((m) => (
          <Checkbox
            key={m.id}
            checked={invitees.includes(m.id)}
            onChange={(on) => {
              setInvitees((list) => (on ? [...list, m.id] : list.filter((x) => x !== m.id)));
            }}
          >
            {m.displayName}
          </Checkbox>
        ))}
      </fieldset>
      {error && <p className="field__error">{t(error)}</p>}
      <div className="event-form__actions">
        <button type="button" className="button" onClick={onDone}>
          {t('composer.cancel')}
        </button>
        <button type="submit" className="button button--primary" disabled={saveEvent.isPending}>
          {t('events.save')}
        </button>
      </div>
    </form>
  );
}

/** A sensible default: the next full hour. */
function nextHour(): string {
  const d = new Date(Date.now() + 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}
