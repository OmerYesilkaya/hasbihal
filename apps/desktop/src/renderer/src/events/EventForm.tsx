import { useId, useState } from 'react';
import { fromWall, toWall, type MessageKey } from '@hasbihal/core';
import { REMINDER_CHOICES, RoomEvent, type Recurrence } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useChat, useChatState } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';

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
  const { info } = useChat();
  const { members } = useChatState();
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
  const [saving, setSaving] = useState(false);

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

  const save = async () => {
    if (!title.trim() || !date || !time) {
      setError('events.incomplete');
      return;
    }
    setSaving(true);
    const body = {
      roomId,
      title,
      description: description.trim() || null,
      startsAt: fromInputs({ date, time }),
      durationMin: duration,
      recurrence: recurrence(),
      reminderMin: reminder,
      inviteeIds: invitees,
    };
    const result = await api(
      info.serverUrl,
      event ? 'PUT' : 'POST',
      event ? `/events/${event.id}` : '/events',
      { body, schema: RoomEvent },
    );
    setSaving(false);
    if (result.ok) onDone();
    else setError('error.unexpected');
  };

  const people = [...members.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'tr'),
  );
  return (
    <form
      className="event-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
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
        <label>
          <span className="field__label">{t('events.duration')}</span>
          <select
            className="field__input"
            value={duration}
            onChange={(e) => {
              setDuration(Number(e.target.value));
            }}
          >
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {t('events.minutes', { count: m })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="event-form__row">
        <label>
          <span className="field__label">{t('events.repeat')}</span>
          <select
            className="field__input"
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value as Repeat);
            }}
          >
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {t(`events.repeat.${r}`)}
              </option>
            ))}
          </select>
        </label>
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
        <label>
          <span className="field__label">{t('events.reminder')}</span>
          <select
            className="field__input"
            value={reminder}
            onChange={(e) => {
              setReminder(Number(e.target.value));
            }}
          >
            {REMINDER_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('events.noReminder') : t('events.before', { count: m })}
              </option>
            ))}
          </select>
        </label>
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
        <p className="field__hint">{t('events.inviteesHint')}</p>
        {people.map((m) => (
          <label key={m.id} className="voice-settings__check">
            <input
              type="checkbox"
              checked={invitees.includes(m.id)}
              onChange={(e) => {
                setInvitees((list) =>
                  e.target.checked ? [...list, m.id] : list.filter((x) => x !== m.id),
                );
              }}
            />
            {m.displayName}
          </label>
        ))}
      </fieldset>
      {error && <p className="field__error">{t(error)}</p>}
      <div className="event-form__actions">
        <button type="button" className="button" onClick={onDone}>
          {t('composer.cancel')}
        </button>
        <button type="submit" className="button button--primary" disabled={saving}>
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
