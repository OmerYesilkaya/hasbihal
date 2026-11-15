import { z } from 'zod';

export const HealthResponse = z.object({
  /** `unavailable` (HTTP 503) when a dependency such as the database can't be reached. */
  status: z.enum(['ok', 'unavailable']),
  serverVersion: z.string(),
  protocolVersion: z.number().int(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
