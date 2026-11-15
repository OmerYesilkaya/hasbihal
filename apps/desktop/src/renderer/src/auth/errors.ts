import type { MessageKey } from '@hasbihal/core';
import {
  DisplayName,
  Password,
  PasswordProblem,
  passwordContainsUsername,
  Username,
} from '@hasbihal/protocol';
import type { AuthError } from '../../../shared/app-info.ts';

export type Field = 'link' | 'username' | 'displayName' | 'password' | 'form';
/** One translated message per field; `form` is for errors that belong to no single field. */
export type FieldErrors = Partial<Record<Field, MessageKey>>;

export type AuthForm = 'signIn' | 'signUp' | 'recover';

/** The UI's own copy for a server error; the server's English message is never shown. */
export function errorsFromServer(error: AuthError, form: AuthForm): FieldErrors {
  switch (error.code) {
    case 'unauthorized':
      return { form: form === 'signIn' ? 'error.wrongCredentials' : 'error.unexpected' };
    case 'conflict':
      return { username: 'error.usernameTaken' };
    case 'not_found':
      return { link: form === 'recover' ? 'error.recoveryInvalid' : 'error.inviteInvalid' };
    case 'rate_limited':
      return { form: 'error.rateLimited' };
    case 'unavailable':
      return { form: 'error.unavailable' };
    case 'validation_failed': {
      const issue = error.issues?.[0];
      const problem = PasswordProblem.safeParse(issue?.code);
      if (problem.success) {
        return {
          password:
            problem.data === 'password_too_common'
              ? 'error.passwordTooCommon'
              : 'error.passwordContainsUsername',
        };
      }
      const field = issue?.path.at(-1);
      if (field === 'username') return { username: 'error.usernameFormat' };
      if (field === 'displayName') return { displayName: 'error.displayNameRequired' };
      if (field === 'password' || field === 'newPassword')
        return { password: 'error.passwordTooShort' };
      return { form: 'error.unexpected' };
    }
    default:
      return { form: 'error.unexpected' };
  }
}

/** The checks the client can make itself, with the same schemas the server uses. */
export function validateNewAccount(values: {
  username: string;
  displayName: string;
  password: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const username = Username.safeParse(values.username);
  if (!username.success) errors.username = 'error.usernameFormat';
  if (!DisplayName.safeParse(values.displayName).success)
    errors.displayName = 'error.displayNameRequired';
  errors.password = validateNewPassword(values.password, username.success ? username.data : '');
  if (!errors.password) delete errors.password;
  return errors;
}

export function validateNewPassword(password: string, username = ''): MessageKey | undefined {
  if (!Password.safeParse(password).success) return 'error.passwordTooShort';
  if (passwordContainsUsername(password, username)) return 'error.passwordContainsUsername';
  return undefined;
}

export const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;

export function withoutField(errors: FieldErrors, field: Field): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== field));
}
