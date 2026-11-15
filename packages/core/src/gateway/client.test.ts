import { describe, expect, it } from 'vitest';
import { GatewayCloseCode, PROTOCOL_VERSION } from '@hasbihal/protocol';
import { reconnectDelay } from './backoff.ts';
import { GatewayClient, type GatewayStatus, type SocketLike } from './client.ts';

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
}

function setup() {
  const sockets: FakeSocket[] = [];
  const statuses: GatewayStatus[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const client = new GatewayClient({
    url: 'ws://test/ws',
    clientVersion: '0.1.0',
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onStatus: (status) => statuses.push(status),
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
  return { client, sockets, statuses, timers };
}

describe('GatewayClient', () => {
  it('says hello on open and reports connected on welcome', () => {
    const { client, sockets, statuses } = setup();
    client.start();
    const socket = sockets[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: '0.1.0',
    });
    socket.receive({ type: 'welcome', serverVersion: '1.2.3', protocolVersion: PROTOCOL_VERSION });
    expect(statuses.at(-1)).toEqual({ kind: 'connected', serverVersion: '1.2.3' });
  });

  it('reconnects after an unexpected close', () => {
    const { client, sockets, statuses, timers } = setup();
    client.start();
    sockets[0]!.drop();
    expect(statuses.at(-1)?.kind).toBe('disconnected');
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    expect(sockets).toHaveLength(2);
  });

  it('stops reconnecting when an upgrade is required', () => {
    const { client, sockets, statuses, timers } = setup();
    client.start();
    sockets[0]!.open();
    sockets[0]!.receive({ type: 'upgrade_required', minProtocolVersion: 2, maxProtocolVersion: 2 });
    sockets[0]!.drop(GatewayCloseCode.upgradeRequired);
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
