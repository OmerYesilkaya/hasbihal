import {
  EventWindow,
  FileUrls,
  HangoutToken,
  AccessList,
  AllowedEmail,
  MemberList,
  Message,
  MessagePage,
  NudgeResult,
  Room,
  RoomEvent,
  RoomList,
  RoomPrefs,
  SearchResults,
  SessionList,
  User,
  type ChangeRoleRequest,
  type AllowEmailRequest,
  type CreateRoomRequest,
  type EditMessageRequest,
  type EventWindowQuery,
  type FileUrlsRequest,
  type MarkReadRequest,
  type MessagePageQuery,
  type NudgeRequest,
  type OccurrenceChange,
  type RsvpRequest,
  type SaveEventRequest,
  type SearchQuery,
  type SendMessageRequest,
  type UpdateProfileRequest,
  type UpdateRoomRequest,
} from '@hasbihal/protocol';
import { request } from './api.ts';

/** `?a=1&b=2` from a query object, leaving out what's undefined; '' when nothing is left. */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

const segment = encodeURIComponent;

/** A query whose `limit` is coerced from text on the server, typed here as the number it is. */
type Paged<Q extends { limit?: unknown }> = Omit<Q, 'limit'> & { limit?: number };

/**
 * The server's HTTP API, one function per endpoint (#46): the path, method, request body type
 * and response schema (from `@hasbihal/protocol`) are written here once, and type-checked, rather
 * than at every call. Each returns `ApiResult`: `{ ok, value }` or `{ ok: false, error }`, never
 * throwing. Endpoints whose answer no one reads don't parse it.
 */
export function createClient(serverUrl: string) {
  return {
    me: {
      update: (body: UpdateProfileRequest) =>
        request(serverUrl, 'PATCH', '/me', { body, schema: User }),
      /** `form` holds the photo as `file`. */
      setAvatar: (form: FormData) =>
        request(serverUrl, 'PUT', '/me/avatar', { body: form, schema: User }),
      removeAvatar: () => request(serverUrl, 'DELETE', '/me/avatar', { schema: User }),
      sessions: () => request(serverUrl, 'GET', '/me/sessions', { schema: SessionList }),
      revokeSession: (sessionId: string) =>
        request(serverUrl, 'DELETE', `/me/sessions/${segment(sessionId)}`),
    },

    members: {
      list: () => request(serverUrl, 'GET', '/members', { schema: MemberList }),
    },

    rooms: {
      list: () => request(serverUrl, 'GET', '/rooms', { schema: RoomList }),
      create: (body: CreateRoomRequest) =>
        request(serverUrl, 'POST', '/rooms', { body, schema: Room }),
      update: (roomId: string, body: UpdateRoomRequest) =>
        request(serverUrl, 'PATCH', `/rooms/${segment(roomId)}`, { body }),
      archive: (roomId: string) => request(serverUrl, 'POST', `/rooms/${segment(roomId)}/archive`),
      unarchive: (roomId: string) =>
        request(serverUrl, 'POST', `/rooms/${segment(roomId)}/unarchive`),
      delete: (roomId: string) => request(serverUrl, 'DELETE', `/rooms/${segment(roomId)}`),
      markRead: (roomId: string, body: MarkReadRequest) =>
        request(serverUrl, 'POST', `/rooms/${segment(roomId)}/read`, { body }),
      setPrefs: (roomId: string, body: RoomPrefs) =>
        request(serverUrl, 'PUT', `/rooms/${segment(roomId)}/prefs`, { body, schema: RoomPrefs }),
      messages: (roomId: string, params: Paged<MessagePageQuery> = {}) =>
        request(serverUrl, 'GET', `/rooms/${segment(roomId)}/messages${query(params)}`, {
          schema: MessagePage,
        }),
      send: (roomId: string, body: SendMessageRequest) =>
        request(serverUrl, 'POST', `/rooms/${segment(roomId)}/messages`, {
          body,
          schema: Message,
        }),
      hangoutToken: (roomId: string) =>
        request(serverUrl, 'POST', `/rooms/${segment(roomId)}/hangout/token`, {
          schema: HangoutToken,
        }),
    },

    messages: {
      edit: (messageId: string, body: EditMessageRequest) =>
        request(serverUrl, 'PATCH', `/messages/${segment(messageId)}`, { body, schema: Message }),
      delete: (messageId: string) =>
        request(serverUrl, 'DELETE', `/messages/${segment(messageId)}`),
      react: (messageId: string, emoji: string) =>
        request(serverUrl, 'PUT', `/messages/${segment(messageId)}/reactions/${segment(emoji)}`),
      unreact: (messageId: string, emoji: string) =>
        request(serverUrl, 'DELETE', `/messages/${segment(messageId)}/reactions/${segment(emoji)}`),
    },

    search: (params: Paged<SearchQuery>) =>
      request(serverUrl, 'GET', `/search${query(params)}`, { schema: SearchResults }),

    files: {
      /** Where to fetch files from (A26): short-lived addresses, by file id. */
      urls: (body: FileUrlsRequest) =>
        request(serverUrl, 'POST', '/files/urls', { body, schema: FileUrls }),
    },

    nudge: (body: NudgeRequest) =>
      request(serverUrl, 'POST', '/nudges', { body, schema: NudgeResult }),

    events: {
      window: (params: EventWindowQuery) =>
        request(serverUrl, 'GET', `/events${query(params)}`, { schema: EventWindow }),
      create: (body: SaveEventRequest) =>
        request(serverUrl, 'POST', '/events', { body, schema: RoomEvent }),
      update: (eventId: string, body: SaveEventRequest) =>
        request(serverUrl, 'PUT', `/events/${segment(eventId)}`, { body, schema: RoomEvent }),
      delete: (eventId: string) => request(serverUrl, 'DELETE', `/events/${segment(eventId)}`),
      /** One date of an event, by its original start (`Occurrence.start`). */
      occurrence: (eventId: string, start: string) => {
        const base = `/events/${segment(eventId)}/occurrences/${segment(start)}`;
        return {
          /** Skip or move this date. */
          change: (body: OccurrenceChange) => request(serverUrl, 'PUT', base, { body }),
          /** Undo a skip or a move. */
          restore: () => request(serverUrl, 'DELETE', base),
          rsvp: (body: RsvpRequest) => request(serverUrl, 'PUT', `${base}/rsvp`, { body }),
          clearRsvp: () => request(serverUrl, 'DELETE', `${base}/rsvp`),
        };
      },
    },

    admin: {
      /** Who may join (A25): the list, the requests, and each member's Google address. */
      access: () => request(serverUrl, 'GET', '/admin/access', { schema: AccessList }),
      allowEmail: (body: AllowEmailRequest) =>
        request(serverUrl, 'POST', '/admin/allowed-emails', { body, schema: AllowedEmail }),
      removeAllowedEmail: (email: string) =>
        request(serverUrl, 'DELETE', `/admin/allowed-emails/${segment(email)}`),
      dismissRequest: (email: string) =>
        request(serverUrl, 'DELETE', `/admin/access-requests/${segment(email)}`),
      setRole: (userId: string, body: ChangeRoleRequest) =>
        request(serverUrl, 'PUT', `/admin/users/${segment(userId)}/role`, { body }),
      removeUser: (userId: string) =>
        request(serverUrl, 'POST', `/admin/users/${segment(userId)}/remove`),
    },
  };
}

export type Client = ReturnType<typeof createClient>;
