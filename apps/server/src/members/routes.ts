import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { MemberList } from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import { toUser } from '../auth/sessions.ts';
import type { Database } from '../db/schema.ts';

/** The member list (A36): everyone who hasn't been removed, by display name. */
export function registerMembers(
  app: FastifyInstance,
  db: Kysely<Database>,
  { requireAuth }: AuthGuards,
): void {
  app.get('/members', { preHandler: requireAuth }, async (): Promise<MemberList> => {
    const rows = await db
      .selectFrom('users')
      .selectAll()
      .where('removed_at', 'is', null)
      .orderBy('display_name')
      .execute();
    return { members: rows.map(toUser) };
  });
}
