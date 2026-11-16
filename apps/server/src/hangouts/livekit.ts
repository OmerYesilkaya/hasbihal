import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { Id, type HangoutParticipant } from '@hasbihal/protocol';
import type { Snapshot } from './tracker.ts';

export interface LiveKitConfig {
  /** What clients connect to, e.g. wss://hasbihal.duckdns.org/livekit. */
  url: string;
  /** What the server calls LiveKit's API at, e.g. http://host.docker.internal:7880. */
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** The part of LiveKit's API the server uses; tests replace it. */
export interface LiveKitRooms {
  /** Everyone in every LiveKit room, keyed by our room id. */
  list(): Promise<Snapshot>;
}

/** Joining a room's hangout (ARCHITECTURE §6.1): 10 minutes to connect; LiveKit renews it after. */
export async function hangoutToken(
  config: LiveKitConfig,
  roomId: string,
  user: { id: string; displayName: string },
): Promise<string> {
  // Identity is the user, not the device: joining from another device takes over (as in Discord).
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: user.id,
    name: user.displayName,
    ttl: '10m',
  });
  token.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return token.toJwt();
}

export const trackKind = (source: TrackSource | undefined): 'camera' | 'screenShare' | undefined =>
  source === TrackSource.CAMERA
    ? 'camera'
    : source === TrackSource.SCREEN_SHARE
      ? 'screenShare'
      : undefined;

export function liveKitRooms(config: LiveKitConfig): LiveKitRooms {
  const client = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  return {
    async list() {
      const snapshot: Snapshot = new Map();
      for (const room of await client.listRooms()) {
        if (!Id.safeParse(room.name).success) continue; // not one of ours
        const people: HangoutParticipant[] = [];
        for (const p of await client.listParticipants(room.name)) {
          if (!Id.safeParse(p.identity).success) continue;
          const kinds = new Set(p.tracks.map((t) => trackKind(t.source)));
          people.push({
            userId: p.identity,
            joinedAt: new Date(Number(p.joinedAt) * 1000).toISOString(),
            camera: kinds.has('camera'),
            screenShare: kinds.has('screenShare'),
          });
        }
        if (people.length) snapshot.set(room.name, people);
      }
      return snapshot;
    },
  };
}
