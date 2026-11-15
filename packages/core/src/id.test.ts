import { describe, expect, it } from 'vitest';
import { Id } from '@hasbihal/protocol';
import { newId } from './id.ts';

describe('newId', () => {
  it('creates valid UUIDv7s that sort in creation order', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    for (const id of ids) expect(Id.safeParse(id).success).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
