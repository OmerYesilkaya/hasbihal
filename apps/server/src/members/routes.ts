import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { MemberList } from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import { toUser } from '../auth/sessions.ts';
import type { Database } from '../db/schema.ts';

/**
 * Everyone who has ever been a member, by display name: removed members included, marked, so
 * their messages still show their names (A42). The member list shows only current ones.
 */
export function registerMembers(
  app: FastifyInstance,
  db: Kysely<Database>,
  { requireAuth }: AuthGuards,
): void {
  app.get('/members', { preHandler: requireAuth }, async (): Promise<MemberList> => {
    const rows = await db.selectFrom('users').selectAll().orderBy('display_name').execute();
    return { members: rows.map(toUser) };
  });
}
