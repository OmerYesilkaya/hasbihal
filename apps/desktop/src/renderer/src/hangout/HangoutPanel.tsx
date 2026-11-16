import { useEffect, useRef, useState } from 'react';
import type { User } from '@hasbihal/protocol';
import { Avatar } from '../components/Avatar.tsx';
import { useChat, useChatState, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import type { ParticipantView } from './session.ts';
import { VoiceSettingsPanel } from './VoiceSettings.tsx';

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
          🎙 {t('hangout.join')}
        </button>
        {call.notice === 'hangout.joinFailed' && (
          <span className="field__error">{t(call.notice)}</span>
        )}
      </div>
    );
  }

  return (
    <section className="stage" aria-label={t('hangout.join')}>
      {call.status !== 'connected' && (
        <p className="stage__status">
          {call.status === 'reconnecting' ? t('hangout.reconnecting') : t('hangout.connecting')}
        </p>
      )}
      <div className="stage__grid" data-count={Math.min(call.participants.length, 9)}>
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
        {participant.micMuted && <span aria-label={t('hangout.unmute')}>🔇</span>}
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
          aria-label={t('settings.volume', { name })}
          onChange={(e) => {
            hangout.setVolume(participant.userId, Number(e.target.value));
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        {call.micMuted ? '🔇' : '🎙'}
      </button>
      <button
        type="button"
        className="round-button"
        data-off={call.deafened ? true : undefined}
        aria-label={call.deafened ? t('hangout.undeafen') : t('hangout.deafen')}
        title={call.deafened ? t('hangout.undeafen') : t('hangout.deafen')}
        onClick={() => void hangout.toggleDeafen()}
      >
        {call.deafened ? '🔕' : '🎧'}
      </button>
      <button
        type="button"
        className="round-button"
        data-on={call.cameraOn ? true : undefined}
        aria-label={call.cameraOn ? t('hangout.cameraOff') : t('hangout.cameraOn')}
        title={call.cameraOn ? t('hangout.cameraOff') : t('hangout.cameraOn')}
        onClick={() => void hangout.toggleCamera()}
      >
        📷
      </button>
      <button
        type="button"
        className="round-button"
        aria-label={t('hangout.settings')}
        title={t('hangout.settings')}
        aria-expanded={settingsOpen}
        onClick={() => {
          setSettingsOpen((open) => !open);
        }}
      >
        ⚙
      </button>
      <button
        type="button"
        className="round-button round-button--leave"
        aria-label={t('hangout.leave')}
        title={t('hangout.leave')}
        onClick={() => void hangout.leave()}
      >
        ✕
      </button>
      {settingsOpen && (
        <VoiceSettingsPanel
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}
