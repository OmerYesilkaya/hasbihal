import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { SendFeedbackRequest, type FeedbackReceipt } from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import type { Database } from '../db/schema.ts';
import { parseRequest } from '../errors.ts';
import { sendFeedback } from './service.ts';

export interface FeedbackDeps {
  db: Kysely<Database>;
  guards: AuthGuards;
  /** Whether feedback becomes GitHub issues; without, it is only kept. */
  publish: boolean;
  jobsQueued: () => void;
}

/** "Send feedback" (A56): any member, a few times an hour. */
export function registerFeedback(
  app: FastifyInstance,
  { db, guards, publish, jobsQueued }: FeedbackDeps,
): void {
  const { requireAuth, auth } = guards;
  app.post(
    '/feedback',
    { preHandler: requireAuth },
    async (request, reply): Promise<FeedbackReceipt> => {
      const body = parseRequest(SendFeedbackRequest, request.body, 'body');
      const receipt = await sendFeedback(db, auth(request).userId, body, { publish });
      if (publish) jobsQueued();
      void reply.code(201);
      return receipt;
    },
  );
}
