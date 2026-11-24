import type { FastifyInstance } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { z } from 'zod';
import {
  AllowEmailRequest,
  ChangeRoleRequest,
  Email,
  Id,
  type AccessList,
  type AllowedEmail,
  type User,
} from '@hasbihal/protocol';
import type { AuthGuards } from '../auth/routes.ts';
import { revokeAllSessions, toUser } from '../auth/sessions.ts';
import type { Database } from '../db/schema.ts';
import { AppError, parseRequest } from '../errors.ts';
import { loadRoom } from '../chat/model.ts';
import { appendEvent } from '../gateway/events.ts';
import type { GatewayHub } from '../gateway/hub.ts';

const IdParam = z.object({ id: Id });
const EmailParam = z.object({ email: Email });

/**
 * The admin page's actions (A44) beyond what other modules offer (managing rooms): who may join
 * (A25), admin rights, and removing members.
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

  // ---- who may join (A25) -----------------------------------------------------------------------

  app.get('/admin/access', { preHandler: requireAdmin }, async (): Promise<AccessList> => {
    const [allowed, requests, members] = await Promise.all([
      db.selectFrom('allowed_emails').selectAll().orderBy('added_at', 'desc').execute(),
      db.selectFrom('access_requests').selectAll().orderBy('requested_at', 'desc').execute(),
      db.selectFrom('users').select(['id', 'email']).where('removed_at', 'is', null).execute(),
    ]);
    return {
      allowed: allowed.map((r) => ({
        email: r.email,
        role: r.role,
        addedBy: r.added_by,
        addedAt: r.added_at.toISOString(),
      })),
      requests: requests.map((r) => ({
        email: r.email,
        name: r.name,
        requestedAt: r.requested_at.toISOString(),
      })),
      memberEmails: Object.fromEntries(members.map((m) => [m.id, m.email])),
    };
  });

  /** Lets an address in; its owner's first Google sign-in makes the account. */
  app.post(
    '/admin/allowed-emails',
    { preHandler: requireAdmin },
    async (request, reply): Promise<AllowedEmail> => {
      const { email, role } = parseRequest(AllowEmailRequest, request.body, 'body');
      const member = await db
        .selectFrom('users')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      if (member) throw new AppError(409, 'conflict', 'This address is already a member’s.');
      const row = await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('access_requests').where('email', '=', email).execute();
        return trx
          .insertInto('allowed_emails')
          .values({ email, role, added_by: auth(request).userId })
          .onConflict((oc) =>
            oc.column('email').doUpdateSet({ role, added_by: auth(request).userId }),
          )
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      void reply.code(201);
      return {
        email: row.email,
        role: row.role,
        addedBy: row.added_by,
        addedAt: row.added_at.toISOString(),
      };
    },
  );

  app.delete(
    '/admin/allowed-emails/:email',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { email } = parseRequest(EmailParam, request.params, 'params');
      await db.deleteFrom('allowed_emails').where('email', '=', email).execute();
      return reply.code(204).send();
    },
  );

  /** Dismisses a request without letting them in. They may ask again. */
  app.delete(
    '/admin/access-requests/:email',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { email } = parseRequest(EmailParam, request.params, 'params');
      await db.deleteFrom('access_requests').where('email', '=', email).execute();
      return reply.code(204).send();
    },
  );

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
   * stay. Their address and Google account are let go, so adding the address again later makes
   * them a new account.
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
          .set({ removed_at: new Date(), email: null, google_sub: null })
          .where('id', '=', id)
          .execute();
        await revokeAllSessions(trx, id);
        // A55: off every Mahrem list; a list left empty makes its room open again.
        const lists = await trx
          .deleteFrom('room_mahrem')
          .where('user_id', '=', id)
          .returning('room_id')
          .execute();
        for (const { room_id } of lists) {
          const room = await loadRoom(trx, room_id);
          if (room) await appendEvent(trx, { type: 'room_updated', room });
        }
      });
      hub.closeUserSessions(id);
      return user;
    },
  );
}
