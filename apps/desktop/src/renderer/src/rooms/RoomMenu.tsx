import { Bell, BellOff, Ellipsis, Star, StarOff, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { useChat, useChatState } from '../chat/context.tsx';
import { Icon } from '../components/Icon.tsx';
import { MenuItem, Popover } from '../components/Popover.tsx';
import { useT } from '../i18n.tsx';
import { useRoomPrefs } from './useRoomPrefs.ts';

/**
 * The "⋯" on a room in the sidebar, shown on hover: favourite and mute for everyone (both only
 * for this member), and delete for admins (A12).
 */
export function RoomMenu({ roomId, roomName }: { roomId: string; roomName: string }) {
  const t = useT();
  const { info } = useChat();
  const isAdmin = useChatState().me?.role === 'admin';
  const [prefs, save] = useRoomPrefs(roomId);
  if (!prefs) return null;
  const muted = prefs.notify === 'muted';

  const remove = async () => {
    if (!window.confirm(t('admin.deleteRoomConfirm', { name: roomName }))) return;
    // The room leaves the list when the server's room_deleted arrives, here and everywhere.
    const result = await api(info.serverUrl, 'DELETE', `/rooms/${roomId}`);
    if (!result.ok) window.alert(t('error.unexpected'));
  };

  return (
    <Popover
      label={t('rooms.options', { name: roomName })}
      role="menu"
      trigger={(props) => (
        <button
          type="button"
          className="icon-button room-row__more"
          aria-label={t('rooms.options', { name: roomName })}
          title={t('rooms.optionsShort')}
          data-testid="room-menu"
          {...props}
        >
          <Icon icon={Ellipsis} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon={<Icon icon={prefs.favorite ? StarOff : Star} />}
            close={close}
            onSelect={() => {
              save({ favorite: !prefs.favorite });
            }}
          >
            {prefs.favorite ? t('rooms.unfavorite') : t('rooms.favorite')}
          </MenuItem>
          <MenuItem
            icon={<Icon icon={muted ? Bell : BellOff} />}
            close={close}
            onSelect={() => {
              // Unmuting goes back to the default: mentions only (A28).
              save({ notify: muted ? 'mentions' : 'muted' });
            }}
          >
            {muted ? t('rooms.unmute') : t('rooms.mute')}
          </MenuItem>
          {isAdmin && (
            <>
              <hr className="menu-separator" />
              <MenuItem
                icon={<Icon icon={Trash2} />}
                danger
                close={close}
                testId="room-delete"
                onSelect={() => void remove()}
              >
                {t('rooms.delete')}
              </MenuItem>
            </>
          )}
        </>
      )}
    </Popover>
  );
}
