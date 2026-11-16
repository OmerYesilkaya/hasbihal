import { z } from 'zod';
import { ATTACHMENTS_MAX, Attachment, LinkPreview } from './files.ts';
import { Id } from './id.ts';

// Rooms and messages (ARCHITECTURE §3.3, DECISIONS A8, A11, A12, A22).

export const ROOM_NAME_MAX = 50;
export const ROOM_TOPIC_MAX = 200;
export const MESSAGE_BODY_MAX = 4000;

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .pipe(z.string().min(1).max(max));

export const RoomName = text(ROOM_NAME_MAX);
export const RoomTopic = text(ROOM_TOPIC_MAX);
/** Markdown source (A47), at most 4000 characters after trimming. */
export const MessageBody = text(MESSAGE_BODY_MAX);
/** A body that may be empty: the caption of a message with files. */
const OptionalBody = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .pipe(z.string().max(MESSAGE_BODY_MAX));

/** A single emoji (one RGI emoji, which includes flags, skin tones, and families). */
export const Emoji = z.string().regex(/^\p{RGI_Emoji}$/v, 'Use a single emoji.');

export const Room = z.object({
  id: Id,
  name: z.string(),
  topic: z.string().nullable(),
  /** Sidebar order, ascending. */
  position: z.number().int(),
  createdAt: z.iso.datetime(),
  /** Archived rooms are read-only and listed separately. */
  archivedAt: z.iso.datetime().nullable(),
});
export type Room = z.infer<typeof Room>;

export const Reaction = z.object({
  emoji: z.string(),
  /** In the order they reacted. */
  userIds: z.array(Id),
});
export type Reaction = z.infer<typeof Reaction>;

/** Enough of the message being replied to for the quote above a reply. */
export const ReplyPreview = z.object({
  id: Id,
  authorId: Id,
  /** The first characters of its body; empty when it was deleted. */
  excerpt: z.string(),
  deleted: z.boolean(),
});
export type ReplyPreview = z.infer<typeof ReplyPreview>;

export const Message = z.object({
  id: Id,
  roomId: Id,
  authorId: Id,
  /** Markdown source; empty once deleted ("Bu mesaj silindi."). */
  body: z.string(),
  replyTo: ReplyPreview.nullable(),
  /** Users mentioned with @username. */
  mentions: z.array(Id),
  mentionsEveryone: z.boolean(),
  reactions: z.array(Reaction),
  /** Files, in the order they were attached; none once deleted. */
  attachments: z.array(Attachment),
  /** Previews of its first links, once the server has fetched them (A24). */
  previews: z.array(LinkPreview),
  createdAt: z.iso.datetime(),
  /** Shown as "düzenlendi" (A22). */
  editedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
});
export type Message = z.infer<typeof Message>;

// ---- HTTP ------------------------------------------------------------------------------------

/** A room as one member sees it: with their unread state. */
export const RoomWithState = Room.extend({
  lastReadMessageId: Id.nullable(),
  /** Messages by others after the read marker. */
  unreadCount: z.number().int().nonnegative(),
  /** Of those, how many mention this member or @everyone. */
  unreadMentionCount: z.number().int().nonnegative(),
});
export type RoomWithState = z.infer<typeof RoomWithState>;

export const RoomList = z.object({ rooms: z.array(RoomWithState) });
export type RoomList = z.infer<typeof RoomList>;

export const CreateRoomRequest = z.object({ name: RoomName, topic: RoomTopic.optional() });
export type CreateRoomRequest = z.input<typeof CreateRoomRequest>;

/** Rename, or change the topic (null clears it). */
export const UpdateRoomRequest = z
  .object({ name: RoomName.optional(), topic: RoomTopic.nullable().optional() })
  .refine((r) => r.name !== undefined || r.topic !== undefined, 'Nothing to change.');
export type UpdateRoomRequest = z.input<typeof UpdateRoomRequest>;

export const SendMessageRequest = z
  .object({
    /**
     * Made by the client (UUIDv7), so a retry after a network blip sends the same id and can't
     * create a duplicate (ARCHITECTURE §3.4).
     */
    id: Id,
    /** May be empty when files are attached. */
    body: OptionalBody,
    replyToId: Id.optional(),
    /** Files uploaded with `POST /files` by the sender and not attached anywhere yet. */
    attachmentIds: z.array(Id).max(ATTACHMENTS_MAX).default([]),
  })
  .refine((r) => r.body.length > 0 || r.attachmentIds.length > 0, {
    message: 'Write something or attach a file.',
    path: ['body'],
  })
  .refine((r) => new Set(r.attachmentIds).size === r.attachmentIds.length, {
    message: 'A file is attached twice.',
    path: ['attachmentIds'],
  });
export type SendMessageRequest = z.input<typeof SendMessageRequest>;

/** The body may become empty only on a message with files (the server checks). */
export const EditMessageRequest = z.object({ body: OptionalBody });
export type EditMessageRequest = z.input<typeof EditMessageRequest>;

/** `GET /rooms/:id/messages?before=<id>&limit=<n>`: newest first is the last element. */
export const MessagePageQuery = z.object({
  before: Id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessagePageQuery = z.input<typeof MessagePageQuery>;

export const MessagePage = z.object({
  /** Oldest first. */
  messages: z.array(Message),
  /** True when older messages exist before the first one. */
  hasMore: z.boolean(),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const MarkReadRequest = z.object({ messageId: Id });
export type MarkReadRequest = z.infer<typeof MarkReadRequest>;
