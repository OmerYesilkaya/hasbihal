import { useT, formatWhen } from '../i18n.tsx';
import { nextOccurrence, useNow, type EventsView } from './useEvents.ts';
import { Calendar } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';

/**
 * The room's next event, in its header (A16): "📅 Ders · Bugün 09:00", or "şimdi" while it's on.
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
  const next = nextOccurrence(view, roomId);
  const event = next ? view.events.get(next.eventId) : undefined;
  const now = useNow();
  const running = next !== undefined && Date.parse(next.startsAt) <= now;
  return (
    <button
      type="button"
      className="event-chip"
      data-running={running ? true : undefined}
      data-testid="event-chip"
      onClick={onOpen}
    >
      <Icon icon={Calendar} />{' '}
      {event && next
        ? `${event.title} · ${
            running
              ? t('events.now')
              : formatWhen(next.startsAt, {
                  today: t('events.today'),
                  tomorrow: t('events.tomorrow'),
                })
          }`
        : t('events.heading')}
    </button>
  );
}
