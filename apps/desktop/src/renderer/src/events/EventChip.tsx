import { formatWhen, relativeDay, toUpper, useT } from '../i18n.tsx';
import { useChatState } from '../chat/context.tsx';
import { nextOccurrence, useNow, type EventsView } from './useEvents.ts';
import { Calendar } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';

/**
 * The room's next event, in its header (A16): a coloured "when" (teal while it's on, red when
 * it's today, gold later), then its title, and a gold dot if you're invited and haven't
 * answered. With nothing coming up (admins only see it then), just "Etkinlikler".
 * Opens the room's events.
 */
export function EventChip({
  view,
  roomId,
  onOpen,
}: {
  view: EventsView;
  roomId: string;
  onOpen: () => void;
}) {
  const t = useT();
  const { me } = useChatState();
  const next = nextOccurrence(view, roomId);
  const event = next ? view.events.get(next.eventId) : undefined;
  const now = useNow();

  if (!event || !next) {
    return (
      <button
        type="button"
        className="event-chip"
        data-empty
        data-testid="event-chip"
        onClick={onOpen}
      >
        <Icon icon={Calendar} /> {t('events.heading')}
      </button>
    );
  }

  const running = Date.parse(next.startsAt) <= now;
  const today = relativeDay(next.startsAt) === 'today';
  const when = running
    ? toUpper(t('events.now'))
    : formatWhen(next.startsAt, { today: t('events.today'), tomorrow: t('events.tomorrow') });
  const ask =
    me !== null && event.inviteeIds.includes(me.id) && !next.rsvps.some((r) => r.userId === me.id);
  return (
    <button
      type="button"
      className="event-chip"
      data-running={running ? true : undefined}
      data-soon={today ? true : undefined}
      data-testid="event-chip"
      aria-label={`${event.title} · ${running ? t('events.now') : when}`}
      title={`${event.title} · ${running ? t('events.now') : when}`}
      onClick={onOpen}
    >
      <span className="event-chip__when">
        {running && <span className="event-chip__live" aria-hidden />}
        {when}
      </span>
      <span className="event-chip__title">{event.title}</span>
      {ask && <span className="event-chip__ask" aria-hidden />}
    </button>
  );
}
