import { describe, expect, it } from 'vitest';
import {
  GatewayCloseCode,
  PROTOCOL_VERSION,
  type DurableEvent,
  type User,
} from '@hasbihal/protocol';
import { reconnectDelay } from './backoff.ts';
import { GatewayClient, type GatewayStatus, type SocketLike } from './client.ts';

const ME: User = {
  id: '0192f0c4-7b5e-7c8e-9a3b-1234567890ab',
  username: 'omer',
  displayName: 'Ömer',
  avatarColor: 1,
  avatarFileId: null,
  role: 'admin',
  createdAt: '2026-11-15T10:00:00.000Z',
};
const OTHER = {
  ...ME,
  id: '0192f0c4-7b5e-7c8e-9a3b-1234567890ac',
  username: 'ayse',
  displayName: 'Ayşe',
};

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed: { code?: number } | undefined;
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number): void {
    this.closed = { code };
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  messages(): Record<string, unknown>[] {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

/** Lets the async access-token lookup in onopen finish. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const welcome = (seq: number, resync = false) => ({
  type: 'welcome',
  serverVersion: '1.2.3',
  protocolVersion: PROTOCOL_VERSION,
  seq,
  resync,
  me: ME,
  presence: { [ME.id]: 'available' },
});

function setup(token: () => string | null = () => 'token-1') {
  const sockets: FakeSocket[] = [];
  const statuses: GatewayStatus[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const events: [DurableEvent, number][] = [];
  const tokenRequests: { refresh: boolean }[] = [];
  const client = new GatewayClient({
    url: 'ws://test/ws',
    clientVersion: '0.1.0',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    getAccessToken: (options) => {
      tokenRequests.push(options);
      return Promise.resolve(token());
    },
    onStatus: (status) => statuses.push(status),
    onEvent: (event, seq) => events.push([event, seq]),
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const i = timers.indexOf(handle as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  /** Opens the current socket and waits for the hello. */
  const open = async () => {
    const socket = sockets.at(-1)!;
    socket.open();
    await flush();
    return socket;
  };
  /** Fires the pending reconnect timer. */
  const reconnect = () => {
    timers.find((t) => t.ms !== 20_000)!.fn();
  };
  return { client, sockets, statuses, timers, events, tokenRequests, open, reconnect };
}

describe('GatewayClient', () => {
  it('says hello with an access token and reports connected on welcome', async () => {
    const { client, statuses, open } = setup();
    client.start();
    const socket = await open();
    expect(socket.messages()[0]).toEqual({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: '0.1.0',
      accessToken: 'token-1',
    });
    socket.receive(welcome(7));
    expect(statuses.at(-1)).toEqual({ kind: 'connected', serverVersion: '1.2.3' });
  });

  it('resumes from the last applied event after a reconnect, and skips repeats', async () => {
    const { client, events, open, reconnect } = setup();
    client.start();
    let socket = await open();
    socket.receive(welcome(7));
    const joined = { type: 'member_joined', user: OTHER };
    socket.receive({ type: 'event', seq: 8, event: joined });
    socket.drop();

    reconnect();
    socket = await open();
    expect(socket.messages()[0]).toMatchObject({ type: 'hello', lastSeq: 8 });
    socket.receive(welcome(9));
    socket.receive({ type: 'event', seq: 8, event: joined }); // repeated around the reconnect
    socket.receive({ type: 'event', seq: 9, event: joined });
    expect(events.map(([, seq]) => seq)).toEqual([8, 9]);
  });

  it('continues from the server position after a resync', async () => {
    const { client, open, reconnect } = setup();
    client.start();
    let socket = await open();
    socket.receive(welcome(3));
    socket.drop();
    reconnect();
    socket = await open();
    socket.receive(welcome(500, true));
    socket.drop();
    reconnect();
    socket = await open();
    expect(socket.messages()[0]).toMatchObject({ lastSeq: 500 });
  });

  it('refreshes the token after the server rejects it', async () => {
    const { client, tokenRequests, open, reconnect } = setup();
    client.start();
    const socket = await open();
    socket.drop(GatewayCloseCode.unauthorized);
    reconnect();
    await open();
    expect(tokenRequests).toEqual([{ refresh: false }, { refresh: true }]);
  });

  it('stops when the session has ended', async () => {
    const { client, statuses, timers, open } = setup(() => null);
    client.start();
    await open();
    expect(statuses.at(-1)).toEqual({ kind: 'signed_out' });
    expect(timers).toHaveLength(0);
  });

  it('reports idleness, and repeats it after reconnecting', async () => {
    const { client, open, reconnect } = setup();
    client.start();
    let socket = await open();
    socket.receive(welcome(1));
    client.setIdle(true);
    expect(socket.messages().at(-1)).toEqual({ type: 'activity', idle: true });
    socket.drop();
    reconnect();
    socket = await open();
    socket.receive(welcome(1));
    expect(socket.messages().at(-1)).toEqual({ type: 'activity', idle: true });
  });

  it('reconnects after an unexpected close', async () => {
    const { client, sockets, statuses, open, reconnect } = setup();
    client.start();
    await open();
    sockets[0]!.drop();
    expect(statuses.at(-1)?.kind).toBe('disconnected');
    reconnect();
    expect(sockets).toHaveLength(2);
  });

  it('stops reconnecting when an upgrade is required', async () => {
    const { client, statuses, timers, open } = setup();
    client.start();
    const socket = await open();
    socket.receive({ type: 'upgrade_required', minProtocolVersion: 2, maxProtocolVersion: 2 });
    socket.drop(GatewayCloseCode.upgradeRequired);
    expect(statuses.at(-1)).toEqual({ kind: 'upgrade_required' });
    expect(timers).toHaveLength(0);
  });

  it('does not reconnect after stop()', () => {
    const { client, sockets, timers } = setup();
    client.start();
    client.stop();
    sockets[0]!.drop();
    expect(timers).toHaveLength(0);
  });
});

describe('reconnectDelay', () => {
  it('grows exponentially and is capped', () => {
    const max = () => 0.999999;
    expect(reconnectDelay(0, { baseMs: 500, maxMs: 30_000 }, max)).toBe(500);
    expect(reconnectDelay(3, { baseMs: 500, maxMs: 30_000 }, max)).toBe(4000);
    expect(reconnectDelay(20, { baseMs: 500, maxMs: 30_000 }, max)).toBe(30_000);
  });
});
