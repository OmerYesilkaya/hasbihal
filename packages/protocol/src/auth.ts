import { z } from 'zod';
import { Id } from './id.ts';

// Accounts and sessions (ARCHITECTURE §9, DECISIONS A20, A25, A53).

/**
 * A53: lowercase a-z, 0-9, `.` and `_`, 3–20 characters. The handle in `@mentions`, never shown
 * as a name. Made from the Google address when an account is created (A25).
 */
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

/** A Google account's address, lowercased: how admins let someone in (A25). */
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

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
  /** Removed by an admin: their messages stay under their name (A42), they can't sign in. */
  removedAt: z.iso.datetime().nullable(),
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

export const SignedIn = z.object({ user: User, tokens: AuthTokens });
export type SignedIn = z.infer<typeof SignedIn>;

/** A Google ID token is a JWT of about 1 KB; this leaves room without inviting abuse. */
const IdToken = z.string().min(1).max(8192);

/** `POST /auth/google`: the ID token the app got from Google's sign-in page (A25). */
export const GoogleSignInRequest = z.object({ idToken: IdToken, deviceName: DeviceName });
export type GoogleSignInRequest = z.input<typeof GoogleSignInRequest>;

/**
 * The answer to a Google sign-in. `not_allowed` is an ordinary outcome, not an error: the address
 * isn't on the list, and the app offers to ask an admin (`requested` once it has).
 */
export const GoogleSignInResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signed_in'), user: User, tokens: AuthTokens }),
  z.object({ status: z.literal('not_allowed'), email: z.string(), requested: z.boolean() }),
]);
export type GoogleSignInResult = z.infer<typeof GoogleSignInResult>;

/** `POST /auth/access-requests`: "let me in", proven with the same ID token. */
export const AccessRequestRequest = z.object({ idToken: IdToken });
export type AccessRequestRequest = z.infer<typeof AccessRequestRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(1).max(200) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const ChangeRoleRequest = z.object({ role: Role });
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequest>;

// ---- who may join (A20, A25, A44) ------------------------------------------------------------

/** An address an admin let in, whose owner hasn't signed in yet. */
export const AllowedEmail = z.object({
  email: z.string(),
  role: Role,
  addedBy: Id.nullable(),
  addedAt: z.iso.datetime(),
});
export type AllowedEmail = z.infer<typeof AllowedEmail>;

/** Someone not on the list who asked to join. */
export const AccessRequest = z.object({
  email: z.string(),
  name: z.string(),
  requestedAt: z.iso.datetime(),
});
export type AccessRequest = z.infer<typeof AccessRequest>;

/** `GET /admin/access`: the admin page's "who may join" view. */
export const AccessList = z.object({
  allowed: z.array(AllowedEmail),
  requests: z.array(AccessRequest),
  /** Each member's Google address; null until they first sign in with Google. */
  memberEmails: z.record(Id, z.string().nullable()),
});
export type AccessList = z.infer<typeof AccessList>;

export const AllowEmailRequest = z.object({ email: Email, role: Role.default('member') });
export type AllowEmailRequest = z.input<typeof AllowEmailRequest>;

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

// ---- profile (A40, A41) ----------------------------------------------------------------------

export const UpdateProfileRequest = z.object({ displayName: DisplayName });
export type UpdateProfileRequest = z.input<typeof UpdateProfileRequest>;

/** Profile photos up to this size are accepted; they're stored as a 256 px WebP. */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
