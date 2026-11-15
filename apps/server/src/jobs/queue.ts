import { sql, type Kysely } from 'kysely';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/schema.ts';

/** How long a claimed job is someone's: if the server dies mid-job, it runs again after this. */
const LEASE_MS = 5 * 60 * 1000;
/** After this many failed tries a job is dropped (and logged). */
const MAX_ATTEMPTS = 5;
/** When idle, look for due jobs this often (new jobs from this process wake it at once). */
const POLL_MS = 5_000;

export type JobHandler = (payload: unknown) => Promise<void>;

/** Adds a job, inside the caller's transaction when given one, so it exists only if that commits. */
export async function enqueueJob(
  db: Kysely<Database>,
  kind: string,
  payload: unknown,
  runAt?: Date,
): Promise<void> {
  await db
    .insertInto('jobs')
    .values({
      kind,
      payload: JSON.stringify(payload),
      ...(runAt ? { run_at: runAt } : {}),
    })
    .execute();
}

/**
 * The background scheduler (ARCHITECTURE §3.6): durable in PostgreSQL, retried with backoff,
 * safe across restarts. One job at a time is plenty at this scale.
 */
export class JobQueue {
  readonly #db: Kysely<Database>;
  readonly #log: FastifyBaseLogger;
  readonly #handlers: Record<string, JobHandler>;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running: Promise<void> | null = null;
  #stopped = true;

  constructor(db: Kysely<Database>, log: FastifyBaseLogger, handlers: Record<string, JobHandler>) {
    this.#db = db;
    this.#log = log;
    this.#handlers = handlers;
  }

  start(): void {
    this.#stopped = false;
    this.wake();
  }

  /** Waits for the job in hand, then stops. */
  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#running;
  }

  /** Something was just enqueued: look now rather than at the next poll. */
  wake(): void {
    if (this.#stopped || this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#running = this.#drain().finally(() => {
      this.#running = null;
      if (!this.#stopped)
        this.#timer = setTimeout(() => {
          this.wake();
        }, POLL_MS);
    });
  }

  /** Runs due jobs until there are none (or it's stopped). Resolves when idle; for tests too. */
  async #drain(): Promise<void> {
    while (!this.#stopped) {
      const job = await this.#claim().catch((error: unknown) => {
        this.#log.warn({ err: error }, 'could not claim a job');
        return null;
      });
      if (!job) return;
      await this.#run(job);
    }
  }

  /** Runs every due job now, then returns (tests). */
  async runDue(): Promise<void> {
    for (;;) {
      const job = await this.#claim();
      if (!job) return;
      await this.#run(job);
    }
  }

  async #claim(): Promise<{ id: string; kind: string; payload: unknown; attempts: number } | null> {
    const result = await sql<{ id: string; kind: string; payload: unknown; attempts: number }>`
      update jobs set run_at = now() + ${`${String(LEASE_MS)} milliseconds`}::interval,
        attempts = attempts + 1
      where id = (
        select id from jobs where run_at <= now() order by run_at, id limit 1 for update skip locked
      )
      returning id, kind, payload, attempts
    `.execute(this.#db);
    return result.rows[0] ?? null;
  }

  async #run(job: { id: string; kind: string; payload: unknown; attempts: number }): Promise<void> {
    const handler = this.#handlers[job.kind];
    try {
      if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
      await handler(job.payload);
      await this.#db.deleteFrom('jobs').where('id', '=', job.id).execute();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (job.attempts >= MAX_ATTEMPTS) {
        this.#log.warn({ job: job.kind, err: error }, 'job failed for good');
        await this.#db.deleteFrom('jobs').where('id', '=', job.id).execute();
        return;
      }
      // 30 s, 2 min, 8 min, 32 min: transient failures (a site down for a moment) get a chance.
      const delayMs = 30_000 * 4 ** (job.attempts - 1);
      await this.#db
        .updateTable('jobs')
        .set({ run_at: new Date(Date.now() + delayMs), last_error: message.slice(0, 500) })
        .where('id', '=', job.id)
        .execute();
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The app's job queue (tests run due jobs with `runDue`). */
    jobs: JobQueue;
  }
}
