import { v7 } from 'uuid';
import type { Id } from '@hasbihal/protocol';

/**
 * A new UUIDv7. Ids made in the same millisecond still sort in creation order (the `uuid` package
 * keeps a monotonic counter), so the client can create message ids that order like the messages.
 */
export function newId(): Id {
  return v7();
}
