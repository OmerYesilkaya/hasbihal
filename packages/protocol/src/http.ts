import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  serverVersion: z.string(),
  protocolVersion: z.number().int(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
