import { useEffect, useState } from 'react';
import type { MessageKey } from '@hasbihal/core';
import {
  InviteList,
  OneTimeLink,
  type PendingInvite,
  type Role,
  type User,
} from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
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
  const { info } = useChat();
  const { members } = useChatState();
  const [role, setRole] = useState<Role>('member');
  const [created, setCreated] = useState<OneTimeLink | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [error, setError] = useState<MessageKey | null>(null);

  // Reloaded after each change.
  const [revision, setRevision] = useState(0);
  const reload = () => {
    setRevision((n) => n + 1);
  };
  useEffect(() => {
    let current = true;
    void api(info.serverUrl, 'GET', '/admin/invites', { schema: InviteList }).then((result) => {
      if (current && result.ok && result.value) setPending(result.value.invites);
    });
    return () => {
      current = false;
    };
  }, [info.serverUrl, revision]);

  const create = async () => {
    const result = await api(info.serverUrl, 'POST', '/invites', {
      body: { role },
      schema: OneTimeLink,
    });
    if (!result.ok || !result.value) {
      setError('error.unexpected');
      return;
    }
    setError(null);
    setCreated(result.value);
    reload();
  };

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
        <button type="button" className="button button--primary" onClick={() => void create()}>
          {t('admin.createInvite')}
        </button>
      </div>
      {error && <p className="field__error">{t(error)}</p>}
      {created && <LinkBox link={created} hint="admin.inviteHint" />}
      <h2 className="profile__subtitle">{t('admin.pending')}</h2>
      {pending.length === 0 ? (
        <p className="field__hint">{t('admin.noPending')}</p>
      ) : (
        <ul className="admin__list">
          {pending.map((invite) => (
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
                onClick={() =>
                  void api(info.serverUrl, 'DELETE', `/admin/invites/${invite.id}`).then(reload)
                }
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
  const { info } = useChat();
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
                    api(info.serverUrl, 'PUT', `/admin/users/${m.id}/role`, {
                      body: { role: m.role === 'admin' ? 'member' : 'admin' },
                    }),
                  )
                }
              >
                {m.role === 'admin' ? t('admin.demote') : t('admin.promote')}
              </button>
              <button
                type="button"
                className="link"
                onClick={() =>
                  void api(info.serverUrl, 'POST', `/users/${m.id}/recovery-link`, {
                    schema: OneTimeLink,
                  }).then((result) => {
                    if (result.ok && result.value) setRecovery({ user: m, link: result.value });
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
                      if (yes) void run(api(info.serverUrl, 'POST', `/admin/users/${m.id}/remove`));
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
  const { info } = useChat();
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
                    api(info.serverUrl, 'PATCH', `/rooms/${room.id}`, {
                      body: { name: renaming.name },
                    }).then((r) => {
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
                    api(
                      info.serverUrl,
                      'POST',
                      `/rooms/${room.id}/${room.archivedAt ? 'unarchive' : 'archive'}`,
                    ),
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
                    if (yes) run(api(info.serverUrl, 'DELETE', `/rooms/${room.id}`));
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
