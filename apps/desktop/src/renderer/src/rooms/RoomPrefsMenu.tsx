import { useT } from '../i18n.tsx';
import { Bell, BellOff } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { Popover } from '../components/Popover.tsx';
import { useRoomPrefs } from './useRoomPrefs.ts';
import { Checkbox, RadioGroup } from '../components/controls.tsx';
import { Tip } from '../components/Tip.tsx';

/**
 * How this member hears about a room (A28): mentions only (the default), every message (with or
 * without a sound), or muted; and whether a hangout starting here notifies.
 */
export function RoomPrefsMenu({ roomId }: { roomId: string }) {
  const t = useT();
  const [prefs, save] = useRoomPrefs(roomId);
  if (!prefs) return null;

  return (
    <Popover
      label={t('prefs.heading')}
      className="room-prefs__menu"
      trigger={
        <Tip label={t('prefs.heading')}>
          <button
            type="button"
            className="icon-button room-prefs__button"
            aria-label={t('prefs.heading')}
            data-testid="room-prefs"
            data-muted={prefs.notify === 'muted' ? true : undefined}
          >
            <Icon icon={prefs.notify === 'muted' ? BellOff : Bell} />
          </button>
        </Tip>
      }
    >
      {() => (
        <>
          <RadioGroup
            label={t('prefs.heading')}
            value={prefs.notify}
            onChange={(notify) => {
              save({ notify });
            }}
            options={(['mentions', 'all', 'muted'] as const).map((level) => ({
              value: level,
              label: t(`prefs.notify.${level}`),
            }))}
          />
          <Checkbox
            checked={prefs.sound}
            disabled={prefs.notify !== 'all'}
            onChange={(sound) => {
              save({ sound });
            }}
          >
            {t('prefs.sound')}
          </Checkbox>
          <Checkbox
            checked={prefs.hangoutAlerts}
            disabled={prefs.notify === 'muted'}
            onChange={(hangoutAlerts) => {
              save({ hangoutAlerts });
            }}
          >
            {t('prefs.hangoutAlerts')}
          </Checkbox>
          <p className="field__hint">{t('prefs.hint')}</p>
        </>
      )}
    </Popover>
  );
}
