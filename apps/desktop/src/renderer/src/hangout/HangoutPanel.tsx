import { useEffect, useRef, useState } from 'react';
import type { User } from '@hasbihal/protocol';
import { Avatar } from '../components/Avatar.tsx';
import { useChat, useChatState, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import { screenVolumeKey, type ParticipantView, type ShareView } from './session.ts';
import { SharePicker } from './SharePicker.tsx';
import { VoiceSettingsFields } from './VoiceSettings.tsx';
import { Popover } from '../components/Popover.tsx';
import { rangeFill } from '../components/range.ts';
import {
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from 'lucide-react';
import { Icon } from '../components/Icon.tsx';

/**
 * The voice and video half of a combined room (A11): a bar to join, showing who is there, or,
 * once joined, the call itself (ARCHITECTURE §6).
 */
export function HangoutPanel({ roomId }: { roomId: string }) {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const state = useChatState();
  const here = state.hangouts.get(roomId) ?? [];
  // A14: one share can fill the hangout area; by user id.
  const [focused, setFocused] = useState<string | null>(null);

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
        <button
          type="button"
          className={here.length ? 'button button--primary' : 'button'}
          disabled={call.status === 'connecting'}
          onClick={() => void hangout.join(roomId)}
        >
          <Icon icon={Headphones} /> {t('hangout.join')}
        </button>
        {call.notice === 'hangout.joinFailed' && (
          <span className="field__error">{t(call.notice)}</span>
        )}
      </div>
    );
  }

  const focusedShare = call.shares.find((s) => s.userId === focused && s.track);
  const tiles = call.participants.length + call.shares.length;
  return (
    <section
      className={focusedShare ? 'stage stage--focused' : 'stage'}
      aria-label={t('hangout.join')}
    >
      {call.status !== 'connected' && (
        <p className="stage__status">
          {call.status === 'reconnecting' ? t('hangout.reconnecting') : t('hangout.connecting')}
        </p>
      )}
      <div className="stage__grid" data-count={Math.min(tiles, 9)}>
        {call.shares.map((share) => (
          <ShareTile
            key={`share:${share.userId}`}
            share={share}
            member={state.members.get(share.userId)}
            focused={focusedShare === share}
            onFocus={(on) => {
              setFocused(on ? share.userId : null);
            }}
          />
        ))}
        {call.participants.map((p) => (
          <Tile key={p.userId} participant={p} member={state.members.get(p.userId)} />
        ))}
      </div>
      {call.notice && call.notice !== 'hangout.joinFailed' && (
        <p className="stage__notice">{t(call.notice)}</p>
      )}
      <Controls />
    </section>
  );
}

function Tile({ participant, member }: { participant: ParticipantView; member: User | undefined }) {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const video = useRef<HTMLVideoElement>(null);
  const track = participant.camera;

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
  return (
    <div
      className="tile"
      data-speaking={participant.speaking ? true : undefined}
      data-testid="tile"
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
        {participant.micMuted && (
          <Icon icon={MicOff} label={t('hangout.muted')} data-testid="tile-muted" />
        )}
        <span>{name}</span>
      </div>
      {!participant.isLocal && (
        // A29: a volume per person, remembered.
        <input
          className="tile__volume"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={volume}
          style={rangeFill(volume, 0, 2)}
          aria-label={t('settings.volume', { name })}
          onChange={(e) => {
            hangout.setVolume(participant.userId, Number(e.target.value));
          }}
        />
      )}
    </div>
  );
}

/** A screen share's tile (A14): watch it, enlarge it, take it full screen, set its sound. */
function ShareTile({
  share,
  member,
  focused,
  onFocus,
}: {
  share: ShareView;
  member: User | undefined;
  focused: boolean;
  onFocus: (on: boolean) => void;
}) {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const tile = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { track } = share;

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
      data-focused={focused ? true : undefined}
      data-testid="share-tile"
      onDoubleClick={() => {
        if (track) void tile.current?.requestFullscreen();
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
        <span>{label}</span>
      </div>
      {track && (
        <div className="tile__actions">
          <button
            type="button"
            className="tile__action"
            onClick={() => {
              onFocus(!focused);
            }}
          >
            {focused ? t('share.shrink') : t('share.enlarge')}
          </button>
          <button
            type="button"
            className="tile__action"
            onClick={() => void tile.current?.requestFullscreen()}
          >
            {t('share.fullscreen')}
          </button>
          {!share.isLocal && (
            <button
              type="button"
              className="tile__action"
              onClick={() => {
                onFocus(false);
                hangout.watch(share.userId, false);
              }}
            >
              {t('share.stopWatching')}
            </button>
          )}
        </div>
      )}
      {track && !share.isLocal && share.hasAudio && (
        <input
          className="tile__volume"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={volume}
          style={rangeFill(volume, 0, 2)}
          aria-label={t('share.volume', { name })}
          onChange={(e) => {
            hangout.setVolume(screenVolumeKey(share.userId), Number(e.target.value));
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
      <button
        type="button"
        className="round-button"
        data-off={call.micMuted || call.micUnavailable ? true : undefined}
        disabled={call.micUnavailable}
        aria-label={call.micMuted ? t('hangout.unmute') : t('hangout.mute')}
        title={call.micMuted ? t('hangout.unmute') : t('hangout.mute')}
        onClick={() => void hangout.toggleMute()}
      >
        <Icon icon={call.micMuted ? MicOff : Mic} />
      </button>
      <button
        type="button"
        className="round-button"
        data-off={call.deafened ? true : undefined}
        aria-label={call.deafened ? t('hangout.undeafen') : t('hangout.deafen')}
        title={call.deafened ? t('hangout.undeafen') : t('hangout.deafen')}
        onClick={() => void hangout.toggleDeafen()}
      >
        <Icon icon={call.deafened ? HeadphoneOff : Headphones} />
      </button>
      <button
        type="button"
        className="round-button"
        data-on={call.cameraOn ? true : undefined}
        aria-label={call.cameraOn ? t('hangout.cameraOff') : t('hangout.cameraOn')}
        title={call.cameraOn ? t('hangout.cameraOff') : t('hangout.cameraOn')}
        onClick={() => void hangout.toggleCamera()}
      >
        <Icon icon={call.cameraOn ? Video : VideoOff} />
      </button>
      <button
        type="button"
        className="round-button"
        data-on={call.sharing ? true : undefined}
        aria-label={call.sharing ? t('hangout.stopShare') : t('hangout.share')}
        title={call.sharing ? t('hangout.stopShare') : t('hangout.share')}
        onClick={() => {
          if (call.sharing) void hangout.stopScreenShare();
          else setPicking(true);
        }}
      >
        <Icon icon={call.sharing ? ScreenShareOff : ScreenShare} />
      </button>
      <Popover
        label={t('hangout.settings')}
        placement="above"
        className="voice-settings__popover"
        trigger={(props) => (
          <button
            type="button"
            className="round-button"
            aria-label={t('hangout.settings')}
            title={t('hangout.settings')}
            {...props}
          >
            <Icon icon={Settings} />
          </button>
        )}
      >
        {() => <VoiceSettingsFields />}
      </Popover>
      <button
        type="button"
        className="round-button round-button--leave"
        aria-label={t('hangout.leave')}
        title={t('hangout.leave')}
        onClick={() => void hangout.leave()}
      >
        <Icon icon={PhoneOff} />
      </button>
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
