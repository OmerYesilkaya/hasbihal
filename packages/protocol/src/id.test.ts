import { describe, expect, it } from 'vitest';
import { ApiError, Id } from './index.ts';

describe('Id', () => {
  it('accepts UUIDv7 and rejects other versions', () => {
    expect(Id.safeParse('0192f0c4-7b5e-7c8e-9a3b-1234567890ab').success).toBe(true);
    expect(Id.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(false); // v4
    expect(Id.safeParse('not-an-id').success).toBe(false);
  });
});

describe('ApiError', () => {
  it('rejects unknown error codes', () => {
    expect(ApiError.safeParse({ error: { code: 'teapot', message: 'x' } }).success).toBe(false);
    expect(ApiError.safeParse({ error: { code: 'not_found', message: 'x' } }).success).toBe(true);
  });
});
