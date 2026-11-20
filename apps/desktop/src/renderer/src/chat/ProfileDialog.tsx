import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { DisplayName, Password, User, AVATAR_MAX_BYTES, type Session } from '@hasbihal/protocol';
import type { MessageKey } from '@hasbihal/core';
import { Avatar } from '../components/Avatar.tsx';
import { formatDateTime, useT } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Icon } from '../components/Icon.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';

/** The profile view (A41): photo (A40), display name, password, and this member's devices. */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { me } = useChatState();

  if (!me) return null;
  return (
    <Modal className="profile" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>{t('profile.title')}</ModalTitle>
        <ModalClose className="icon-button" aria-label={t('profile.close')}>
          <Icon icon={X} />
        </ModalClose>
      </header>
      <PhotoSection me={me} />
      <NameSection me={me} />
      <PasswordSection />
      <SessionsSection />
    </Modal>
  );
}

function PhotoSection({ me }: { me: User }) {
  const t = useT();
  const { client, store } = useChat();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (
    request: Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>,
  ) => {
    setBusy(true);
    const result = await request;
    setBusy(false);
    const user = result.ok ? User.safeParse(result.value) : null;
    if (user?.success) {
      store.apply({ type: 'member_updated', user: user.data });
      setError(null);
    } else {
      setError(result.error?.code === 'unavailable' ? 'error.unavailable' : 'profile.photoInvalid');
    }
  };

  return (
    <section className="profile__section profile__photo">
      <Avatar user={me} large />
      <div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          data-testid="avatar-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > AVATAR_MAX_BYTES) {
              setError('profile.photoTooLarge');
              return;
            }
            const form = new FormData();
            form.append('file', file);
            void apply(client.me.setAvatar(form));
          }}
        />
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {me.avatarFileId ? t('profile.changePhoto') : t('profile.addPhoto')}
        </button>
        {me.avatarFileId && (
          <button
            type="button"
            className="link profile__remove"
            disabled={busy}
            onClick={() => void apply(client.me.removeAvatar())}
          >
            {t('profile.removePhoto')}
          </button>
        )}
        {error && <p className="field__error">{t(error)}</p>}
      </div>
    </section>
  );
}

function NameSection({ me }: { me: User }) {
  const t = useT();
  const id = useId();
  const { client, store } = useChat();
  const [name, setName] = useState(me.displayName);
  const [state, setState] = useState<'idle' | 'invalid' | 'failed'>('idle');

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!DisplayName.safeParse(name).success) {
      setState('invalid');
      return;
    }
    const result = await client.me.update({ displayName: name });
    if (result.ok) {
      store.apply({ type: 'member_updated', user: result.value });
      setState('idle');
      toast.success(t('profile.saved'));
    } else {
      setState('failed');
    }
  };

  return (
    <form className="profile__section" onSubmit={(e) => void save(e)}>
      <label className="field__label" htmlFor={id}>
        {t('auth.field.displayName')}
      </label>
      <div className="profile__row">
        <input
          id={id}
          className="field__input"
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value);
            setState('idle');
          }}
        />
        <button type="submit" className="button" disabled={name.trim() === me.displayName}>
          {t('profile.save')}
        </button>
      </div>
      <p className="field__hint">
        {state === 'invalid'
          ? t('error.displayNameRequired')
          : state === 'failed'
            ? t('error.unexpected')
            : `@${me.username}`}
      </p>
    </form>
  );
}

function PasswordSection() {
  const t = useT();
  const { client } = useChat();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ key: MessageKey; ok: boolean } | null>(null);

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Password.safeParse(next).success) {
      setMessage({ key: 'error.passwordTooShort', ok: false });
      return;
    }
    const result = await client.me.changePassword({ currentPassword: current, newPassword: next });
    if (result.ok) {
      setCurrent('');
      setNext('');
      setMessage({ key: 'profile.passwordChanged', ok: true });
      return;
    }
    const code = result.error.issues?.[0]?.code;
    setMessage({
      key:
        code === 'wrong_password'
          ? 'profile.wrongPassword'
          : code === 'password_too_common'
            ? 'error.passwordTooCommon'
            : code === 'password_contains_username'
              ? 'error.passwordContainsUsername'
              : 'error.unexpected',
      ok: false,
    });
  };

  return (
    <form className="profile__section" onSubmit={(e) => void save(e)}>
      <h2 className="profile__subtitle">{t('profile.password')}</h2>
      <input
        className="field__input"
        type="password"
        autoComplete="current-password"
        placeholder={t('profile.currentPassword')}
        aria-label={t('profile.currentPassword')}
        value={current}
        onChange={(e) => {
          setCurrent(e.target.value);
        }}
      />
      <input
        className="field__input"
        type="password"
        autoComplete="new-password"
        placeholder={t('auth.field.newPassword')}
        aria-label={t('auth.field.newPassword')}
        value={next}
        onChange={(e) => {
          setNext(e.target.value);
        }}
      />
      <div className="profile__row">
        <p className={message?.ok === false ? 'field__error' : 'field__hint'}>
          {message ? t(message.key) : t('profile.passwordHint')}
        </p>
        <button type="submit" className="button" disabled={!current || !next}>
          {t('profile.changePassword')}
        </button>
      </div>
    </form>
  );
}

function SessionsSection() {
  const t = useT();
  const { client } = useChat();
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    let current = true;
    void client.me.sessions().then((result) => {
      if (current && result.ok) setSessions(result.value.sessions);
    });
    return () => {
      current = false;
    };
  }, [client]);

  const revoke = async (id: string) => {
    const result = await client.me.revokeSession(id);
    if (result.ok) setSessions((list) => list?.filter((s) => s.id !== id) ?? null);
  };

  return (
    <section className="profile__section">
      <h2 className="profile__subtitle">{t('profile.devices')}</h2>
      <ul className="sessions">
        {sessions?.map((session) => (
          <li key={session.id} className="sessions__item" data-testid="session">
            <div>
              <div className="sessions__name">{session.deviceName}</div>
              <div className="field__hint">
                {session.current
                  ? t('profile.thisDevice')
                  : t('profile.lastUsed', { when: formatDateTime(session.lastUsedAt) })}
              </div>
            </div>
            {!session.current && (
              <button type="button" className="link" onClick={() => void revoke(session.id)}>
                {t('profile.signOutDevice')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
