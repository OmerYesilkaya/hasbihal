import { useState } from 'react';
import type { MessageKey } from '@hasbihal/core';
import type { User } from '@hasbihal/protocol';
import { Tulip } from '../components/Tulip.tsx';
import { useT } from '../i18n.tsx';
import { errorFor } from './errors.ts';

type View =
  | { kind: 'start' }
  /** Google's page is open in the browser. */
  | { kind: 'waiting' }
  /** Google knows them; the list doesn't (A25). */
  | { kind: 'notAllowed'; email: string; requested: boolean };

interface AuthScreenProps {
  /** The session ended on its own (revoked elsewhere, expired), so say why we're here. */
  sessionEnded: boolean;
  onSignedIn: (user: User) => void;
}

/** Signing in (A25): one button, Google does the rest. Nothing to type, nothing to remember. */
export function AuthScreen({ sessionEnded, onSignedIn }: AuthScreenProps) {
  const t = useT();
  const [view, setView] = useState<View>({ kind: 'start' });
  const [error, setError] = useState<MessageKey | null>(null);
  const [asking, setAsking] = useState(false);

  const signIn = async () => {
    setError(null);
    setView({ kind: 'waiting' });
    const result = await window.hasbihal.auth.signInWithGoogle();
    if (!result.ok) {
      setError(errorFor(result.error));
      setView({ kind: 'start' });
      return;
    }
    const outcome = result.value;
    if (outcome.kind === 'signedIn') onSignedIn(outcome.user);
    else if (outcome.kind === 'notAllowed') setView(outcome);
    else setView({ kind: 'start' });
  };

  const requestAccess = async (email: string) => {
    setError(null);
    setAsking(true);
    const result = await window.hasbihal.auth.requestAccess();
    setAsking(false);
    if (result.ok) setView({ kind: 'notAllowed', email, requested: true });
    // An hour-old Google sign-in has expired: starting over is the fix.
    else
      setError(
        result.error.code === 'unauthorized' ? 'auth.requestExpired' : errorFor(result.error),
      );
  };

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <Tulip size={40} />
          <span className="auth__name">{t('app.name')}</span>
        </div>
        <div className="auth__form">
          {view.kind === 'notAllowed' ? (
            <>
              <h1 className="auth__title">{t('auth.notAllowed.title')}</h1>
              {error && (
                <p className="auth__error" role="alert">
                  {t(error)}
                </p>
              )}
              <p className="auth__text">{t('auth.notAllowed.body', { email: view.email })}</p>
              {view.requested ? (
                <p className="auth__notice" role="status">
                  {t('auth.notAllowed.requested')}
                </p>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={asking}
                  onClick={() => void requestAccess(view.email)}
                >
                  {t('auth.notAllowed.request')}
                </button>
              )}
              <div className="auth__links">
                <button type="button" className="link" onClick={() => void signIn()}>
                  {t(view.requested ? 'auth.notAllowed.tryAgain' : 'auth.notAllowed.otherAccount')}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="auth__title">{t('auth.signIn.title')}</h1>
              {sessionEnded && !error && <p className="auth__notice">{t('auth.sessionEnded')}</p>}
              {error && (
                <p className="auth__error" role="alert">
                  {t(error)}
                </p>
              )}
              <button
                type="button"
                className="button google-button"
                disabled={view.kind === 'waiting'}
                onClick={() => void signIn()}
              >
                <GoogleLogo />
                {t('auth.signIn.google')}
              </button>
              {view.kind === 'waiting' ? (
                <div className="auth__links">
                  <p className="auth__hint" role="status">
                    {t('auth.signIn.waiting')}
                  </p>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      window.hasbihal.auth.cancelGoogleSignIn();
                    }}
                  >
                    {t('auth.signIn.cancel')}
                  </button>
                </div>
              ) : (
                <p className="auth__hint">{t('auth.signIn.hint')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

/** Google's "G", as its sign-in branding asks for on a "Sign in with Google" button. */
function GoogleLogo() {
  return (
    <svg className="google-button__logo" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
