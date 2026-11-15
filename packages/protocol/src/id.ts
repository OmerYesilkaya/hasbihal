import { z } from 'zod';

/**
 * Every id in Hasbihal is a UUIDv7 (ARCHITECTURE §3.3): time-ordered, so new rows land at the end
 * of an index, and safe to generate on the client, which makes sending a message idempotent.
 */
export const Id = z.uuidv7();
export type Id = z.infer<typeof Id>;
