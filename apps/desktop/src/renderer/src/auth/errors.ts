import type { MessageKey } from '@hasbihal/core';
import type { AuthError } from '../../../shared/app-info.ts';

/** The UI's own copy for a sign-in error; the server's English message is never shown. */
export function errorFor(error: AuthError): MessageKey {
  switch (error.code) {
    case 'unavailable':
      return 'error.unavailable';
    case 'rate_limited':
      return 'error.rateLimited';
    // An admin removed this account (A42).
    case 'forbidden':
      return 'error.accountRemoved';
    // The address is already linked to another Google account.
    case 'conflict':
      return 'error.googleConflict';
    case 'unauthorized':
      return 'error.googleFailed';
    default:
      return 'error.unexpected';
  }
}
