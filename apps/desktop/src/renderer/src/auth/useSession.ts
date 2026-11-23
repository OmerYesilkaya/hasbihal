import { useCallback, useEffect, useState } from 'react';
import type { User } from '@hasbihal/protocol';
import type { AuthResult } from '../../../shared/app-info.ts';

export type SessionState =
  | { kind: 'restoring' }
  /** A stored session exists but the server can't be reached; retried automatically. */
  | { kind: 'offline' }
  /** `ended`: the session ended without the user signing out (revoked elsewhere, expired). */
  | { kind: 'signedOut'; ended: boolean }
  | { kind: 'signedIn'; user: User };

const OFFLINE_RETRY_MS = 10_000;

/** What the stored session turned out to be. Offline keeps it; any other failure means signing in. */
function stateAfterRestore(result: AuthResult<User | null>): SessionState {
  if (result.ok)
    return result.value
      ? { kind: 'signedIn', user: result.value }
      : { kind: 'signedOut', ended: false };
  return result.error.code === 'unavailable'
    ? { kind: 'offline' }
    : { kind: 'signedOut', ended: false };
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ kind: 'restoring' });

  useEffect(() => {
    let current = true;
    void window.hasbihal.auth.restore().then((result) => {
      if (current) setState(stateAfterRestore(result));
    });
    return () => {
      current = false;
    };
  }, []);

  const retry = useCallback(async () => {
    setState({ kind: 'restoring' });
    setState(stateAfterRestore(await window.hasbihal.auth.restore()));
  }, []);

  useEffect(() => {
    if (state.kind !== 'offline') return;
    const timer = setTimeout(() => void retry(), OFFLINE_RETRY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state.kind, retry]);

  useEffect(
    () =>
      window.hasbihal.auth.onSessionEnded(() => {
        setState({ kind: 'signedOut', ended: true });
      }),
    [],
  );

  const signedIn = useCallback((user: User) => {
    setState({ kind: 'signedIn', user });
  }, []);

  const signOut = useCallback(async () => {
    await window.hasbihal.auth.signOut();
    setState({ kind: 'signedOut', ended: false });
  }, []);

  return { state, retry, signedIn, signOut };
}
