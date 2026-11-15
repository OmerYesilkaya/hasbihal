import { useEffect, useId, useState, type SubmitEvent, type ReactNode } from 'react';
import type { MessageKey } from '@hasbihal/core';
import type { InviteInfo, User } from '@hasbihal/protocol';
import { tokenFromInput, type DeepLink } from '../../../shared/deep-link.ts';
import { Tulip } from '../components/Tulip.tsx';
import { useT } from '../i18n.tsx';
import {
  errorsFromServer,
  hasErrors,
  validateNewAccount,
  validateNewPassword,
  withoutField,
  type FieldErrors,
} from './errors.ts';

type View = 'signIn' | 'signUp' | 'recover';

interface AuthScreenProps {
  link: DeepLink | null;
  /** The session ended on its own (revoked elsewhere, expired), so say why we're here. */
  sessionEnded: boolean;
  onSignedIn: (user: User) => void;
}

const viewFor = (link: DeepLink | null): View =>
  link?.kind === 'invite' ? 'signUp' : link?.kind === 'recover' ? 'recover' : 'signIn';

/** Remounted (via `key`) for each new link, so its form starts with that link's token. */
export function AuthScreen({ link, sessionEnded, onSignedIn }: AuthScreenProps) {
  const t = useT();
  const [view, setView] = useState<View>(viewFor(link));

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <Tulip size={40} />
          <span className="auth__name">{t('app.name')}</span>
        </div>
        {sessionEnded && view === 'signIn' && (
          <p className="auth__notice">{t('auth.sessionEnded')}</p>
        )}
        {view === 'signIn' && <SignInForm onSignedIn={onSignedIn} onNavigate={setView} />}
        {view === 'signUp' && (
          <SignUpForm
            initialToken={link?.kind === 'invite' ? link.token : ''}
            onSignedIn={onSignedIn}
            onBack={() => {
              setView('signIn');
            }}
          />
        )}
        {view === 'recover' && (
          <RecoverForm
            initialToken={link?.kind === 'recover' ? link.token : ''}
            onSignedIn={onSignedIn}
            onBack={() => {
              setView('signIn');
            }}
          />
        )}
      </div>
    </main>
  );
}

function SignInForm({
  onSignedIn,
  onNavigate,
}: {
  onSignedIn: (user: User) => void;
  onNavigate: (view: View) => void;
}) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const result = await window.hasbihal.auth.signIn({ username, password });
    setBusy(false);
    if (result.ok) onSignedIn(result.value);
    else setErrors(errorsFromServer(result.error, 'signIn'));
  };

  return (
    <Form title={t('auth.signIn.title')} onSubmit={submit} error={errors.form}>
      <Field
        label={t('auth.field.username')}
        value={username}
        onChange={setUsername}
        autoComplete="username"
        autoFocus
      />
      <Field
        label={t('auth.field.password')}
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="current-password"
      />
      <button
        className="button button--primary"
        type="submit"
        disabled={busy || !username || !password}
      >
        {t('auth.signIn.submit')}
      </button>
      <div className="auth__links">
        <button
          type="button"
          className="link"
          onClick={() => {
            onNavigate('signUp');
          }}
        >
          {t('auth.signIn.toSignUp')}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            onNavigate('recover');
          }}
        >
          {t('auth.signIn.toRecover')}
        </button>
        <p className="auth__hint">{t('auth.signIn.forgotHint')}</p>
      </div>
    </Form>
  );
}

function SignUpForm({
  initialToken,
  onSignedIn,
  onBack,
}: {
  initialToken: string;
  onSignedIn: (user: User) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [invite, setInvite] = useState(initialToken);
  // The last invite checked, with its token, so a stale answer is never shown for a new one.
  const [checked, setChecked] = useState<{ token: string; info: InviteInfo } | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  // Check the invite as soon as it looks like one, so a dead link is caught before the form.
  const token = tokenFromInput(invite, 'invite');
  const inviteInfo = checked && checked.token === token ? checked.info : null;
  useEffect(() => {
    if (!token) return;
    let current = true;
    void window.hasbihal.auth.inviteInfo(token).then((result) => {
      if (!current) return;
      if (result.ok) {
        setChecked({ token, info: result.value });
        setErrors((e) => withoutField(e, 'link'));
      } else {
        setErrors((e) => ({ ...e, ...errorsFromServer(result.error, 'signUp') }));
      }
    });
    return () => {
      current = false;
    };
  }, [token]);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const local: FieldErrors = { ...validateNewAccount({ username, displayName, password }) };
    if (!token) local.link = 'error.inviteFormat';
    setErrors(local);
    if (hasErrors(local) || !token) return;
    setBusy(true);
    const result = await window.hasbihal.auth.signUp({
      inviteToken: token,
      username,
      displayName,
      password,
    });
    setBusy(false);
    if (result.ok) onSignedIn(result.value);
    else setErrors(errorsFromServer(result.error, 'signUp'));
  };

  return (
    <Form title={t('auth.signUp.title')} onSubmit={submit} error={errors.form}>
      <Field
        label={t('auth.signUp.invite')}
        value={invite}
        onChange={setInvite}
        error={errors.link}
        hint={
          inviteInfo
            ? inviteInfo.role === 'admin'
              ? 'auth.signUp.inviteAdmin'
              : 'auth.signUp.inviteMember'
            : undefined
        }
        spellCheck={false}
        autoFocus={!initialToken}
      />
      <Field
        label={t('auth.field.displayName')}
        value={displayName}
        onChange={setDisplayName}
        error={errors.displayName}
        hint="auth.field.displayNameHint"
        autoComplete="name"
        autoFocus={Boolean(initialToken)}
      />
      <Field
        label={t('auth.field.username')}
        value={username}
        onChange={setUsername}
        error={errors.username}
        hint="auth.field.usernameHint"
        autoComplete="username"
        spellCheck={false}
      />
      <Field
        label={t('auth.field.password')}
        value={password}
        onChange={setPassword}
        error={errors.password}
        hint="auth.field.passwordHint"
        type="password"
        autoComplete="new-password"
      />
      <button className="button button--primary" type="submit" disabled={busy}>
        {t('auth.signUp.submit')}
      </button>
      <div className="auth__links">
        <button type="button" className="link" onClick={onBack}>
          {t('auth.back')}
        </button>
      </div>
    </Form>
  );
}

function RecoverForm({
  initialToken,
  onSignedIn,
  onBack,
}: {
  initialToken: string;
  onSignedIn: (user: User) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [recovery, setRecovery] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = tokenFromInput(recovery, 'recover');
    const local: FieldErrors = {};
    if (!token) local.link = 'error.recoveryFormat';
    const passwordError = validateNewPassword(password);
    if (passwordError) local.password = passwordError;
    setErrors(local);
    if (hasErrors(local) || !token) return;
    setBusy(true);
    const result = await window.hasbihal.auth.recover({
      recoveryToken: token,
      newPassword: password,
    });
    setBusy(false);
    if (result.ok) onSignedIn(result.value);
    else setErrors(errorsFromServer(result.error, 'recover'));
  };

  return (
    <Form title={t('auth.recover.title')} onSubmit={submit} error={errors.form}>
      <Field
        label={t('auth.recover.link')}
        value={recovery}
        onChange={setRecovery}
        error={errors.link}
        spellCheck={false}
        autoFocus={!initialToken}
      />
      <Field
        label={t('auth.field.newPassword')}
        value={password}
        onChange={setPassword}
        error={errors.password}
        hint="auth.field.passwordHint"
        type="password"
        autoComplete="new-password"
        autoFocus={Boolean(initialToken)}
      />
      <p className="auth__hint">{t('auth.recover.hint')}</p>
      <button className="button button--primary" type="submit" disabled={busy}>
        {t('auth.recover.submit')}
      </button>
      <div className="auth__links">
        <button type="button" className="link" onClick={onBack}>
          {t('auth.back')}
        </button>
      </div>
    </Form>
  );
}

function Form({
  title,
  onSubmit,
  error,
  children,
}: {
  title: string;
  onSubmit: (e: SubmitEvent<HTMLFormElement>) => Promise<void>;
  error?: MessageKey | undefined;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <form className="auth__form" onSubmit={(e) => void onSubmit(e)} noValidate>
      <h1 className="auth__title">{title}</h1>
      {error && (
        <p className="auth__error" role="alert">
          {t(error)}
        </p>
      )}
      {children}
    </form>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: MessageKey | undefined;
  hint?: MessageKey | undefined;
  type?: 'text' | 'password';
  autoComplete?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  autoFocus,
  spellCheck,
}: FieldProps) {
  const t = useT();
  const id = useId();
  const note = error ?? hint;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type={type}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        autoComplete={autoComplete ?? 'off'}
        autoFocus={autoFocus}
        spellCheck={spellCheck ?? false}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
      />
      {note && (
        <p id={`${id}-note`} className={error ? 'field__error' : 'field__hint'}>
          {t(note)}
        </p>
      )}
    </div>
  );
}
