import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { WebhookReceiver } from 'livekit-server-sdk';
import { z } from 'zod';
import {
  Id,
  NUDGE_COOLDOWN_MS,
  NudgeRequest,
  type HangoutToken,
  type NudgeResult,
} from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import type { GatewayHub } from '../gateway/hub.ts';
import { hangoutToken, trackKind, type LiveKitConfig, type LiveKitRooms } from './livekit.ts';
import type { MahremGate } from '../mahrem/gate.ts';
import type { HangoutTracker } from './tracker.ts';

/** How often the server re-reads LiveKit's state, in case a webhook went missing. */
const RECONCILE_EVERY_MS = 5 * 60 * 1000;

export interface HangoutDeps {
  db: Kysely<Database>;
  hub: GatewayHub;
  tracker: HangoutTracker;
  livekit: LiveKitConfig;
  rooms: LiveKitRooms;
  /** Mahrem rooms (A55): who may be in a call. */
  gate: MahremGate;
  guards: AuthGuards;
}

/** Hangouts (ARCHITECTURE §6): tokens to join, LiveKit webhooks, and nudges (A13, A19). */
export async function registerHangouts(app: FastifyInstance, deps: HangoutDeps): Promise<void> {
  const { db, hub, tracker, livekit, rooms, gate, guards } = deps;
  const { requireAuth, auth } = guards;

  app.post(
    '/rooms/:id/hangout/token',
    { preHandler: requireAuth },
    async (request): Promise<HangoutToken> => {
      const { id } = parseRequest(z.object({ id: Id }), request.params, 'params');
      const room = await db
        .selectFrom('rooms')
        .select('archived_at')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!room) throw new AppError(404, 'not_found', 'No such room.');
      if (room.archived_at) throw new AppError(409, 'conflict', 'This room is archived.');
      const { userId } = auth(request);
      // A55: a Mahrem room's call is for its list, and whoever they let in. Admins too knock.
      if (!(await gate.mayJoin(id, userId)))
        throw new AppError(403, 'forbidden', 'This room is Mahrem: knock to join.', [
          { path: ['params', 'id'], message: 'Mahrem.', code: 'mahrem' },
        ]);
      const user = await db
        .selectFrom('users')
        .select(['id', 'display_name'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      return {
        url: livekit.url,
        token: await hangoutToken(livekit, id, { id: user.id, displayName: user.display_name }),
      };
    },
  );

  // ---- nudges (A13, A19; ARCHITECTURE §6.4) -------------------------------------------------

  const lastNudge = new Map<string, number>();
  app.post('/nudges', { preHandler: requireAuth }, async (request): Promise<NudgeResult> => {
    const { toUserId, roomId } = parseRequest(NudgeRequest, request.body, 'body');
    const { userId } = auth(request);
    if (toUserId === userId)
      throw new AppError(400, 'validation_failed', 'You cannot nudge yourself.');
    const [recipient, room] = await Promise.all([
      db
        .selectFrom('users')
        .select('id')
        .where('id', '=', toUserId)
        .where('removed_at', 'is', null)
        .executeTakeFirst(),
      db.selectFrom('rooms').select('archived_at').where('id', '=', roomId).executeTakeFirst(),
    ]);
    if (!recipient) throw new AppError(404, 'not_found', 'No such member.');
    if (!room || room.archived_at) throw new AppError(404, 'not_found', 'No such room.');
    if (hub.isBusy(toUserId)) {
      throw new AppError(409, 'conflict', 'They are busy.', [
        { path: ['body', 'toUserId'], message: 'Busy.', code: 'recipient_busy' },
      ]);
    }
    const key = `${userId}:${toUserId}`;
    const now = Date.now();
    if (now - (lastNudge.get(key) ?? 0) < NUDGE_COOLDOWN_MS)
      throw new AppError(429, 'rate_limited', 'You nudged them a moment ago.');
    lastNudge.set(key, now);
    if (lastNudge.size > 10_000) lastNudge.clear(); // bounded, whatever happens
    return {
      delivered: hub.sendToUser(toUserId, { type: 'nudge', fromUserId: userId, roomId }) > 0,
    };
  });

  // ---- LiveKit webhooks (ARCHITECTURE §6.3) --------------------------------------------------

  const receiver = new WebhookReceiver(livekit.apiKey, livekit.apiSecret);
  await app.register((scope, _options, done) => {
    // LiveKit signs the exact body, so it must reach the receiver unparsed.
    scope.addContentTypeParser(
      'application/webhook+json',
      { parseAs: 'string' },
      (_request, body, next) => {
        next(null, body);
      },
    );
    scope.post('/hooks/livekit', async (request, reply) => {
      const event = await receiver
        .receive(String(request.body), request.headers.authorization)
        .catch(() => {
          throw new AppError(401, 'unauthorized', 'Invalid webhook signature.');
        });
      const roomId = event.room?.name ?? '';
      const userId = event.participant?.identity ?? '';
      const ours =
        Id.safeParse(roomId).success &&
        (event.event.startsWith('room_') || Id.safeParse(userId).success);
      if (ours) {
        switch (event.event) {
          case 'participant_joined':
            tracker.join(
              roomId,
              userId,
              new Date(Number(event.participant?.joinedAt ?? 0n) * 1000 || Date.now()),
            );
            // A55: a token from before the room became Mahrem must not get anyone in.
            gate.joined(roomId, userId);
            await gate.enforce(roomId, [userId]);
            break;
          case 'participant_left':
          case 'participant_connection_aborted':
            tracker.leave(roomId, userId);
            gate.left(roomId, userId);
            break;
          case 'track_published':
          case 'track_unpublished': {
            const kind = trackKind(event.track?.source);
            if (kind) tracker.setTrack(roomId, userId, kind, event.event === 'track_published');
            break;
          }
          case 'room_finished':
            tracker.clear(roomId);
            break;
        }
      }
      return reply.code(204).send();
    });
    done();
  });

  // ---- reconciliation ----------------------------------------------------------------------

  const reconcile = () =>
    rooms
      .list()
      .then(async (snapshot) => {
        tracker.reconcile(snapshot);
        // A55: anyone a lost webhook let slip into a Mahrem call.
        for (const [roomId, people] of snapshot)
          await gate.enforce(
            roomId,
            people.map((p) => p.userId),
          );
      })
      .catch((error: unknown) => {
        app.log.warn({ err: error }, 'could not reconcile hangouts with LiveKit');
      });
  void reconcile();
  const timer = setInterval(() => void reconcile(), RECONCILE_EVERY_MS);
  timer.unref();
  app.addHook('onClose', () => {
    clearInterval(timer);
  });
}
