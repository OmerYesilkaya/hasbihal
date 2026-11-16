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
  rooms: RoomsTable;
  messages: MessagesTable;
  message_mentions: MessageMentionsTable;
  reactions: ReactionsTable;
  room_user_prefs: RoomUserPrefsTable;
  files: FilesTable;
  attachments: AttachmentsTable;
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
  avatar_file_id: ColumnType<string | null, string | null | undefined, string | null>;
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

export interface RoomsTable {
  id: string;
  name: string;
  topic: string | null;
  position: number;
  created_by: string | null;
  created_at: CreatedAt;
  archived_at: NullableTime;
}

export interface MessagesTable {
  id: string;
  room_id: string;
  author_id: string;
  body: string;
  reply_to_id: string | null;
  mentions_everyone: Generated<boolean>;
  created_at: CreatedAt;
  edited_at: NullableTime;
  deleted_at: NullableTime;
}

export interface MessageMentionsTable {
  message_id: string;
  user_id: string;
}

export interface ReactionsTable {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: CreatedAt;
}

export interface RoomUserPrefsTable {
  room_id: string;
  user_id: string;
  notify_level: Generated<'mentions' | 'all' | 'muted'>;
  sound_on_message: Generated<boolean>;
  hangout_start_alerts: Generated<boolean>;
  last_read_message_id: ColumnType<string | null, string | null | undefined, string | null>;
}

export interface FilesTable {
  id: string;
  uploader_id: string;
  kind: 'image' | 'video' | 'audio' | 'voice' | 'other';
  original_name: string;
  mime: string;
  /** int8: pg returns a string. */
  size_bytes: ColumnType<string, number, number>;
  sha256: Buffer;
  storage_key: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumbnail_key: string | null;
  created_at: CreatedAt;
}

export interface AttachmentsTable {
  message_id: string;
  file_id: string;
  position: number;
}
