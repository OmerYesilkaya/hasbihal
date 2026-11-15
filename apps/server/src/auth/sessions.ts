import type { FastifyRequest } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { newId } from '@hasbihal/core';
import type { AuthTokens, Role, User } from '@hasbihal/protocol';
import type { Database, UsersTable } from '../db/schema.ts';
import { AppError } from '../errors.ts';
import {
  makeRefreshToken,
  parseRefreshToken,
  signAccessToken,
  verifyAccessToken,
  type SigningKeys,
} from './tokens.ts';

/** ARCHITECTURE §9: a session ends after 180 days without use. */
export const SESSION_IDLE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Who is making an authenticated request. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth`. */
    auth: AuthContext | null;
  }
}

export function toUser(row: Selectable<UsersTable>): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

/** Starts a session for a signed-in device. Pass a transaction to make it part of a larger change. */
export async function createSession(
  db: Kysely<Database>,
  keys: SigningKeys,
  userId: string,
  deviceName: string,
): Promise<AuthTokens> {
  const sessionId = newId();
  const refresh = makeRefreshToken(sessionId);
  const now = new Date();
  await db
    .insertInto('sessions')
    .values({
      id: sessionId,
      user_id: userId,
      refresh_token_hash: refresh.hash,
      device_name: deviceName,
      created_at: now,
      last_used_at: now,
      expires_at: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
    })
    .execute();
  const access = await signAccessToken(keys, { userId, sessionId }, now);
  return {
    sessionId,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
  };
}

const invalidRefresh = () =>
  new AppError(401, 'unauthorized', 'The session has ended. Sign in again.');

/**
 * Exchanges a refresh token for new tokens. The stored secret is replaced in the same statement
 * that checks it, so two concurrent refreshes can't both succeed. A token that names a live
 * session but carries an old secret was used before: it has leaked, so the session is revoked.
 */
export async function refreshSession(
  db: Kysely<Database>,
  keys: SigningKeys,
  refreshToken: string,
): Promise<AuthTokens> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) throw invalidRefresh();
  const now = new Date();
  const next = makeRefreshToken(parsed.sessionId);

  const rotated = await db
    .updateTable('sessions')
    .set({
      refresh_token_hash: next.hash,
      last_used_at: now,
      expires_at: new Date(now.getTime() + SESSION_IDLE_TTL_MS),
    })
    .where('id', '=', parsed.sessionId)
    .where('refresh_token_hash', '=', parsed.hash)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('users')
          .select('users.id')
          .whereRef('users.id', '=', 'sessions.user_id')
          .where('users.removed_at', 'is', null),
      ),
    )
    .returning('user_id')
    .executeTakeFirst();

  if (!rotated) {
    // Wrong secret for a live session: an old token was replayed. Revoke, so the thief is out too.
    await db
      .updateTable('sessions')
      .set({ revoked_at: now })
      .where('id', '=', parsed.sessionId)
      .where('revoked_at', 'is', null)
      .execute();
    throw invalidRefresh();
  }

  const access = await signAccessToken(
    keys,
    { userId: rotated.user_id, sessionId: parsed.sessionId },
    now,
  );
  return {
    sessionId: parsed.sessionId,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: next.token,
  };
}

export async function revokeSession(db: Kysely<Database>, sessionId: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

export async function revokeAllSessions(db: Kysely<Database>, userId: string): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .execute();
}

/**
 * Checks the bearer token, and that its session is still live and its user not removed. The
 * database check makes sign-out, revocation, and removal take effect at once, not after the
 * access token's 15 minutes.
 */
export async function authenticate(
  db: Kysely<Database>,
  keys: SigningKeys,
  request: FastifyRequest,
): Promise<AuthContext> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const claims = token ? await verifyAccessToken(keys, token) : undefined;
  if (!claims) throw new AppError(401, 'unauthorized', 'Sign in to continue.');

  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id as userId', 'users.role'])
    .where('sessions.id', '=', claims.sessionId)
    .where('sessions.user_id', '=', claims.userId)
    .where('sessions.revoked_at', 'is', null)
    .where('sessions.expires_at', '>', new Date())
    .where('users.removed_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw new AppError(401, 'unauthorized', 'The session has ended. Sign in again.');
  return { userId: row.userId, sessionId: claims.sessionId, role: row.role };
}
