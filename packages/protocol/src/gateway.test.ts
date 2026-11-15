import { describe, expect, it } from 'vitest';
import { ClientMessage, ServerMessage, parseFrame } from './gateway.ts';

describe('parseFrame', () => {
  it('parses a valid hello', () => {
    const frame = JSON.stringify({ type: 'hello', protocolVersion: 1, clientVersion: '0.1.0' });
    expect(parseFrame(ClientMessage, frame)).toEqual({
      type: 'hello',
      protocolVersion: 1,
      clientVersion: '0.1.0',
    });
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseFrame(ClientMessage, '{not json')).toBeUndefined();
  });

  it('returns undefined for unknown message types', () => {
    expect(parseFrame(ClientMessage, JSON.stringify({ type: 'nope' }))).toBeUndefined();
  });

  it('rejects a hello with a negative lastSeq', () => {
    const frame = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      clientVersion: '0.1.0',
      lastSeq: -1,
    });
    expect(parseFrame(ClientMessage, frame)).toBeUndefined();
  });

  it('parses server messages', () => {
    const frame = JSON.stringify({
      type: 'upgrade_required',
      minProtocolVersion: 2,
      maxProtocolVersion: 3,
    });
    expect(parseFrame(ServerMessage, frame)?.type).toBe('upgrade_required');
  });
});
