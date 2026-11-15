import {
  GatewayCloseCode,
  PROTOCOL_VERSION,
  ServerMessage,
  parseFrame,
  type ClientMessage,
  type DurableEvent,
  type PresenceMode,
  type PresenceStatus,
  type ServerWelcome,
} from '@hasbihal/protocol';
import { DEFAULT_BACKOFF, reconnectDelay, type BackoffOptions } from './backoff.ts';

export type GatewayStatus =
  | { kind: 'connecting'; attempt: number }
  | { kind: 'connected'; serverVersion: string }
  | { kind: 'disconnected'; retryInMs: number }
  | { kind: 'upgrade_required' }
  /** No access token could be had: the session has ended. */
  | { kind: 'signed_out' }
  | { kind: 'stopped' };

/**
 * Event-handler type that accepts handlers for richer event types, so the DOM
 * WebSocket (whose handlers take Event/MessageEvent/CloseEvent) satisfies SocketLike.
 */
type Handler<E> = { bivarianceHack(event: E): void }['bivarianceHack'];

/** The subset of the WebSocket API the client needs; lets tests supply a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: Handler<unknown> | null;
  onmessage: Handler<{ data: unknown }> | null;
  onclose: Handler<{ code: number }> | null;
  onerror: Handler<unknown> | null;
}

export interface GatewayClientOptions {
  /** WebSocket URL, e.g. wss://hasbihal.duckdns.org/ws */
  url: string;
  clientVersion: string;
  createSocket: (url: string) => SocketLike;
  /**
   * An access token for each hello, or null when the session has ended. `refresh` is true after
   * the server rejected the last one: get a new one rather than a cached copy.
   */
  getAccessToken: (options: { refresh: boolean }) => Promise<string | null>;
  onStatus: (status: GatewayStatus) => void;
  /**
   * After each (re)connect. With `welcome.resync` (or on the first connect), reload state over
   * HTTP; the events that follow are newer than it.
   */
  onWelcome?: (welcome: ServerWelcome) => void;
  /** Durable events in `seq` order. Apply idempotently: one may repeat around a reconnect. */
  onEvent?: (event: DurableEvent, seq: number) => void;
  onPresence?: (userId: string, status: PresenceStatus) => void;
  /** Someone else is typing in a room (ephemeral). */
  onTyping?: (roomId: string, userId: string) => void;
  /** This member's read marker moved, possibly on another device. */
  onReadState?: (roomId: string, lastReadMessageId: string) => void;
  backoff?: BackoffOptions;
  pingIntervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

/**
 * Keeps one gateway connection alive (ARCHITECTURE §5.1): authenticates each hello with a fresh
 * access token, resumes from the last event it applied, reconnects with backoff, pings to detect
 * dead links, and stops for good when the server says this client is too old (DECISIONS A33).
 */
export class GatewayClient {
  private socket: SocketLike | undefined;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: unknown;
  private pingTimer: unknown;
  /** Last durable event applied; sent in hello so the server replays only what was missed. */
  private lastSeq: number | undefined;
  private welcomed = false;
  private idle = false;
  /** The server rejected the last token: the next hello needs a refreshed one. */
  private tokenRejected = false;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly options: GatewayClientOptions;

  constructor(options: GatewayClientOptions) {
    this.options = options;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.halt({ kind: 'stopped' });
  }

  /** Müsait or Meşgul; the server remembers it. */
  setPresence(mode: PresenceMode): void {
    this.send({ type: 'set_presence', mode });
  }

  /** The user is typing in a room; call at most every few seconds. */
  typing(roomId: string): void {
    if (this.welcomed) this.send({ type: 'typing', roomId });
  }

  /** The computer went idle or came back. Re-sent after every reconnect. */
  setIdle(idle: boolean): void {
    if (this.idle === idle) return;
    this.idle = idle;
    if (this.welcomed) this.send({ type: 'activity', idle });
  }

  private halt(status: GatewayStatus): void {
    this.stopped = true;
    this.welcomed = false;
    this.clearTimer(this.reconnectTimer);
    this.clearTimer(this.pingTimer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, 'client stopped');
    this.options.onStatus(status);
  }

  private connect(): void {
    this.options.onStatus({ kind: 'connecting', attempt: this.attempt });
    const socket = this.options.createSocket(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      const refresh = this.tokenRejected;
      this.tokenRejected = false;
      void this.options.getAccessToken({ refresh }).then(
        (accessToken) => {
          if (this.socket !== socket) return; // closed or replaced meanwhile
          if (accessToken === null) {
            this.halt({ kind: 'signed_out' });
            return;
          }
          this.send({
            type: 'hello',
            protocolVersion: PROTOCOL_VERSION,
            clientVersion: this.options.clientVersion,
            accessToken,
            ...(this.lastSeq === undefined ? {} : { lastSeq: this.lastSeq }),
          });
        },
        () => {
          // Couldn't get a token right now (e.g. offline): retry like any failed connection.
          if (this.socket === socket) socket.close(4000, 'no token');
        },
      );
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      const message = parseFrame(ServerMessage, event.data);
      if (!message) return;
      switch (message.type) {
        case 'welcome':
          this.attempt = 0;
          this.welcomed = true;
          // A fresh start or a resync continues from the server's position; a replay follows otherwise.
          if (this.lastSeq === undefined || message.resync) this.lastSeq = message.seq;
          this.options.onStatus({ kind: 'connected', serverVersion: message.serverVersion });
          this.options.onWelcome?.(message);
          if (this.idle) this.send({ type: 'activity', idle: true });
          this.schedulePing();
          return;
        case 'event':
          if (this.lastSeq !== undefined && message.seq <= this.lastSeq) return; // already applied
          this.lastSeq = message.seq;
          this.options.onEvent?.(message.event, message.seq);
          return;
        case 'presence':
          this.options.onPresence?.(message.userId, message.status);
          return;
        case 'typing':
          this.options.onTyping?.(message.roomId, message.userId);
          return;
        case 'read_state':
          this.options.onReadState?.(message.roomId, message.lastReadMessageId);
          return;
        case 'upgrade_required':
          this.halt({ kind: 'upgrade_required' });
          return;
        case 'pong':
        case 'error':
          return;
      }
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.welcomed = false;
      this.clearTimer(this.pingTimer);
      if (event.code === GatewayCloseCode.upgradeRequired) {
        this.halt({ kind: 'upgrade_required' });
        return;
      }
      if (this.stopped) return;
      // After `unauthorized` the next hello refreshes the token, or reports `signed_out` when
      // the session is really over (revoked, member removed).
      if (event.code === GatewayCloseCode.unauthorized) this.tokenRejected = true;
      const retryInMs = reconnectDelay(this.attempt, this.options.backoff ?? DEFAULT_BACKOFF);
      this.attempt += 1;
      this.options.onStatus({ kind: 'disconnected', retryInMs });
      this.reconnectTimer = this.setTimer(() => {
        this.connect();
      }, retryInMs);
    };

    socket.onerror = () => {
      // A close event always follows; reconnection is handled there.
    };
  }

  private schedulePing(): void {
    this.clearTimer(this.pingTimer);
    this.pingTimer = this.setTimer(() => {
      this.send({ type: 'ping' });
      this.schedulePing();
    }, this.options.pingIntervalMs ?? 20_000);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }
}
