import { randomInt } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { z } from 'zod';
import { newId } from '@hasbihal/core';
import {
  AccessRequestRequest,
  DisplayName,
  GoogleSignInRequest,
  Id,
  RefreshRequest,
  type AuthTokens,
  type GoogleSignInResult,
  type SessionList,
  type User,
} from '@hasbihal/protocol';
import type { Database, UsersTable } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { appendEvent } from '../gateway/events.ts';
import type { EventNotifier, GatewayHub, SessionCloser } from '../gateway/hub.ts';
import type { GoogleIdentity, GoogleVerifier } from './google.ts';
import { enqueueGooglePhoto } from './google-photo.ts';
import {
  authenticate,
  createSession,
  type AuthContext,
  refreshSession,
  revokeSession,
  toUser,
} from './sessions.ts';
import type { SigningKeys } from './tokens.ts';
import { usernameCandidates } from './usernames.ts';

export interface AuthDeps {
  db: Kysely<Database>;
  keys: SigningKeys;
  /** Requests per IP per minute on the unauthenticated auth routes. */
  rateLimitPerMinute: number;
  /**
   * Ends live connections of ended sessions, delivers the events auth writes, and tells admins
   * who are online about access requests.
   */
  gateway: SessionCloser & EventNotifier & Pick<GatewayHub, 'sendToUser'>;
  /** Checks Google ID tokens; undefined when no Google client is configured (development). */
  google: GoogleVerifier | undefined;
  /** A job was queued (the Google photo): run it soon. */
  jobsQueued: () => void;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
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

const removedMember = () => new AppError(403, 'forbidden', 'This account was removed by an admin.');

/**
 * Creates the account of someone on the list (A25): their name from Google, an @handle from their
 * address, a random color until their photo arrives. Runs in the caller's transaction.
 */
async function createMember(
  trx: Transaction<Database>,
  identity: GoogleIdentity,
  role: User['role'],
): Promise<Selectable<UsersTable>> {
  const name = DisplayName.safeParse(identity.name.slice(0, 40));
  const displayName = name.success ? name.data : (identity.email.split('@')[0] ?? '?');
  let username = '';
  for (const candidate of usernameCandidates(identity.email)) {
    const taken = await trx
      .selectFrom('users')
      .select('id')
      .where('username', '=', candidate)
      .executeTakeFirst();
    if (!taken) {
      username = candidate;
      break;
    }
  }
  return trx
    .insertInto('users')
    .values({
      id: newId(),
      username,
      display_name: displayName,
      avatar_color: randomInt(8),
      role,
      email: identity.email,
      google_sub: identity.sub,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function registerAuth(
  app: FastifyInstance,
  { db, keys, rateLimitPerMinute, gateway, google, jobsQueued }: AuthDeps,
): Promise<AuthGuards> {
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

  /** Who a Google ID token belongs to; refused when it isn't a valid one for this app. */
  const verifyGoogle = async (idToken: string): Promise<GoogleIdentity> => {
    if (!google)
      throw new AppError(503, 'unavailable', 'Google sign-in is not set up on this server.');
    const identity = await google.verify(idToken);
    if (!identity) throw new AppError(401, 'unauthorized', 'Google sign-in failed.');
    return identity;
  };

  // --- Sign in with Google (A25) -------------------------------------------------------------

  /**
   * Finds the account in this order: the Google account it was linked to; else a member with
   * this address who hasn't linked one (made before Google sign-in), linked now; else an address
   * on the list, which becomes a new account. Anyone else is told they're not on the list.
   */
  app.post('/auth/google', limited, async (request): Promise<GoogleSignInResult> => {
    const body = parseRequest(GoogleSignInRequest, request.body, 'body');
    const identity = await verifyGoogle(body.idToken);

    /** What happened, and what to set going once it has committed. */
    interface Outcome {
      result: GoogleSignInResult;
      joined: boolean;
      photoQueued: boolean;
    }
    const outcome = await db.transaction().execute(async (trx): Promise<Outcome> => {
      const signIn = async (row: Selectable<UsersTable>) => {
        if (row.removed_at) throw removedMember();
        return {
          status: 'signed_in' as const,
          user: toUser(row),
          tokens: await createSession(trx, keys, row.id, body.deviceName),
        };
      };
      /** The Google photo becomes theirs unless they have one (A40). */
      const queuePhoto = async (row: Selectable<UsersTable>) => {
        if (!identity.picture || row.avatar_file_id) return false;
        await enqueueGooglePhoto(trx, row.id, identity.picture);
        return true;
      };

      const linked = await trx
        .selectFrom('users')
        .selectAll()
        .where('google_sub', '=', identity.sub)
        .executeTakeFirst();
      if (linked) return { result: await signIn(linked), joined: false, photoQueued: false };

      const existing = await trx
        .selectFrom('users')
        .selectAll()
        .where('email', '=', identity.email)
        .forUpdate()
        .executeTakeFirst();
      if (existing) {
        // The address is already linked to another Google account: Google reassigned it.
        if (existing.google_sub !== null)
          throw new AppError(409, 'conflict', 'This address belongs to another Google account.');
        if (existing.removed_at) throw removedMember();
        const row = await trx
          .updateTable('users')
          .set({ google_sub: identity.sub })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        return { result: await signIn(row), joined: false, photoQueued: await queuePhoto(row) };
      }

      const allowed = await trx
        .deleteFrom('allowed_emails')
        .where('email', '=', identity.email)
        .returning('role')
        .executeTakeFirst();
      if (!allowed) {
        const requested = await trx
          .selectFrom('access_requests')
          .select('email')
          .where('email', '=', identity.email)
          .executeTakeFirst();
        return {
          result: { status: 'not_allowed', email: identity.email, requested: !!requested },
          joined: false,
          photoQueued: false,
        };
      }

      const row = await createMember(trx, identity, allowed.role);
      await trx.deleteFrom('access_requests').where('email', '=', identity.email).execute();
      await appendEvent(trx, { type: 'member_joined', user: toUser(row) });
      return { result: await signIn(row), joined: true, photoQueued: await queuePhoto(row) };
    });

    if (outcome.joined) gateway.eventsCommitted();
    if (outcome.photoQueued) jobsQueued();
    return outcome.result;
  });

  /**
   * "Let me in" from someone not on the list, proven with their Google sign-in. Admins who are
   * online hear about it at once; the admin page lists it for the others. Asking again is fine.
   */
  app.post('/auth/access-requests', limited, async (request, reply) => {
    const { idToken } = parseRequest(AccessRequestRequest, request.body, 'body');
    const identity = await verifyGoogle(idToken);
    const name = identity.name.normalize('NFC').trim().slice(0, 80) || identity.email;

    const added = await db
      .insertInto('access_requests')
      .values({ email: identity.email, name })
      .onConflict((oc) => oc.column('email').doNothing())
      .returning('email')
      .executeTakeFirst();
    if (added) {
      const admins = await db
        .selectFrom('users')
        .select('id')
        .where('role', '=', 'admin')
        .where('removed_at', 'is', null)
        .execute();
      for (const { id } of admins)
        gateway.sendToUser(id, { type: 'access_requested', email: identity.email, name });
    }
    return reply.code(204).send();
  });

  // --- Refresh, sign-out ---------------------------------------------------------------------

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
