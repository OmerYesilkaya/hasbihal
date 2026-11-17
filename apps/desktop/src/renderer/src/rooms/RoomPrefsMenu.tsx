import { useId } from 'react';
import { RoomPrefs } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useChat, useChatState } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import { Bell, BellOff } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';

/**
 * How this member hears about a room (A28): mentions only (the default), every message (with or
 * without a sound), or muted; and whether a hangout starting here notifies.
 */
export function RoomPrefsMenu({ roomId }: { roomId: string }) {
  const t = useT();
  const id = useId();
  const { info, store } = useChat();
  const prefs = useChatState().rooms.get(roomId)?.prefs;
  if (!prefs) return null;

  const save = (change: Partial<RoomPrefs>) => {
    const next = { ...prefs, ...change };
    store.setRoomPrefs(roomId, next); // at once; the server tells the other devices
    void api(info.serverUrl, 'PUT', `/rooms/${roomId}/prefs`, { body: next, schema: RoomPrefs });
  };

  return (
    <details className="room-prefs">
      <summary
        className="room-prefs__button"
        aria-label={t('prefs.heading')}
        title={t('prefs.heading')}
        data-testid="room-prefs"
        data-muted={prefs.notify === 'muted' ? true : undefined}
      >
        <Icon icon={prefs.notify === 'muted' ? BellOff : Bell} />
      </summary>
      <div className="room-prefs__menu">
        <fieldset>
          <legend className="field__label">{t('prefs.heading')}</legend>
          {(['mentions', 'all', 'muted'] as const).map((level) => (
            <label key={level} className="voice-settings__check">
              <input
                type="radio"
                name={`${id}-notify`}
                checked={prefs.notify === level}
                onChange={() => {
                  save({ notify: level });
                }}
              />
              {t(`prefs.notify.${level}`)}
            </label>
          ))}
        </fieldset>
        <label className="voice-settings__check">
          <input
            type="checkbox"
            checked={prefs.sound}
            disabled={prefs.notify !== 'all'}
            onChange={(e) => {
              save({ sound: e.target.checked });
            }}
          />
          {t('prefs.sound')}
        </label>
        <label className="voice-settings__check">
          <input
            type="checkbox"
            checked={prefs.hangoutAlerts}
            disabled={prefs.notify === 'muted'}
            onChange={(e) => {
              save({ hangoutAlerts: e.target.checked });
            }}
          />
          {t('prefs.hangoutAlerts')}
        </label>
        <p className="field__hint">{t('prefs.hint')}</p>
      </div>
    </details>
  );
}
