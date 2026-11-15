import { randomInt } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { newId } from '@hasbihal/core';
import {
  CreateInviteRequest,
  Id,
  inviteUrl,
  RecoverRequest,
  recoveryUrl,
  RefreshRequest,
  SignInRequest,
  SignUpRequest,
  type AuthTokens,
  type InviteInfo,
  type OneTimeLink,
  type Role,
  type SessionList,
  type SignedIn,
  type User,
} from '@hasbihal/protocol';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { AttemptLimiter } from './limiter.ts';
import {
  hashPassword,
  needsRehash,
  passwordProblem,
  verifyAgainstDummy,
  verifyPassword,
} from './passwords.ts';
import {
  authenticate,
  createSession,
  type AuthContext,
  refreshSession,
  revokeAllSessions,
  revokeSession,
  toUser,
} from './sessions.ts';
import { hashToken, randomToken, type SigningKeys } from './tokens.ts';
import { appendEvent } from '../gateway/events.ts';
import type { EventNotifier, SessionCloser } from '../gateway/hub.ts';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Failed sign-ins per username before a pause (ARCHITECTURE §9). */
const SIGN_IN_FAILURES = { max: 5, windowMs: 15 * 60 * 1000 };

export interface AuthDeps {
  db: Kysely<Database>;
  keys: SigningKeys;
  /** Requests per IP per minute on the unauthenticated auth routes. */
  rateLimitPerMinute: number;
  /** Ends live connections of ended sessions, and delivers the events auth writes. */
  gateway: SessionCloser & EventNotifier;
}

const invalidInvite = () =>
  new AppError(404, 'not_found', 'This invite link is invalid, used, or expired.');
const invalidRecovery = () =>
  new AppError(404, 'not_found', 'This recovery link is invalid, used, or expired.');
const wrongCredentials = () => new AppError(401, 'unauthorized', 'Wrong username or password.');

/** A new single-use invite. `createdBy` is null for the first admin's invite (A52). */
export async function createInvite(
  db: Kysely<Database>,
  role: Role,
  createdBy: string | null,
  ttlMs = INVITE_TTL_MS,
): Promise<OneTimeLink> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .insertInto('invites')
    .values({
      id: newId(),
      token_hash: hashToken(token),
      role,
      created_by: createdBy,
      expires_at: expiresAt,
    })
    .execute();
  return { token, url: inviteUrl(token), expiresAt: expiresAt.toISOString() };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}

/** Route guards for other modules: run as `preHandler`, then read `auth(request)`. */
export interface AuthGuards {
  requireAuth: preHandlerAsyncHookHandler;
  requireAdmin: preHandlerAsyncHookHandler;
  auth: (request: FastifyRequest) => AuthContext;
}

export async function registerAuth(
  app: FastifyInstance,
  { db, keys, rateLimitPerMinute, gateway }: AuthDeps,
): Promise<AuthGuards> {
  const signInFailures = new AttemptLimiter(SIGN_IN_FAILURES.max, SIGN_IN_FAILURES.windowMs);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('auth', null);
  const requireAuth: preHandlerAsyncHookHandler = async (request) => {
    request.auth = await authenticate(db, keys, request);
  };
  const requireAdmin: preHandlerAsyncHookHandler = async (request) => {
    request.auth = await authenticate(db, keys, request);
    if (request.auth.role !== 'admin')
      throw new AppError(403, 'forbidden', 'Only admins can do this.');
  };
  const auth = (request: FastifyRequest): AuthContext => {
    if (!request.auth) throw new AppError(401, 'unauthorized', 'Sign in to continue.');
    return request.auth;
  };
  const limited = { config: { rateLimit: { max: rateLimitPerMinute, timeWindow: '1 minute' } } };
  const TokenParam = z.object({ token: z.string().min(1).max(200) });

  // --- Invites -------------------------------------------------------------------------------

  app.get('/auth/invites/:token', limited, async (request): Promise<InviteInfo> => {
    const { token } = parseRequest(TokenParam, request.params, 'params');
    const invite = await db
      .selectFrom('invites')
      .select(['role', 'expires_at'])
      .where('token_hash', '=', hashToken(token))
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!invite) throw invalidInvite();
    return { role: invite.role, expiresAt: invite.expires_at.toISOString() };
  });

  app.post(
    '/invites',
    { preHandler: requireAdmin },
    async (request, reply): Promise<OneTimeLink> => {
      const { role } = parseRequest(CreateInviteRequest, request.body ?? {}, 'body');
      void reply.code(201);
      return createInvite(db, role, auth(request).userId);
    },
  );

  // --- Sign-up, sign-in, refresh, sign-out ---------------------------------------------------

  app.post('/auth/sign-up', limited, async (request, reply): Promise<SignedIn> => {
    const body = parseRequest(SignUpRequest, request.body, 'body');
    const problem = passwordProblem(body.password, body.username);
    if (problem)
      throw new AppError(400, 'validation_failed', problem.message, [
        { path: ['body', 'password'], ...problem },
      ]);
    const passwordHash = await hashPassword(body.password);

    const signedIn = await db.transaction().execute(async (trx) => {
      const invite = await trx
        .selectFrom('invites')
        .select(['id', 'role'])
        .where('token_hash', '=', hashToken(body.inviteToken))
        .where('used_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!invite) throw invalidInvite();

      const userId = newId();
      try {
        await trx
          .insertInto('users')
          .values({
            id: userId,
            username: body.username,
            display_name: body.displayName,
            avatar_color: randomInt(8),
            role: invite.role,
          })
          .execute();
      } catch (error) {
        if (isUniqueViolation(error, 'users_username_key'))
          throw new AppError(409, 'conflict', 'This username is taken.');
        throw error;
      }
      await trx
        .insertInto('credentials')
        .values({ user_id: userId, password_hash: passwordHash })
        .execute();
      await trx
        .updateTable('invites')
        .set({ used_by: userId, used_at: new Date() })
        .where('id', '=', invite.id)
        .execute();
      const user = toUser(
        await trx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', userId)
          .executeTakeFirstOrThrow(),
      );
      await appendEvent(trx, { type: 'member_joined', user });
      return { user, tokens: await createSession(trx, keys, userId, body.deviceName) };
    });
    gateway.eventsCommitted();
    void reply.code(201);
    return signedIn;
  });

  app.post('/auth/sign-in', limited, async (request): Promise<SignedIn> => {
    const body = parseRequest(SignInRequest, request.body, 'body');
    const retryAfterMs = signInFailures.retryAfterMs(body.username);
    if (retryAfterMs > 0) {
      throw new AppError(
        429,
        'rate_limited',
        `Too many failed attempts. Try again in ${Math.ceil(retryAfterMs / 60_000)} minutes.`,
      );
    }

    const row = await db
      .selectFrom('users')
      .innerJoin('credentials', 'credentials.user_id', 'users.id')
      .selectAll('users')
      .select('credentials.password_hash')
      .where('users.username', '=', body.username)
      .where('users.removed_at', 'is', null)
      .executeTakeFirst();
    const ok = row
      ? await verifyPassword(row.password_hash, body.password)
      : await verifyAgainstDummy(body.password);
    if (!row || !ok) {
      signInFailures.recordFailure(body.username);
      throw wrongCredentials();
    }
    signInFailures.reset(body.username);

    if (needsRehash(row.password_hash)) {
      await db
        .updateTable('credentials')
        .set({ password_hash: await hashPassword(body.password) })
        .where('user_id', '=', row.id)
        .execute();
    }
    return { user: toUser(row), tokens: await createSession(db, keys, row.id, body.deviceName) };
  });

  app.post('/auth/refresh', limited, async (request): Promise<AuthTokens> => {
    const { refreshToken } = parseRequest(RefreshRequest, request.body, 'body');
    return refreshSession(db, keys, refreshToken, (sessionId) => {
      gateway.closeSession(sessionId);
    });
  });

  app.post('/auth/sign-out', { preHandler: requireAuth }, async (request, reply) => {
    const { sessionId } = auth(request);
    await revokeSession(db, sessionId);
    gateway.closeSession(sessionId);
    return reply.code(204).send();
  });

  // --- Recovery (A25) ------------------------------------------------------------------------

  app.post(
    '/users/:id/recovery-link',
    { preHandler: requireAdmin },
    async (request, reply): Promise<OneTimeLink> => {
      const { id } = parseRequest(z.object({ id: Id }), request.params, 'params');
      const user = await db
        .selectFrom('users')
        .select('id')
        .where('id', '=', id)
        .where('removed_at', 'is', null)
        .executeTakeFirst();
      if (!user) throw new AppError(404, 'not_found', 'No such member.');
      const token = randomToken();
      const expiresAt = new Date(Date.now() + RECOVERY_LINK_TTL_MS);
      await db
        .insertInto('recovery_links')
        .values({
          id: newId(),
          user_id: id,
          token_hash: hashToken(token),
          created_by: auth(request).userId,
          expires_at: expiresAt,
        })
        .execute();
      void reply.code(201);
      return { token, url: recoveryUrl(token), expiresAt: expiresAt.toISOString() };
    },
  );

  app.post('/auth/recover', limited, async (request): Promise<SignedIn> => {
    const body = parseRequest(RecoverRequest, request.body, 'body');
    const signedIn = await db.transaction().execute(async (trx) => {
      const link = await trx
        .selectFrom('recovery_links')
        .innerJoin('users', 'users.id', 'recovery_links.user_id')
        .select(['recovery_links.id', 'users.id as userId', 'users.username'])
        .where('recovery_links.token_hash', '=', hashToken(body.recoveryToken))
        .where('recovery_links.used_at', 'is', null)
        .where('recovery_links.expires_at', '>', new Date())
        .where('users.removed_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!link) throw invalidRecovery();
      const problem = passwordProblem(body.newPassword, link.username);
      if (problem)
        throw new AppError(400, 'validation_failed', problem.message, [
          { path: ['body', 'newPassword'], ...problem },
        ]);

      await trx
        .updateTable('credentials')
        .set({
          password_hash: await hashPassword(body.newPassword),
          password_changed_at: new Date(),
        })
        .where('user_id', '=', link.userId)
        .execute();
      await revokeAllSessions(trx, link.userId);
      await trx
        .updateTable('recovery_links')
        .set({ used_at: new Date() })
        .where('id', '=', link.id)
        .execute();
      signInFailures.reset(link.username);
      const user = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', link.userId)
        .executeTakeFirstOrThrow();
      return {
        user: toUser(user),
        tokens: await createSession(trx, keys, link.userId, body.deviceName),
      };
    });
    // Every old session was revoked: their open connections go too (the new one isn't connected yet).
    gateway.closeUserSessions(signedIn.user.id);
    return signedIn;
  });

  // --- The signed-in user --------------------------------------------------------------------

  app.get('/me', { preHandler: requireAuth }, async (request): Promise<User> => {
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', auth(request).userId)
      .executeTakeFirstOrThrow();
    return toUser(user);
  });

  app.get('/me/sessions', { preHandler: requireAuth }, async (request): Promise<SessionList> => {
    const { userId, sessionId } = auth(request);
    const rows = await db
      .selectFrom('sessions')
      .select(['id', 'device_name', 'created_at', 'last_used_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('last_used_at', 'desc')
      .execute();
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        deviceName: s.device_name,
        createdAt: s.created_at.toISOString(),
        lastUsedAt: s.last_used_at.toISOString(),
        current: s.id === sessionId,
      })),
    };
  });

  app.delete('/me/sessions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = parseRequest(z.object({ id: Id }), request.params, 'params');
    const revoked = await db
      .updateTable('sessions')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', auth(request).userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (revoked.numUpdatedRows === 0n) throw new AppError(404, 'not_found', 'No such session.');
    gateway.closeSession(id);
    return reply.code(204).send();
  });

  return { requireAuth, requireAdmin, auth };
}
