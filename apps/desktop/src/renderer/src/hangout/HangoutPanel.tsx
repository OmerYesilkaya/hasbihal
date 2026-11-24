import { useEffect, useRef, useState, type RefObject } from 'react';
import type { User } from '@hasbihal/protocol';
import { Avatar } from '../components/Avatar.tsx';
import { useChat, useChatState, useHangout, useKnocking } from '../chat/context.tsx';
import { toastError } from '../components/toast.ts';
import { useT } from '../i18n.tsx';
import { screenVolumeKey, type ParticipantView, type ShareView } from './session.ts';
import { SharePicker } from './SharePicker.tsx';
import { VoiceSettingsFields } from './VoiceSettings.tsx';
import { Popover } from '../components/Popover.tsx';
import {
  DoorClosed,
  HeadphoneOff,
  Headphones,
  Lock,
  Mic,
  MicOff,
  PhoneOff,
  Pin,
  PinOff,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { Slider } from '../components/controls.tsx';
import { Tip } from '../components/Tip.tsx';

/**
 * The voice and video half of a combined room (A11): a bar to join, showing who is there, or,
 * once joined, the call itself (ARCHITECTURE §6).
 */
export function HangoutPanel({ roomId }: { roomId: string }) {
  const t = useT();
  const { hangout, client, knocking } = useChat();
  const call = useHangout();
  const state = useChatState();
  const waiting = useKnocking().has(roomId);
  const here = state.hangouts.get(roomId) ?? [];
  // A55: a Mahrem room's call is for its list; everyone else knocks.
  const list = state.rooms.get(roomId)?.mahremMemberIds ?? [];
  const mahrem = list.length > 0;
  const mustKnock = mahrem && !list.includes(state.me?.id ?? '');

  const knock = async () => {
    const result = await client.rooms.knock(roomId);
    if (!result.ok) {
      toastError(
        t(result.error.code === 'rate_limited' ? 'mahrem.knockTooSoon' : 'error.unexpected'),
      );
      return;
    }
    if (result.value.delivered) knocking.start(roomId);
    else toastError(t('mahrem.knockNoOne'));
  };
  if (call.roomId !== roomId) {
    return (
      <div className="hangout-bar">
        {here.length > 0 && (
          <div className="hangout-bar__people">
            {here.slice(0, 6).map((p) => {
              const member = state.members.get(p.userId);
              return member ? <Avatar key={p.userId} user={member} /> : null;
            })}
            <span>{t('hangout.inRoom', { count: here.length })}</span>
          </div>
        )}
        {mustKnock ? (
          <button
            type="button"
            className="button"
            disabled={waiting}
            data-testid="knock"
            onClick={() => void knock()}
          >
            <Icon icon={DoorClosed} /> {waiting ? t('mahrem.waiting') : t('mahrem.knock')}
          </button>
        ) : (
          <button
            type="button"
            className={here.length ? 'button button--primary' : 'button'}
            disabled={call.status === 'connecting'}
            onClick={() => void hangout.join(roomId)}
          >
            <Icon icon={Headphones} /> {t('hangout.join')}
          </button>
        )}
        {mahrem && (
          <span className="hangout-bar__mahrem" data-testid="mahrem-hint">
            <Icon icon={Lock} /> {t('mahrem.callHint')}
          </span>
        )}
      </div>
    );
  }

  return <Stage />;
}

/** A tile on the stage: someone's camera (or avatar), or a screen share. */
type TileKey = `camera:${string}` | `share:${string}`;

/**
 * The call's picture (#58). One tile can fill the stage, with everyone else in a strip below:
 * the tile you pinned, or else the newest share by someone else (not watched yet, it offers to
 * watch). Your own share never fills it by itself. With neither, everyone shares a grid.
 */
function Stage() {
  const t = useT();
  const call = useHangout();
  const state = useChatState();
  const [pinned, setPinned] = useState<TileKey | null>(null);
  const keys: TileKey[] = [
    ...call.shares.map((s): TileKey => `share:${s.userId}`),
    ...call.participants.map((p): TileKey => `camera:${p.userId}`),
  ];
  // Whoever was pinned left (or stopped sharing): unpin, so they don't come back pinned.
  if (pinned && !keys.includes(pinned)) setPinned(null);
  const newestShare = call.shares.findLast((s) => !s.isLocal);
  const main =
    pinned && keys.includes(pinned)
      ? pinned
      : newestShare
        ? (`share:${newestShare.userId}` as const)
        : null;

  const tile = (key: TileKey, isMain: boolean) => {
    const pin = {
      pinned: key === pinned,
      onPin: () => {
        setPinned((current) => (current === key ? null : key));
      },
      isMain,
    };
    if (key.startsWith('share:')) {
      const share = call.shares.find((s) => `share:${s.userId}` === key);
      return share ? (
        <ShareTile key={key} share={share} member={state.members.get(share.userId)} {...pin} />
      ) : null;
    }
    const participant = call.participants.find((p) => `camera:${p.userId}` === key);
    return participant ? (
      <Tile
        key={key}
        participant={participant}
        member={state.members.get(participant.userId)}
        {...pin}
      />
    ) : null;
  };

  return (
    <section className="stage" aria-label={t('hangout.join')}>
      {call.status !== 'connected' && (
        <p className="stage__status">
          {call.status === 'reconnecting' ? t('hangout.reconnecting') : t('hangout.connecting')}
        </p>
      )}
      {/* One container either way: a tile moving between the stage and the strip keeps its
          element, so its video doesn't restart. */}
      <div
        className="stage__grid"
        data-focus={main ? true : undefined}
        data-count={Math.min(keys.length, 9)}
      >
        {main && tile(main, true)}
        {keys.filter((k) => k !== main).map((k) => tile(k, false))}
      </div>
      <Controls />
    </section>
  );
}

interface PinProps {
  pinned: boolean;
  onPin: () => void;
  /** Filling the stage. */
  isMain: boolean;
}

/** Full screen for one tile; Esc or the system's own controls can leave it too. */
function useFullscreen(tile: RefObject<HTMLDivElement | null>): [boolean, () => void] {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const follow = () => {
      setIsFullscreen(document.fullscreenElement === tile.current);
    };
    document.addEventListener('fullscreenchange', follow);
    return () => {
      document.removeEventListener('fullscreenchange', follow);
    };
  }, [tile]);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void tile.current?.requestFullscreen();
  };
  return [isFullscreen, toggle];
}

function PinAction({ pinned, onPin }: Pick<PinProps, 'pinned' | 'onPin'>) {
  const t = useT();
  return (
    <button type="button" className="tile__action" aria-pressed={pinned} onClick={onPin}>
      <Icon icon={pinned ? PinOff : Pin} /> {pinned ? t('hangout.unpin') : t('hangout.pin')}
    </button>
  );
}

function Tile({
  participant,
  member,
  pinned,
  onPin,
  isMain,
}: { participant: ParticipantView; member: User | undefined } & PinProps) {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const tile = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = participant.camera;
  const [isFullscreen, toggleFullscreen] = useFullscreen(tile);

  useEffect(() => {
    const el = video.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  const name = participant.isLocal ? t('hangout.you') : (member?.displayName ?? '?');
  const volume = call.settings.volumes[participant.userId] ?? 1;
  // Someone else's camera, big enough to want bigger.
  const canFullscreen = track !== null && !participant.isLocal && isMain;
  return (
    <div
      ref={tile}
      className="tile"
      data-main={isMain ? true : undefined}
      data-speaking={participant.speaking ? true : undefined}
      data-pinned={pinned ? true : undefined}
      data-testid="tile"
      onDoubleClick={() => {
        if (canFullscreen) toggleFullscreen();
      }}
    >
      {track ? (
        <video
          ref={video}
          className="tile__video"
          data-mirrored={participant.isLocal ? true : undefined}
          muted
          playsInline
        />
      ) : (
        member && <Avatar user={member} large />
      )}
      <div className="tile__label">
        {pinned && <Icon icon={Pin} />}
        {participant.micMuted && (
          <Icon icon={MicOff} label={t('hangout.muted')} data-testid="tile-muted" />
        )}
        <span>{name}</span>
      </div>
      <div className="tile__actions">
        <PinAction pinned={pinned} onPin={onPin} />
        {canFullscreen && (
          <button type="button" className="tile__action" onClick={toggleFullscreen}>
            {isFullscreen ? t('share.exitFullscreen') : t('share.fullscreen')}
          </button>
        )}
      </div>
      {!participant.isLocal && (
        // A29: a volume per person, remembered.
        <Slider
          className="tile__volume"
          label={t('settings.volume', { name })}
          min={0}
          max={2}
          step={0.05}
          value={volume}
          onChange={(value) => {
            hangout.setVolume(participant.userId, value);
          }}
        />
      )}
    </div>
  );
}

/**
 * A screen share's tile (A14): watch it, pin it, take it full screen, set its sound. Your own
 * is only a reminder that you're sharing (#58): never full screen, never enlarged by itself.
 */
function ShareTile({
  share,
  member,
  pinned,
  onPin,
  isMain,
}: { share: ShareView; member: User | undefined } & PinProps) {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const tile = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { track } = share;
  const [isFullscreen, toggleFullscreen] = useFullscreen(tile);
  const canFullscreen = track !== null && !share.isLocal;

  useEffect(() => {
    const el = video.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  const name = member?.displayName ?? '?';
  const label = share.isLocal ? t('share.yours') : t('share.of', { name });
  const volume = call.settings.volumes[screenVolumeKey(share.userId)] ?? 1;
  return (
    <div
      ref={tile}
      className="tile tile--share"
      data-main={isMain ? true : undefined}
      data-pinned={pinned ? true : undefined}
      data-testid="share-tile"
      data-fullscreen={isFullscreen ? true : undefined}
      onDoubleClick={() => {
        if (canFullscreen) toggleFullscreen();
      }}
    >
      {track ? (
        <video ref={video} className="tile__video" muted playsInline />
      ) : (
        <div className="tile__watch">
          <span className="live-badge">{t('share.live')}</span>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              hangout.watch(share.userId, true);
            }}
          >
            {t('share.watch')}
          </button>
        </div>
      )}
      <div className="tile__label">
        {pinned && <Icon icon={Pin} />}
        <span>{label}</span>
      </div>
      <div className="tile__actions">
        <PinAction pinned={pinned} onPin={onPin} />
        {canFullscreen && (
          <button type="button" className="tile__action" onClick={toggleFullscreen}>
            {isFullscreen ? t('share.exitFullscreen') : t('share.fullscreen')}
          </button>
        )}
        {track && !share.isLocal && (
          <button
            type="button"
            className="tile__action"
            onClick={() => {
              hangout.watch(share.userId, false);
            }}
          >
            {t('share.stopWatching')}
          </button>
        )}
      </div>
      {track && !share.isLocal && share.hasAudio && (
        <Slider
          className="tile__volume"
          label={t('share.volume', { name })}
          min={0}
          max={2}
          step={0.05}
          value={volume}
          onChange={(value) => {
            hangout.setVolume(screenVolumeKey(share.userId), value);
          }}
        />
      )}
    </div>
  );
}

function Controls() {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const [picking, setPicking] = useState(false);
  return (
    <div className="stage__controls">
      <Tip label={call.micMuted ? t('hangout.unmute') : t('hangout.mute')}>
        <button
          type="button"
          className="round-button"
          data-off={call.micMuted || call.micUnavailable ? true : undefined}
          disabled={call.micUnavailable}
          aria-label={call.micMuted ? t('hangout.unmute') : t('hangout.mute')}
          onClick={() => void hangout.toggleMute()}
        >
          <Icon icon={call.micMuted ? MicOff : Mic} />
        </button>
      </Tip>
      <Tip label={call.deafened ? t('hangout.undeafen') : t('hangout.deafen')}>
        <button
          type="button"
          className="round-button"
          data-off={call.deafened ? true : undefined}
          aria-label={call.deafened ? t('hangout.undeafen') : t('hangout.deafen')}
          onClick={() => void hangout.toggleDeafen()}
        >
          <Icon icon={call.deafened ? HeadphoneOff : Headphones} />
        </button>
      </Tip>
      <Tip label={call.cameraOn ? t('hangout.cameraOff') : t('hangout.cameraOn')}>
        <button
          type="button"
          className="round-button"
          data-on={call.cameraOn ? true : undefined}
          aria-label={call.cameraOn ? t('hangout.cameraOff') : t('hangout.cameraOn')}
          onClick={() => void hangout.toggleCamera()}
        >
          <Icon icon={call.cameraOn ? Video : VideoOff} />
        </button>
      </Tip>
      <Tip label={call.sharing ? t('hangout.stopShare') : t('hangout.share')}>
        <button
          type="button"
          className="round-button"
          data-on={call.sharing ? true : undefined}
          aria-label={call.sharing ? t('hangout.stopShare') : t('hangout.share')}
          onClick={() => {
            if (call.sharing) void hangout.stopScreenShare();
            else setPicking(true);
          }}
        >
          <Icon icon={call.sharing ? ScreenShareOff : ScreenShare} />
        </button>
      </Tip>
      <Popover
        label={t('hangout.settings')}
        placement="above"
        className="voice-settings__popover"
        trigger={
          <Tip label={t('hangout.settings')}>
            <button type="button" className="round-button" aria-label={t('hangout.settings')}>
              <Icon icon={Settings} />
            </button>
          </Tip>
        }
      >
        {() => <VoiceSettingsFields />}
      </Popover>
      <Tip label={t('hangout.leave')}>
        <button
          type="button"
          className="round-button round-button--leave"
          aria-label={t('hangout.leave')}
          onClick={() => void hangout.leave()}
        >
          <Icon icon={PhoneOff} />
        </button>
      </Tip>
      {picking && (
        <SharePicker
          onClose={() => {
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
