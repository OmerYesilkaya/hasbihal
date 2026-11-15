import { z } from 'zod';
import { Id } from './id.ts';

// Accounts and sessions (ARCHITECTURE §9, DECISIONS A20, A25, A51–A53).

/** A53: lowercase a-z, 0-9, `.` and `_`, 3–20 characters. Used to sign in, never shown as a name. */
export const USERNAME_PATTERN = /^[a-z0-9._]{3,20}$/;
export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_PATTERN, 'Use 3–20 lowercase letters, digits, dots, or underscores.');

/** Free Unicode, normalized so "Ömer" typed two different ways is the same name. */
export const DisplayName = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().min(1).max(40));

/** ARCHITECTURE §9: at least 10 characters, no composition rules; the server also rejects common passwords. */
export const PASSWORD_MIN_LENGTH = 10;
export const Password = z.string().min(PASSWORD_MIN_LENGTH).max(256);

/** Server-side password checks, sent as `ValidationIssue.code`. */
export const PasswordProblem = z.enum(['password_too_common', 'password_contains_username']);
export type PasswordProblem = z.infer<typeof PasswordProblem>;

/** Shared so the sign-up form can warn before submitting. */
export function passwordContainsUsername(password: string, username: string): boolean {
  return username.length > 0 && password.toLowerCase().includes(username.toLowerCase());
}

/** Shown in the sessions list, e.g. "Ömer's MacBook". */
export const DeviceName = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().min(1).max(60));

export const Role = z.enum(['admin', 'member']);
export type Role = z.infer<typeof Role>;

export const User = z.object({
  id: Id,
  username: z.string(),
  displayName: z.string(),
  /** Index into the 8 avatar colors (A40): the initials' background when there's no photo. */
  avatarColor: z.number().int().min(0).max(7),
  /** The profile photo (`GET /files/:id`), or null for initials. */
  avatarFileId: Id.nullable(),
  role: Role,
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof User>;

export const AuthTokens = z.object({
  sessionId: Id,
  /** 15-minute JWT, sent as `Authorization: Bearer …` and in the gateway `hello`. */
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  /** Single use: every refresh returns a new one. Refresh one request at a time; reusing an old one signs the device out. */
  refreshToken: z.string(),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

/** Answer to sign-up, sign-in, and recovery. */
export const SignedIn = z.object({ user: User, tokens: AuthTokens });
export type SignedIn = z.infer<typeof SignedIn>;

export const SignUpRequest = z.object({
  inviteToken: z.string().min(1),
  username: Username,
  displayName: DisplayName,
  password: Password,
  deviceName: DeviceName,
});
export type SignUpRequest = z.input<typeof SignUpRequest>;

export const SignInRequest = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  // Not `Password`: an old password shorter than today's minimum must still get a normal "wrong password".
  password: z.string().min(1).max(256),
  deviceName: DeviceName,
});
export type SignInRequest = z.input<typeof SignInRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(1).max(200) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** What the sign-up screen shows before the form is filled in. */
export const InviteInfo = z.object({ role: Role, expiresAt: z.iso.datetime() });
export type InviteInfo = z.infer<typeof InviteInfo>;

export const CreateInviteRequest = z.object({ role: Role.default('member') });
export type CreateInviteRequest = z.input<typeof CreateInviteRequest>;

/** A single-use link: `hasbihal://invite/<token>` or `hasbihal://recover/<token>` (A51). */
export const OneTimeLink = z.object({
  token: z.string(),
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type OneTimeLink = z.infer<typeof OneTimeLink>;

export const RecoverRequest = z.object({
  recoveryToken: z.string().min(1),
  newPassword: Password,
  deviceName: DeviceName,
});
export type RecoverRequest = z.input<typeof RecoverRequest>;

export const Session = z.object({
  id: Id,
  deviceName: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session making this request. */
  current: z.boolean(),
});
export type Session = z.infer<typeof Session>;

export const SessionList = z.object({ sessions: z.array(Session) });
export type SessionList = z.infer<typeof SessionList>;

/** `hasbihal://invite/<token>` and `hasbihal://recover/<token>`. */
export const APP_URL_SCHEME = 'hasbihal';
export const inviteUrl = (token: string) => `${APP_URL_SCHEME}://invite/${token}`;
export const recoveryUrl = (token: string) => `${APP_URL_SCHEME}://recover/${token}`;

// ---- profile (A40, A41) ----------------------------------------------------------------------

export const UpdateProfileRequest = z.object({ displayName: DisplayName });
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequest>;

/** Changing the password signs out every other device. */
export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: Password,
});
export type ChangePasswordRequest = z.input<typeof ChangePasswordRequest>;

/** Profile photos up to this size are accepted; they're stored as a 256 px WebP. */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
