import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useChat, useChatState } from '../chat/context.tsx';
import { confirm } from '../components/confirm.tsx';
import { Checkbox } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import { Modal, ModalClose, ModalTitle, useCloseModal } from '../components/Modal.tsx';
import { toastError } from '../components/toast.ts';
import { useT } from '../i18n.tsx';

/**
 * A room's Mahrem setting (A55): who may join its call without knocking. Anyone may turn it on,
 * with themselves on the list; after that only people on the list change it. Everyone else sees
 * the list, read-only.
 */
export function MahremDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  return (
    <Modal className="mahrem" testId="mahrem-dialog" onClose={onClose}>
      <MahremForm roomId={roomId} />
    </Modal>
  );
}

function MahremForm({ roomId }: { roomId: string }) {
  const t = useT();
  const close = useCloseModal();
  const { client, store } = useChat();
  const state = useChatState();
  const room = state.rooms.get(roomId);
  const myId = state.me?.id ?? '';
  const list = room?.mahremMemberIds ?? [];
  const isMahrem = list.length > 0;
  const onList = list.includes(myId);
  const inCall = (state.hangouts.get(roomId) ?? []).map((p) => p.userId);
  // Turning it on: me, and whoever is in the call with me.
  const [chosen, setChosen] = useState<string[]>(() =>
    isMahrem ? list : [myId, ...inCall.filter((id) => id !== myId)],
  );
  const [saving, setSaving] = useState(false);
  if (!room) return null;

  const people = [...state.members.values()].sort((a, b) =>
    a.id === myId ? -1 : b.id === myId ? 1 : a.displayName.localeCompare(b.displayName, 'tr'),
  );
  const nameOf = (id: string) =>
    id === myId ? t('mahrem.you') : (state.members.get(id)?.displayName ?? '?');
  const editable = !isMahrem || onList;
  const changed =
    chosen.length !== list.length || chosen.some((id) => !list.includes(id)) || !isMahrem;
  // Leaving the room's call because they're not chosen.
  const leaving = inCall.filter((id) => !chosen.includes(id));

  const save = async () => {
    setSaving(true);
    const result = await client.rooms.setMahrem(roomId, { memberIds: chosen });
    setSaving(false);
    if (!result.ok) {
      toastError(t(result.error.code === 'forbidden' ? 'mahrem.onlyList' : 'error.unexpected'));
      return;
    }
    store.apply({ type: 'room_updated', room: result.value }); // before the event comes back
    close();
  };

  const turnOff = async () => {
    const yes = await confirm({
      message: t('mahrem.turnOffConfirm', { room: room.name }),
      action: t('mahrem.turnOff'),
      danger: true,
    });
    if (!yes) return;
    const result = await client.rooms.clearMahrem(roomId);
    if (!result.ok) {
      toastError(t('error.unexpected'));
      return;
    }
    store.apply({ type: 'room_updated', room: result.value });
    close();
  };

  return (
    <form
      className="mahrem__form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ModalTitle className="mahrem__title">
        <Icon icon={Lock} /> {t('mahrem.title', { room: room.name })}
      </ModalTitle>
      <p className="field__hint">{t('mahrem.explain')}</p>
      {editable ? (
        <fieldset className="mahrem__people">
          <legend className="field__label">{t('mahrem.list')}</legend>
          {people.map((m) => {
            const checked = chosen.includes(m.id);
            // Turning it on, I'm on it; once on, the last one turns it off instead of leaving.
            const locked = m.id === myId && (!isMahrem || (checked && chosen.length === 1));
            return (
              <Checkbox
                key={m.id}
                checked={checked}
                disabled={locked}
                onChange={(on) => {
                  setChosen((ids) => (on ? [...ids, m.id] : ids.filter((id) => id !== m.id)));
                }}
              >
                {nameOf(m.id)}
              </Checkbox>
            );
          })}
          {isMahrem && chosen.length === 1 && chosen[0] === myId && (
            <p className="field__hint">{t('mahrem.lastOne')}</p>
          )}
        </fieldset>
      ) : (
        <>
          <p className="field__label">{t('mahrem.list')}</p>
          <ul className="mahrem__readonly" data-testid="mahrem-list">
            {list.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ul>
          <p className="field__hint">{t('mahrem.onlyList')}</p>
        </>
      )}
      {editable && leaving.length > 0 && (
        <p className="field__error">
          {t('mahrem.leavingCall', { names: leaving.map(nameOf).join(', ') })}
        </p>
      )}
      <div className="mahrem__actions">
        {isMahrem && onList && (
          <button
            type="button"
            className="button"
            data-danger
            onClick={() => void turnOff()}
            data-testid="mahrem-off"
          >
            {t('mahrem.turnOff')}
          </button>
        )}
        <span className="mahrem__spacer" />
        <ModalClose className="button" type="button">
          {editable ? t('composer.cancel') : t('mahrem.close')}
        </ModalClose>
        {editable && (
          <button
            type="submit"
            className="button button--primary"
            disabled={saving || !changed}
            data-testid="mahrem-save"
          >
            {isMahrem ? t('mahrem.save') : t('mahrem.turnOn')}
          </button>
        )}
      </div>
    </form>
  );
}
