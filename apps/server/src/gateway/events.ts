import { sql, type Kysely, type Transaction } from 'kysely';
import { DurableEvent } from '@hasbihal/protocol';
import type { Database } from '../db/schema.ts';

/** ARCHITECTURE §5.3: plenty for catching up at our volume. */
export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Advisory lock key ("HBEV") that serializes event writers. */
const EVENT_WRITE_LOCK = 0x48424556;

export interface LoggedEvent {
  seq: number;
  event: DurableEvent;
}

/**
 * Appends an event inside the transaction that makes the change it describes. The transaction
 * first takes a lock held until commit, so events become visible in `seq` order: without it,
 * seq 6 could commit before seq 5, and a client that saw 6 would skip 5 on replay forever.
 * Call `GatewayHub.eventsCommitted()` after the transaction commits.
 */
export async function appendEvent(
  trx: Transaction<Database>,
  event: DurableEvent,
): Promise<number> {
  await sql`select pg_advisory_xact_lock(${EVENT_WRITE_LOCK})`.execute(trx);
  const row = await trx
    .insertInto('event_log')
    .values({ type: event.type, payload: JSON.stringify(event) })
    .returning('seq')
    .executeTakeFirstOrThrow();
  return Number(row.seq);
}

/** Events after `seq`, oldest first. */
export async function eventsAfter(
  db: Kysely<Database>,
  seq: number,
  limit: number,
): Promise<LoggedEvent[]> {
  const rows = await db
    .selectFrom('event_log')
    .select(['seq', 'payload'])
    .where('seq', '>', String(seq))
    .orderBy('seq')
    .limit(limit)
    .execute();
  return rows.map((row) => ({ seq: Number(row.seq), event: DurableEvent.parse(row.payload) }));
}

/** The newest seq and the oldest one still retained (0 when the log is empty). */
export async function logBounds(db: Kysely<Database>): Promise<{ head: number; oldest: number }> {
  const row = await db
    .selectFrom('event_log')
    // Null on an empty log, which Kysely's default types don't express.
    .select((eb) => [
      eb.fn.max<string | null>('seq').as('head'),
      eb.fn.min<string | null>('seq').as('oldest'),
    ])
    .executeTakeFirstOrThrow();
  return { head: Number(row.head ?? 0), oldest: Number(row.oldest ?? 0) };
}

/** Removes events past the retention period, always keeping the newest so `head` survives. */
export async function pruneEvents(db: Kysely<Database>, now = new Date()): Promise<void> {
  const { head } = await logBounds(db);
  await db
    .deleteFrom('event_log')
    .where('created_at', '<', new Date(now.getTime() - EVENT_RETENTION_MS))
    .where('seq', '<', String(head))
    .execute();
}
