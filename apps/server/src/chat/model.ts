import { sql, type Kysely, type Selectable } from 'kysely';
import { extractMentions } from '@hasbihal/core';
import type { Message, Room, RoomWithState } from '@hasbihal/protocol';
import type { Database, MessagesTable, RoomsTable } from '../db/schema.ts';
import { toAttachment } from '../files/routes.ts';

/** How much of a replied-to message is quoted above the reply. */
const REPLY_EXCERPT = 120;

export function toRoom(
  row: Pick<
    Selectable<RoomsTable>,
    'id' | 'name' | 'topic' | 'position' | 'created_at' | 'archived_at'
  >,
): Room {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

/** Messages with their mentions, reactions, and reply previews, in the order given. */
export async function hydrateMessages(
  db: Kysely<Database>,
  rows: Selectable<MessagesTable>[],
): Promise<Message[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.flatMap((r) => (r.reply_to_id ? [r.reply_to_id] : [])))];

  const [mentions, reactions, replies, attachments, previews] = await Promise.all([
    db
      .selectFrom('message_mentions')
      .select(['message_id', 'user_id'])
      .where('message_id', 'in', ids)
      .execute(),
    db
      .selectFrom('reactions')
      .select(['message_id', 'user_id', 'emoji'])
      .where('message_id', 'in', ids)
      .orderBy('created_at')
      .execute(),
    replyIds.length
      ? db
          .selectFrom('messages')
          .select(['id', 'author_id', 'body', 'deleted_at'])
          .where('id', 'in', replyIds)
          .execute()
      : Promise.resolve([]),
    db
      .selectFrom('attachments')
      .innerJoin('files', 'files.id', 'attachments.file_id')
      .select([
        'attachments.message_id',
        'files.id',
        'files.kind',
        'files.original_name',
        'files.mime',
        'files.size_bytes',
        'files.width',
        'files.height',
        'files.duration_ms',
        'files.thumbnail_key',
      ])
      .where('attachments.message_id', 'in', ids)
      .orderBy('attachments.position')
      .execute(),
    db
      .selectFrom('message_links')
      .innerJoin('link_previews', 'link_previews.url', 'message_links.url')
      .leftJoin('files', 'files.id', 'link_previews.image_file_id')
      .select([
        'message_links.message_id',
        'link_previews.url',
        'link_previews.title',
        'link_previews.description',
        'link_previews.site_name',
        'files.id as file_id',
        'files.kind',
        'files.original_name',
        'files.mime',
        'files.size_bytes',
        'files.width',
        'files.height',
        'files.duration_ms',
        'files.thumbnail_key',
      ])
      .where('message_links.message_id', 'in', ids)
      .where('link_previews.status', '=', 'ok')
      .orderBy('message_links.position')
      .execute(),
  ]);
  const replyById = new Map(replies.map((r) => [r.id, r]));

  return rows.map((row) => {
    const reactionsByEmoji = new Map<string, string[]>();
    for (const r of reactions) {
      if (r.message_id !== row.id) continue;
      reactionsByEmoji.set(r.emoji, [...(reactionsByEmoji.get(r.emoji) ?? []), r.user_id]);
    }
    const reply = row.reply_to_id ? replyById.get(row.reply_to_id) : undefined;
    return {
      id: row.id,
      roomId: row.room_id,
      authorId: row.author_id,
      body: row.body,
      replyTo: reply
        ? {
            id: reply.id,
            authorId: reply.author_id,
            excerpt: reply.deleted_at
              ? ''
              : reply.body.replace(/\s+/g, ' ').slice(0, REPLY_EXCERPT),
            deleted: reply.deleted_at !== null,
          }
        : null,
      mentions: mentions.filter((m) => m.message_id === row.id).map((m) => m.user_id),
      mentionsEveryone: row.mentions_everyone,
      reactions: [...reactionsByEmoji].map(([emoji, userIds]) => ({ emoji, userIds })),
      attachments: attachments.filter((a) => a.message_id === row.id).map(toAttachment),
      previews: previews
        .filter((p) => p.message_id === row.id && p.title !== null)
        .map((p) => ({
          url: p.url,
          title: p.title ?? '',
          description: p.description,
          siteName: p.site_name,
          image:
            p.file_id && p.kind && p.original_name && p.mime && p.size_bytes !== null
              ? toAttachment({
                  id: p.file_id,
                  kind: p.kind,
                  original_name: p.original_name,
                  mime: p.mime,
                  size_bytes: p.size_bytes,
                  width: p.width,
                  height: p.height,
                  duration_ms: p.duration_ms,
                  thumbnail_key: p.thumbnail_key,
                })
              : null,
        })),
      createdAt: row.created_at.toISOString(),
      editedAt: row.edited_at?.toISOString() ?? null,
      deletedAt: row.deleted_at?.toISOString() ?? null,
    };
  });
}

export async function loadMessage(db: Kysely<Database>, id: string): Promise<Message | undefined> {
  const row = await db.selectFrom('messages').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? (await hydrateMessages(db, [row]))[0] : undefined;
}

/**
 * Who a body mentions: ids of existing, not removed members, and whether it says @everyone.
 * Unknown names are ignored, like plain text.
 */
export async function resolveMentions(
  db: Kysely<Database>,
  body: string,
): Promise<{ userIds: string[]; everyone: boolean }> {
  const { usernames, everyone } = extractMentions(body);
  if (!usernames.length) return { userIds: [], everyone };
  const rows = await db
    .selectFrom('users')
    .select('id')
    .where('username', 'in', usernames)
    .where('removed_at', 'is', null)
    .execute();
  return { userIds: rows.map((r) => r.id), everyone };
}

/**
 * Every room with this member's read marker and unread counts. Unread means: by someone else,
 * not deleted, after the marker. Without a marker, after the member joined, so a new member
 * isn't greeted by a badge for the whole history.
 */
export async function roomsWithState(
  db: Kysely<Database>,
  userId: string,
): Promise<RoomWithState[]> {
  const result = await sql<{
    id: string;
    name: string;
    topic: string | null;
    position: number;
    created_at: Date;
    archived_at: Date | null;
    last_read_message_id: string | null;
    unread: string;
    unread_mentions: string;
  }>`
    select r.id, r.name, r.topic, r.position, r.created_at, r.archived_at, p.last_read_message_id,
      count(m.id) as unread,
      count(m.id) filter (
        where m.mentions_everyone
          or exists (select 1 from message_mentions mm where mm.message_id = m.id and mm.user_id = ${userId})
      ) as unread_mentions
    from rooms r
    join users me on me.id = ${userId}
    left join room_user_prefs p on p.room_id = r.id and p.user_id = me.id
    left join messages lm on lm.id = p.last_read_message_id
    left join messages m on m.room_id = r.id
      and m.author_id <> me.id
      and m.deleted_at is null
      and case
        when lm.id is null then m.created_at > me.created_at
        else (m.created_at, m.id) > (lm.created_at, lm.id)
      end
    group by r.id, p.last_read_message_id
    order by r.position, r.created_at
  `.execute(db);
  return result.rows.map((row) => ({
    ...toRoom(row),
    lastReadMessageId: row.last_read_message_id,
    unreadCount: Number(row.unread),
    unreadMentionCount: Number(row.unread_mentions),
  }));
}
