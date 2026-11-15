import {
  GatewayCloseCode,
  PROTOCOL_VERSION,
  ServerMessage,
  parseFrame,
  type ClientMessage,
} from '@hasbihal/protocol';
import { DEFAULT_BACKOFF, reconnectDelay, type BackoffOptions } from './backoff.ts';

export type GatewayStatus =
  | { kind: 'connecting'; attempt: number }
  | { kind: 'connected'; serverVersion: string }
  | { kind: 'disconnected'; retryInMs: number }
  | { kind: 'upgrade_required' }
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
  /** WebSocket URL, e.g. wss://api.hasbihal.example/ws */
  url: string;
  clientVersion: string;
  createSocket: (url: string) => SocketLike;
  onStatus: (status: GatewayStatus) => void;
  backoff?: BackoffOptions;
  pingIntervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

/**
 * Keeps one gateway connection alive (ARCHITECTURE §5.1): says hello, reconnects
 * with backoff, pings to detect dead links, and stops for good when the server
 * says this client is too old (DECISIONS A33).
 */
export class GatewayClient {
  private socket: SocketLike | undefined;
  private attempt = 0;
  private stopped = false;
  private reconnectTimer: unknown;
  private pingTimer: unknown;
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
    this.stopped = true;
    this.clearTimer(this.reconnectTimer);
    this.clearTimer(this.pingTimer);
    this.socket?.close(1000, 'client stopped');
    this.socket = undefined;
    this.options.onStatus({ kind: 'stopped' });
  }

  private connect(): void {
    this.options.onStatus({ kind: 'connecting', attempt: this.attempt });
    const socket = this.options.createSocket(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        clientVersion: this.options.clientVersion,
      });
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseFrame(ServerMessage, event.data);
      if (!message) return;
      switch (message.type) {
        case 'welcome':
          this.attempt = 0;
          this.options.onStatus({ kind: 'connected', serverVersion: message.serverVersion });
          this.schedulePing();
          return;
        case 'upgrade_required':
          this.stopped = true;
          this.options.onStatus({ kind: 'upgrade_required' });
          return;
        case 'pong':
        case 'error':
          return;
      }
    };

    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.clearTimer(this.pingTimer);
      if (event.code === GatewayCloseCode.upgradeRequired) {
        this.stopped = true;
        this.options.onStatus({ kind: 'upgrade_required' });
        return;
      }
      if (this.stopped) return;
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
