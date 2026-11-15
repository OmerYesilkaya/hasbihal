import { describe, expect, it } from 'vitest';
import {
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  isProtocolSupported,
} from './version.ts';

describe('isProtocolSupported', () => {
  it('accepts every version in the supported range', () => {
    for (let v = MIN_SUPPORTED_PROTOCOL_VERSION; v <= PROTOCOL_VERSION; v++) {
      expect(isProtocolSupported(v)).toBe(true);
    }
  });

  it('rejects versions outside the range and non-integers', () => {
    expect(isProtocolSupported(MIN_SUPPORTED_PROTOCOL_VERSION - 1)).toBe(false);
    expect(isProtocolSupported(PROTOCOL_VERSION + 1)).toBe(false);
    expect(isProtocolSupported(1.5)).toBe(false);
    expect(isProtocolSupported(Number.NaN)).toBe(false);
  });
});
