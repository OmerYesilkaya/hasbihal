import type { Kysely } from 'kysely';
import type { WebSocket } from 'ws';
import {
  GatewayCloseCode,
  type PresenceMode,
  type PresenceStatus,
  type ServerEvent,
  type ServerMessage,
} from '@hasbihal/protocol';
import type { Database } from '../db/schema.ts';
import { eventsAfter, logBounds, pruneEvents } from './events.ts';

const PUMP_BATCH = 500;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** One authenticated gateway connection. */
export interface Connection {
  socket: WebSocket;
  userId: string;
  sessionId: string;
  /** The computer reported 10 idle minutes (ARCHITECTURE §5.4). */
  idle: boolean;
  /** Highest seq sent on this socket; nothing at or below it is sent again. */
  lastSent: number;
  /** False until `welcome` is sent: nothing else may reach the client before it. */
  welcomed: boolean;
  /** While true, live events are buffered: the connection is still catching up from the log. */
  replaying: boolean;
  buffer: ServerEvent[];
}

/** What the auth module needs from the gateway: end connections when sessions end. */
export interface SessionCloser {
  closeSession(sessionId: string): void;
  closeUserSessions(userId: string): void;
}

/** Called after a transaction that appended events has committed. */
export interface EventNotifier {
  eventsCommitted(): void;
}

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/**
 * Fans durable events and presence out to connected clients (ARCHITECTURE §5). Events are read
 * back from the log by a single pump in `seq` order, never pushed by the request that wrote them,
 * so clients always receive them in order and without gaps.
 */
export class GatewayHub implements SessionCloser, EventNotifier {
  readonly #db: Kysely<Database>;
  readonly #connections = new Set<Connection>();
  /** Chosen mode per connected user, from `users.presence_mode`. */
  readonly #modes = new Map<string, PresenceMode>();
  /** The status last announced per user; offline users are absent. */
  readonly #announced = new Map<string, PresenceStatus>();
  #pumped = 0;
  #pumping: Promise<void> | null = null;
  #pumpAgain = false;
  #pruneTimer: ReturnType<typeof setInterval> | undefined;
  #started = false;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  /** Starts from the current end of the log, and prunes old events now and then. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    // If the database is down now, start from 0: every connection skips what it already has,
    // so that only costs one extra read of the log.
    this.#pumped = await logBounds(this.#db).then(
      (b) => b.head,
      () => 0,
    );
    this.#pruneTimer = setInterval(
      () => void pruneEvents(this.#db).catch(() => undefined),
      PRUNE_INTERVAL_MS,
    );
    this.#pruneTimer.unref();
  }

  stop(): void {
    clearInterval(this.#pruneTimer);
    for (const connection of this.#connections)
      connection.socket.close(1001, 'server shutting down');
  }

  // ---- connections ---------------------------------------------------------------------------

  add(connection: Connection, mode: PresenceMode): void {
    this.#connections.add(connection);
    this.#modes.set(connection.userId, mode);
    this.#updatePresence(connection.userId);
  }

  remove(connection: Connection): void {
    if (!this.#connections.delete(connection)) return;
    if (!this.#connectionsOf(connection.userId).length) this.#modes.delete(connection.userId);
    this.#updatePresence(connection.userId);
  }

  /** Ends replay: sends the live events that arrived meanwhile, then delivers directly. */
  finishReplay(connection: Connection): void {
    connection.replaying = false;
    for (const event of connection.buffer) this.#deliver(connection, event);
    connection.buffer = [];
  }

  closeSession(sessionId: string): void {
    for (const c of this.#connections) {
      if (c.sessionId === sessionId) c.socket.close(GatewayCloseCode.unauthorized, 'session ended');
    }
  }

  closeUserSessions(userId: string): void {
    for (const c of this.#connectionsOf(userId))
      c.socket.close(GatewayCloseCode.unauthorized, 'session ended');
  }

  // ---- presence (A21) ------------------------------------------------------------------------

  setMode(userId: string, mode: PresenceMode): void {
    if (!this.#connectionsOf(userId).length) return;
    this.#modes.set(userId, mode);
    this.#updatePresence(userId);
  }

  setIdle(connection: Connection, idle: boolean): void {
    connection.idle = idle;
    this.#updatePresence(connection.userId);
  }

  /** Everyone not offline, for a new connection's welcome. */
  presenceSnapshot(): Record<string, PresenceStatus> {
    return Object.fromEntries(this.#announced);
  }

  statusOf(userId: string): PresenceStatus {
    const connections = this.#connectionsOf(userId);
    if (!connections.length) return 'offline';
    if (this.#modes.get(userId) === 'busy') return 'busy';
    return connections.every((c) => c.idle) ? 'away' : 'available';
  }

  #updatePresence(userId: string): void {
    const status = this.statusOf(userId);
    if ((this.#announced.get(userId) ?? 'offline') === status) return;
    if (status === 'offline') this.#announced.delete(userId);
    else this.#announced.set(userId, status);
    // Not-yet-welcomed connections get this in their welcome's snapshot instead.
    for (const c of this.#connections)
      if (c.welcomed) send(c.socket, { type: 'presence', userId, status });
  }

  #connectionsOf(userId: string): Connection[] {
    return [...this.#connections].filter((c) => c.userId === userId);
  }

  // ---- durable events ------------------------------------------------------------------------

  eventsCommitted(): void {
    if (this.#pumping) {
      this.#pumpAgain = true; // the running pump will look again before it finishes
      return;
    }
    this.#pumping = this.#pump()
      .catch(() => undefined) // a failed read is retried by the next commit
      .finally(() => {
        this.#pumping = null;
      });
  }

  /** Resolves when the events committed so far have been delivered (for tests and shutdown). */
  async settled(): Promise<void> {
    while (this.#pumping) await this.#pumping;
  }

  async #pump(): Promise<void> {
    this.#pumpAgain = false;
    do {
      for (;;) {
        const batch = await eventsAfter(this.#db, this.#pumped, PUMP_BATCH);
        for (const { seq, event } of batch) {
          const message: ServerEvent = { type: 'event', seq, event };
          for (const c of this.#connections) this.#deliver(c, message);
          this.#pumped = seq;
        }
        if (batch.length < PUMP_BATCH) break;
      }
    } while (this.#takePumpAgain());
  }

  /** Whether a commit arrived while pumping (set by `eventsCommitted` during an await). */
  #takePumpAgain(): boolean {
    const again = this.#pumpAgain;
    this.#pumpAgain = false;
    return again;
  }

  #deliver(connection: Connection, message: ServerEvent): void {
    if (connection.replaying) {
      connection.buffer.push(message);
    } else if (message.seq > connection.lastSent) {
      send(connection.socket, message);
      connection.lastSent = message.seq;
    }
  }
}
