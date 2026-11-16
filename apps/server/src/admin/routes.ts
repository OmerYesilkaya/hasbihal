import type { FastifyInstance } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import { ChangeRoleRequest, Id, type InviteList, type User } from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import { revokeAllSessions, toUser } from '../auth/sessions.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { appendEvent } from '../gateway/events.ts';
import type { GatewayHub } from '../gateway/hub.ts';

const IdParam = z.object({ id: Id });

/**
 * The admin page's actions (A44) beyond what other modules offer (creating invites and recovery
 * links, managing rooms): pending invites, admin rights, and removing members.
 */
export function registerAdmin(
  app: FastifyInstance,
  deps: { db: Kysely<Database>; hub: GatewayHub; guards: AuthGuards },
): void {
  const { db, hub, guards } = deps;
  const { requireAdmin, auth } = guards;

  /** There is always someone left to run the place. */
  const keepAnAdmin = async (trx: Kysely<Database>, userId: string) => {
    const others = await trx
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'admin')
      .where('removed_at', 'is', null)
      .where('id', '!=', userId)
      .executeTakeFirst();
    if (!others) throw new AppError(409, 'conflict', 'At least one admin must remain.');
  };

  const changeUser = async (
    id: string,
    change: (trx: Transaction<Database>) => Promise<void>,
  ): Promise<User> => {
    const user = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!row || row.removed_at) throw new AppError(404, 'not_found', 'No such member.');
      await change(trx);
      const updated = toUser(
        await trx.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
      );
      await appendEvent(trx, { type: 'member_updated', user: updated });
      return updated;
    });
    hub.eventsCommitted();
    return user;
  };

  // ---- invites ---------------------------------------------------------------------------------

  /** Unused, unexpired invites. Their links can't be shown again: only hashes are kept (§9). */
  app.get('/admin/invites', { preHandler: requireAdmin }, async (): Promise<InviteList> => {
    const rows = await db
      .selectFrom('invites')
      .select(['id', 'role', 'created_by', 'created_at', 'expires_at'])
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .execute();
    return {
      invites: rows.map((r) => ({
        id: r.id,
        role: r.role,
        createdBy: r.created_by,
        createdAt: r.created_at.toISOString(),
        expiresAt: r.expires_at.toISOString(),
      })),
    };
  });

  app.delete('/admin/invites/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    // Expiring it now makes it invalid everywhere, and keeps the record.
    await db
      .updateTable('invites')
      .set({ expires_at: new Date() })
      .where('id', '=', id)
      .where('used_at', 'is', null)
      .execute();
    return reply.code(204).send();
  });

  // ---- members ---------------------------------------------------------------------------------

  app.put('/admin/users/:id/role', { preHandler: requireAdmin }, async (request): Promise<User> => {
    const { id } = parseRequest(IdParam, request.params, 'params');
    const { role } = parseRequest(ChangeRoleRequest, request.body, 'body');
    return changeUser(id, async (trx) => {
      if (role === 'member') await keepAnAdmin(trx, id);
      await trx.updateTable('users').set({ role }).where('id', '=', id).execute();
    });
  });

  /**
   * Removes a member (A42): they're signed out everywhere and can't sign in again; their messages
   * stay. Undoing it means a new invite.
   */
  app.post(
    '/admin/users/:id/remove',
    { preHandler: requireAdmin },
    async (request): Promise<User> => {
      const { id } = parseRequest(IdParam, request.params, 'params');
      if (id === auth(request).userId)
        throw new AppError(409, 'conflict', 'You can’t remove yourself.');
      const user = await changeUser(id, async (trx) => {
        await keepAnAdmin(trx, id);
        await trx
          .updateTable('users')
          .set({ removed_at: new Date() })
          .where('id', '=', id)
          .execute();
        await revokeAllSessions(trx, id);
      });
      hub.closeUserSessions(id);
      return user;
    },
  );
}
