import { Bell, BellOff, Ellipsis, Star, StarOff, Trash2 } from 'lucide-react';
import { useChat, useChatState } from '../chat/context.tsx';
import { Icon } from '../components/Icon.tsx';
import { Menu, MenuItem, MenuSeparator } from '../components/Popover.tsx';
import { useT } from '../i18n.tsx';
import { useRoomPrefs } from './useRoomPrefs.ts';
import { confirm } from '../components/confirm.tsx';
import { toastError } from '../components/toast.ts';
import { Tip } from '../components/Tip.tsx';

/**
 * The "⋯" on a room in the sidebar, shown on hover: favourite and mute for everyone (both only
 * for this member), and delete for admins (A12).
 */
export function RoomMenu({ roomId, roomName }: { roomId: string; roomName: string }) {
  const t = useT();
  const { client } = useChat();
  const isAdmin = useChatState().me?.role === 'admin';
  const [prefs, save] = useRoomPrefs(roomId);
  if (!prefs) return null;
  const muted = prefs.notify === 'muted';

  const remove = async () => {
    const yes = await confirm({
      message: t('admin.deleteRoomConfirm', { name: roomName }),
      action: t('rooms.delete'),
      danger: true,
    });
    if (!yes) return;
    // The room leaves the list when the server's room_deleted arrives, here and everywhere.
    const result = await client.rooms.delete(roomId);
    if (!result.ok) toastError(t('error.unexpected'));
  };

  return (
    <Menu
      label={t('rooms.options', { name: roomName })}
      trigger={
        <Tip label={t('rooms.optionsShort')}>
          <button
            type="button"
            className="icon-button room-row__more"
            aria-label={t('rooms.options', { name: roomName })}
            data-testid="room-menu"
          >
            <Icon icon={Ellipsis} />
          </button>
        </Tip>
      }
    >
      <>
        <MenuItem
          icon={<Icon icon={prefs.favorite ? StarOff : Star} />}
          onSelect={() => {
            save({ favorite: !prefs.favorite });
          }}
        >
          {prefs.favorite ? t('rooms.unfavorite') : t('rooms.favorite')}
        </MenuItem>
        <MenuItem
          icon={<Icon icon={muted ? Bell : BellOff} />}
          onSelect={() => {
            // Unmuting goes back to the default: mentions only (A28).
            save({ notify: muted ? 'mentions' : 'muted' });
          }}
        >
          {muted ? t('rooms.unmute') : t('rooms.mute')}
        </MenuItem>
        {isAdmin && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={<Icon icon={Trash2} />}
              danger
              testId="room-delete"
              onSelect={() => void remove()}
            >
              {t('rooms.delete')}
            </MenuItem>
          </>
        )}
      </>
    </Menu>
  );
}
