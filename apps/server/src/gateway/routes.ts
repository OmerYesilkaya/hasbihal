import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { RawData } from 'ws';
import {
  ClientMessage,
  GatewayCloseCode,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  isProtocolSupported,
  parseFrame,
  type ClientHello,
  type HangoutParticipant,
} from '@hasbihal/protocol';
import { authenticateToken, toUser } from '../auth/sessions.ts';
import type { SigningKeys } from '../auth/tokens.ts';
import type { Config } from '../config.ts';
import type { Database } from '../db/schema.ts';
import { eventsAfter, logBounds } from './events.ts';
import { send, type Connection, type GatewayHub } from './hub.ts';

const REPLAY_BATCH = 500;

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

export interface GatewayDeps {
  db: Kysely<Database>;
  keys: SigningKeys;
  hub: GatewayHub;
  /** Who is in which hangout, for the welcome. */
  hangouts: () => Record<string, HangoutParticipant[]>;
}

/**
 * The real-time gateway (ARCHITECTURE §5): version check (A33), authentication, catch-up from
 * the event log, live events, and presence. Revoked sessions are closed by the hub.
 */
export function registerGateway(
  app: FastifyInstance,
  config: Config,
  { db, keys, hub, hangouts }: GatewayDeps,
): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    let connection: Connection | undefined;
    let greeting = false;
    const helloTimer = setTimeout(() => {
      send(socket, { type: 'error', code: 'hello_required', message: 'Send hello first.' });
      socket.close(GatewayCloseCode.protocolViolation, 'hello timeout');
    }, config.helloTimeoutMs);

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (connection) hub.remove(connection);
    });

    const violation = (code: 'bad_message' | 'hello_required', message: string) => {
      send(socket, { type: 'error', code, message });
      socket.close(GatewayCloseCode.protocolViolation, code);
    };

    /** Authenticates, then catches the client up: replay from the log, or tell it to resync. */
    const greet = async (hello: ClientHello) => {
      if (!isProtocolSupported(hello.protocolVersion)) {
        request.log.info(
          { clientVersion: hello.clientVersion },
          'client too old or too new; asking it to upgrade',
        );
        send(socket, {
          type: 'upgrade_required',
          minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
          maxProtocolVersion: PROTOCOL_VERSION,
        });
        socket.close(GatewayCloseCode.upgradeRequired, 'upgrade required');
        return;
      }

      let auth;
      try {
        auth = await authenticateToken(db, keys, hello.accessToken);
      } catch {
        send(socket, { type: 'error', code: 'unauthorized', message: 'Sign in again.' });
        socket.close(GatewayCloseCode.unauthorized, 'unauthorized');
        return;
      }
      const user = await db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', auth.userId)
        .executeTakeFirstOrThrow();
      if (socket.readyState !== socket.OPEN) return; // gone while we were checking

      // Join first, buffering live events, so nothing committed during the replay is missed.
      const joined: Connection = {
        socket,
        userId: auth.userId,
        sessionId: auth.sessionId,
        idle: false,
        lastSent: 0,
        welcomed: false,
        replaying: true,
        buffer: [],
      };
      connection = joined;
      hub.add(joined, user.presence_mode);

      const { head, oldest } = await logBounds(db);
      const lastSeq = hello.lastSeq;
      // The gap can be replayed only if every event after lastSeq is still in the log.
      const canReplay =
        lastSeq !== undefined && lastSeq <= head && (oldest === 0 || lastSeq >= oldest - 1);
      joined.lastSent = canReplay ? lastSeq : head;

      send(socket, {
        type: 'welcome',
        serverVersion: config.serverVersion,
        protocolVersion: PROTOCOL_VERSION,
        seq: head,
        resync: lastSeq !== undefined && !canReplay,
        me: toUser(user),
        presence: hub.presenceSnapshot(),
        hangouts: hangouts(),
      });
      joined.welcomed = true;

      if (canReplay) {
        for (;;) {
          const batch = await eventsAfter(db, joined.lastSent, REPLAY_BATCH);
          for (const { seq, event } of batch) {
            send(socket, { type: 'event', seq, event });
            joined.lastSent = seq;
          }
          if (batch.length < REPLAY_BATCH) break;
        }
      }
      hub.finishReplay(joined);
    };

    socket.on('message', (data, isBinary) => {
      const message = isBinary ? undefined : parseFrame(ClientMessage, rawToString(data));
      if (!message) {
        violation('bad_message', 'Unrecognized frame.');
        return;
      }

      if (message.type === 'hello') {
        if (greeting) {
          violation('bad_message', 'Hello was already sent.');
          return;
        }
        greeting = true;
        clearTimeout(helloTimer);
        greet(message).catch((error: unknown) => {
          request.log.error({ err: error }, 'gateway hello failed');
          socket.close(1011, 'server error');
        });
        return;
      }

      // Everything else needs a completed hello.
      if (!connection) {
        if (!greeting) violation('hello_required', 'Send hello first.');
        return; // hello still being processed: ignore the early message
      }

      switch (message.type) {
        case 'ping':
          send(socket, { type: 'pong' });
          return;
        case 'activity':
          hub.setIdle(connection, message.idle);
          return;
        case 'typing': {
          const { userId } = connection;
          // Only for rooms that exist and accept messages; a bad id is dropped quietly.
          db.selectFrom('rooms')
            .select('id')
            .where('id', '=', message.roomId)
            .where('archived_at', 'is', null)
            .executeTakeFirst()
            .then((room) => {
              if (room) hub.typing(userId, room.id);
            })
            .catch((error: unknown) => {
              request.log.error({ err: error }, 'typing lookup failed');
            });
          return;
        }
        case 'set_presence': {
          const { userId } = connection;
          hub.setMode(userId, message.mode);
          db.updateTable('users')
            .set({ presence_mode: message.mode })
            .where('id', '=', userId)
            .execute()
            .catch((error: unknown) => {
              request.log.error({ err: error }, 'saving presence mode failed');
            });
          return;
        }
      }
    });
  });
}
