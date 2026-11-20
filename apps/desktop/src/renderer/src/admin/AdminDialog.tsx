import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@hasbihal/core';
import type { OneTimeLink } from '@hasbihal/protocol';
import { type Role, type User } from '@hasbihal/protocol';
import { Avatar } from '../components/Avatar.tsx';
import { queryKeys, unwrap } from '../queries.ts';
import { useChat, useChatState } from '../chat/context.tsx';
import { formatDateTime, useT } from '../i18n.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { confirm } from '../components/confirm.tsx';
import { Select } from '../components/controls.tsx';

type Tab = 'invites' | 'members' | 'rooms';

/**
 * The admin page (A44): a separate place, only for admins, to invite people, manage members and
 * their admin rights, and manage rooms.
 */
export function AdminDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('invites');
  return (
    <Modal className="profile admin" testId="admin" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>{t('admin.heading')}</ModalTitle>
        <ModalClose className="link">{t('attachment.close')}</ModalClose>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={(['invites', 'members', 'rooms'] as const).map((value) => ({
          value,
          label: t(`admin.tab.${value}`),
        }))}
        panelClassName="profile__section admin__body"
      >
        {tab === 'invites' ? <Invites /> : tab === 'members' ? <Members /> : <Rooms />}
      </Tabs>
    </Modal>
  );
}

/** A link shown once, with a copy button: only its hash is kept on the server. */
function LinkBox({ link, hint }: { link: OneTimeLink; hint: MessageKey }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="link-box" data-testid="one-time-link">
      <code>{link.url}</code>
      <button
        type="button"
        className="button"
        onClick={() => {
          void navigator.clipboard.writeText(link.url).then(() => {
            setCopied(true);
          });
        }}
      >
        {copied ? t('admin.copied') : t('admin.copy')}
      </button>
      <p className="field__hint">{t(hint, { date: formatDateTime(link.expiresAt) })}</p>
    </div>
  );
}

function Invites() {
  const t = useT();
  const { client } = useChat();
  const { members } = useChatState();
  const [role, setRole] = useState<Role>('member');
  const [created, setCreated] = useState<OneTimeLink | null>(null);
  const queryClient = useQueryClient();
  const pending = useQuery({
    queryKey: queryKeys.invites,
    queryFn: () => unwrap(client.admin.invites()),
    select: (list) => list.invites,
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: queryKeys.invites });
  const create = useMutation({
    mutationFn: (inviteRole: Role) => unwrap(client.invites.create({ role: inviteRole })),
    onSuccess: (link) => {
      setCreated(link);
      return reload();
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => unwrap(client.admin.revokeInvite(inviteId)),
    onSuccess: reload,
  });
  const failed = [create, revoke, pending].some((state) => state.isError);

  return (
    <>
      <div className="admin__row">
        <Select
          label={t('admin.inviteRole')}
          hideLabel
          value={role}
          onChange={setRole}
          options={(['member', 'admin'] as const).map((r) => ({
            value: r,
            label: t(`admin.role.${r}`),
          }))}
        />
        <button
          type="button"
          className="button button--primary"
          disabled={create.isPending}
          onClick={() => {
            create.mutate(role);
          }}
        >
          {t('admin.createInvite')}
        </button>
      </div>
      {failed && <p className="field__error">{t('error.unexpected')}</p>}
      {created && <LinkBox link={created} hint="admin.inviteHint" />}
      <h2 className="profile__subtitle">{t('admin.pending')}</h2>
      {!pending.data ? null : pending.data.length === 0 ? (
        <p className="field__hint">{t('admin.noPending')}</p>
      ) : (
        <ul className="admin__list">
          {pending.data.map((invite) => (
            <li key={invite.id} className="admin__item">
              <span>
                {t(`admin.role.${invite.role}`)} ·{' '}
                {t('admin.createdBy', {
                  name: invite.createdBy
                    ? (members.get(invite.createdBy)?.displayName ?? '?')
                    : '—',
                })}
                <span className="field__hint">
                  {' '}
                  · {t('admin.expires', { date: formatDateTime(invite.expiresAt) })}
                </span>
              </span>
              <button
                type="button"
                className="link link--danger"
                disabled={revoke.isPending}
                onClick={() => {
                  revoke.mutate(invite.id);
                }}
              >
                {t('admin.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Members() {
  const t = useT();
  const { client } = useChat();
  const { members, me } = useChatState();
  const [recovery, setRecovery] = useState<{ user: User; link: OneTimeLink } | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const current = [...members.values()]
    .filter((m) => !m.removedAt)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'));

  const run = async (request: Promise<{ ok: boolean; error?: { code: string } }>) => {
    const result = await request;
    setError(
      result.ok ? null : result.error?.code === 'conflict' ? 'admin.lastAdmin' : 'error.unexpected',
    );
  };

  return (
    <>
      {error && <p className="field__error">{t(error)}</p>}
      {recovery && (
        <div>
          <p className="field__hint">
            {t('admin.recoveryFor', { name: recovery.user.displayName })}
          </p>
          <LinkBox link={recovery.link} hint="admin.recoveryHint" />
        </div>
      )}
      <ul className="admin__list">
        {current.map((m) => (
          <li key={m.id} className="admin__item" data-testid="admin-member">
            <span className="admin__member">
              <Avatar user={m} />
              <span>
                <strong>{m.displayName}</strong> <span className="field__hint">@{m.username}</span>
                {m.role === 'admin' && (
                  <span className="admin__badge">{t('admin.role.admin')}</span>
                )}
              </span>
            </span>
            <span className="admin__actions">
              <button
                type="button"
                className="link"
                onClick={() =>
                  void run(
                    client.admin.setRole(m.id, { role: m.role === 'admin' ? 'member' : 'admin' }),
                  )
                }
              >
                {m.role === 'admin' ? t('admin.demote') : t('admin.promote')}
              </button>
              <button
                type="button"
                className="link"
                onClick={() =>
                  void client.admin.recoveryLink(m.id).then((result) => {
                    if (result.ok) setRecovery({ user: m, link: result.value });
                    else setError('error.unexpected');
                  })
                }
              >
                {t('admin.recovery')}
              </button>
              {m.id !== me?.id && (
                <button
                  type="button"
                  className="link link--danger"
                  onClick={() =>
                    void confirm({
                      message: t('admin.removeConfirm', { name: m.displayName }),
                      action: t('admin.remove'),
                      danger: true,
                    }).then((yes) => {
                      if (yes) void run(client.admin.removeUser(m.id));
                    })
                  }
                >
                  {t('admin.remove')}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Rooms() {
  const t = useT();
  const { client } = useChat();
  const { rooms } = useChatState();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const list = [...rooms.values()].sort(
    (a, b) =>
      Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.position - b.position,
  );
  const run = (request: Promise<{ ok: boolean }>) =>
    void request.then((r) => {
      setError(r.ok ? null : 'error.unexpected');
    });

  return (
    <>
      {error && <p className="field__error">{t(error)}</p>}
      <ul className="admin__list">
        {list.map((room) => (
          <li key={room.id} className="admin__item" data-testid="admin-room">
            {renaming?.id === room.id ? (
              <form
                className="admin__row"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(
                    client.rooms.update(room.id, { name: renaming.name }).then((r) => {
                      if (r.ok) setRenaming(null);
                      return r;
                    }),
                  );
                }}
              >
                <input
                  className="field__input"
                  aria-label={t('admin.roomName')}
                  value={renaming.name}
                  maxLength={50}
                  onChange={(e) => {
                    setRenaming({ id: room.id, name: e.target.value });
                  }}
                />
                <button type="submit" className="button button--primary">
                  {t('events.save')}
                </button>
              </form>
            ) : (
              <span>
                # {room.name}
                {room.archivedAt && <span className="admin__badge">{t('admin.archived')}</span>}
              </span>
            )}
            <span className="admin__actions">
              {renaming?.id !== room.id && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setRenaming({ id: room.id, name: room.name });
                  }}
                >
                  {t('admin.rename')}
                </button>
              )}
              <button
                type="button"
                className="link"
                onClick={() => {
                  run(
                    room.archivedAt
                      ? client.rooms.unarchive(room.id)
                      : client.rooms.archive(room.id),
                  );
                }}
              >
                {room.archivedAt ? t('admin.unarchive') : t('admin.archive')}
              </button>
              <button
                type="button"
                className="link link--danger"
                onClick={() =>
                  void confirm({
                    message: t('admin.deleteRoomConfirm', { name: room.name }),
                    action: t('admin.deleteRoom'),
                    danger: true,
                  }).then((yes) => {
                    if (yes) run(client.rooms.delete(room.id));
                  })
                }
              >
                {t('admin.deleteRoom')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
