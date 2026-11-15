import type { ColumnType, Generated } from 'kysely';
import type { Role } from '@hasbihal/protocol';

/**
 * The database schema as Kysely sees it: one entry per table, added together with the migration
 * that creates the table (ARCHITECTURE §3.3). Kept by hand rather than generated, so a reviewer
 * sees schema and types change in the same diff.
 */
export interface Database {
  users: UsersTable;
  credentials: CredentialsTable;
  sessions: SessionsTable;
  invites: InvitesTable;
  recovery_links: RecoveryLinksTable;
  event_log: EventLogTable;
}

/** A timestamp with a database default: optional on insert, never updated by hand. */
type CreatedAt = Generated<Date>;
/** A nullable timestamp that starts empty. */
type NullableTime = ColumnType<Date | null, Date | null | undefined, Date | null>;

export interface UsersTable {
  id: string;
  username: string;
  display_name: string;
  avatar_color: number;
  role: Role;
  presence_mode: Generated<'available' | 'busy'>;
  created_at: CreatedAt;
  removed_at: NullableTime;
}

export interface CredentialsTable {
  user_id: string;
  password_hash: string;
  password_changed_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  refresh_token_hash: Buffer;
  device_name: string;
  created_at: CreatedAt;
  last_used_at: Generated<Date>;
  expires_at: Date;
  revoked_at: NullableTime;
}

export interface InvitesTable {
  id: string;
  token_hash: Buffer;
  role: Role;
  created_by: string | null;
  created_at: CreatedAt;
  expires_at: Date;
  used_by: ColumnType<string | null, string | null | undefined, string | null>;
  used_at: NullableTime;
}

export interface RecoveryLinksTable {
  id: string;
  user_id: string;
  token_hash: Buffer;
  created_by: string | null;
  created_at: CreatedAt;
  expires_at: Date;
  used_at: NullableTime;
}

export interface EventLogTable {
  /** bigserial: pg returns int8 as a string; convert with Number() (safe far beyond our volume). */
  seq: Generated<string>;
  type: string;
  payload: unknown;
  created_at: CreatedAt;
}
