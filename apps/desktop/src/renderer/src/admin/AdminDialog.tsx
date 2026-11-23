import { useState, type SubmitEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageKey } from '@hasbihal/core';
import { Email, type Role } from '@hasbihal/protocol';
import { Avatar } from '../components/Avatar.tsx';
import { ApiFailure, queryKeys, unwrap } from '../queries.ts';
import { useChat, useChatState } from '../chat/context.tsx';
import { formatDateTime, useT } from '../i18n.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { confirm } from '../components/confirm.tsx';
import { Select } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import { Shield } from 'lucide-react';

type Tab = 'access' | 'members' | 'rooms';

/**
 * The admin page (A44): a separate place, only for admins, to say who may join (A25), manage
 * members and their admin rights, and manage rooms.
 */
export function AdminDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('access');
  const requests = useAccessList().data?.requests.length ?? 0;
  return (
    <Modal className="profile admin" testId="admin" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>{t('admin.heading')}</ModalTitle>
        <ModalClose className="link">{t('attachment.close')}</ModalClose>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={(['access', 'members', 'rooms'] as const).map((value) => ({
          value,
          label:
            value === 'access' && requests > 0
              ? `${t('admin.tab.access')} (${String(requests)})`
              : t(`admin.tab.${value}`),
        }))}
        panelClassName="profile__section admin__body"
      >
        {tab === 'access' ? <Access /> : tab === 'members' ? <Members /> : <Rooms />}
      </Tabs>
    </Modal>
  );
}

/** The sidebar's way in, with the number of people waiting to be let in (A25). */
export function AdminButton({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const waiting = useAccessList().data?.requests.length ?? 0;
  return (
    <button type="button" className="sidebar__admin" onClick={onOpen}>
      <Icon icon={Shield} /> {t('admin.heading')}
      {waiting > 0 && (
        <span className="badge" data-mention aria-label={t('admin.waiting', { count: waiting })}>
          {waiting}
        </span>
      )}
    </button>
  );
}

/**
 * Who may join (A25): the list, and the requests. Shared with the sidebar's badge, which the
 * shell refreshes when a request arrives.
 */
export function useAccessList(enabled = true) {
  const { client } = useChat();
  return useQuery({
    queryKey: queryKeys.access,
    queryFn: () => unwrap(client.admin.access()),
    enabled,
  });
}

function Access() {
  const t = useT();
  const { client } = useChat();
  const { members } = useChatState();
  const queryClient = useQueryClient();
  const access = useAccessList();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [error, setError] = useState<MessageKey | null>(null);
  const reload = () => queryClient.invalidateQueries({ queryKey: queryKeys.access });
  const allow = useMutation({
    mutationFn: (body: { email: string; role: Role }) => unwrap(client.admin.allowEmail(body)),
    onSuccess: () => {
      setEmail('');
      setError(null);
      return reload();
    },
    onError: (e: unknown) => {
      const conflict = e instanceof ApiFailure && e.error.code === 'conflict';
      setError(conflict ? 'admin.alreadyMember' : 'error.unexpected');
    },
  });
  const remove = useMutation({
    mutationFn: (address: string) => unwrap(client.admin.removeAllowedEmail(address)),
    onSuccess: reload,
  });
  const dismiss = useMutation({
    mutationFn: (address: string) => unwrap(client.admin.dismissRequest(address)),
    onSuccess: reload,
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Email.safeParse(email);
    if (!parsed.success) {
      setError('admin.emailFormat');
      return;
    }
    allow.mutate({ email: parsed.data, role });
  };
  const nameOf = (id: string | null) => (id ? (members.get(id)?.displayName ?? '?') : '—');

  return (
    <>
      {access.data && access.data.requests.length > 0 && (
        <>
          <h2 className="profile__subtitle">{t('admin.requests')}</h2>
          <ul className="admin__list">
            {access.data.requests.map((r) => (
              <li key={r.email} className="admin__item" data-testid="access-request">
                <span>
                  <strong>{r.name}</strong> <span className="field__hint">{r.email}</span>
                  <span className="field__hint"> · {formatDateTime(r.requestedAt)}</span>
                </span>
                <span className="admin__actions">
                  <button
                    type="button"
                    className="link"
                    disabled={allow.isPending}
                    onClick={() => {
                      allow.mutate({ email: r.email, role: 'member' });
                    }}
                  >
                    {t('admin.letIn')}
                  </button>
                  <button
                    type="button"
                    className="link link--danger"
                    disabled={dismiss.isPending}
                    onClick={() => {
                      dismiss.mutate(r.email);
                    }}
                  >
                    {t('admin.dismiss')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="profile__subtitle">{t('admin.allow')}</h2>
      <form className="admin__row" onSubmit={submit} noValidate>
        <input
          className="field__input"
          type="email"
          aria-label={t('admin.emailLabel')}
          placeholder={t('admin.emailPlaceholder')}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
        />
        <Select
          label={t('admin.newRole')}
          hideLabel
          value={role}
          onChange={setRole}
          options={(['member', 'admin'] as const).map((r) => ({
            value: r,
            label: t(`admin.role.${r}`),
          }))}
        />
        <button
          type="submit"
          className="button button--primary"
          disabled={allow.isPending || !email.trim()}
        >
          {t('admin.add')}
        </button>
      </form>
      {error ? (
        <p className="field__error">{t(error)}</p>
      ) : (
        <p className="field__hint">{t('admin.allowHint')}</p>
      )}

      <h2 className="profile__subtitle">{t('admin.pending')}</h2>
      {!access.data ? null : access.data.allowed.length === 0 ? (
        <p className="field__hint">{t('admin.noPending')}</p>
      ) : (
        <ul className="admin__list">
          {access.data.allowed.map((a) => (
            <li key={a.email} className="admin__item" data-testid="allowed-email">
              <span>
                {a.email}
                {a.role === 'admin' && (
                  <span className="admin__badge">{t('admin.role.admin')}</span>
                )}
                <span className="field__hint">
                  {' '}
                  · {t('admin.addedBy', { name: nameOf(a.addedBy) })}
                </span>
              </span>
              <button
                type="button"
                className="link link--danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(a.email);
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
  const emails = useAccessList().data?.memberEmails;
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
      <ul className="admin__list">
        {current.map((m) => (
          <li key={m.id} className="admin__item" data-testid="admin-member">
            <span className="admin__member">
              <Avatar user={m} />
              <span>
                <strong>{m.displayName}</strong>{' '}
                <span className="field__hint">
                  {emails?.[m.id] ?? (emails ? t('admin.noEmail') : `@${m.username}`)}
                </span>
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
