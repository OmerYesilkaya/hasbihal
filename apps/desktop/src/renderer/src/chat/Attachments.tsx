import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '@hasbihal/protocol';
import { formatDuration, formatSize, useFileAddresses } from '../files.ts';
import { locale, useT } from '../i18n.tsx';
import { useChat } from './context.tsx';

/** Photos and videos lay out within this box; the viewer shows them full size. */
const BOX = { width: 360, height: 300 };

const visual = (a: Attachment) => a.kind === 'image' || a.kind === 'video';

/** A message's files (A26): photos and videos inline, sound with a player, the rest as cards. */
export function Attachments({ attachments }: { attachments: Attachment[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const media = attachments.filter(visual);
  const others = attachments.filter((a) => !visual(a));
  const viewed = viewing === null ? undefined : media[viewing];
  return (
    <div className="attachments">
      {media.length > 0 && (
        <div className="attachments__media" data-count={Math.min(media.length, 4)}>
          {media.map((a, i) => (
            <MediaThumb
              key={a.id}
              attachment={a}
              single={media.length === 1}
              onOpen={() => {
                setViewing(i);
              }}
            />
          ))}
        </div>
      )}
      {others.map((a) =>
        a.kind === 'voice' ? (
          <VoicePlayer key={a.id} attachment={a} />
        ) : a.kind === 'audio' ? (
          <AudioPlayer key={a.id} attachment={a} />
        ) : (
          <FileCard key={a.id} attachment={a} />
        ),
      )}
      {viewed && viewing !== null && (
        <MediaViewer
          items={media}
          index={viewing}
          onIndex={setViewing}
          onClose={() => {
            setViewing(null);
          }}
        />
      )}
    </div>
  );
}

/** The size a photo takes in the conversation: its own shape, fitted in the box. */
function fitted(a: Attachment, single: boolean) {
  if (!single || !a.width || !a.height) return undefined;
  const scale = Math.min(1, BOX.width / a.width, BOX.height / a.height);
  return { width: Math.round(a.width * scale), height: Math.round(a.height * scale) };
}

function MediaThumb({
  attachment,
  single,
  onOpen,
}: {
  attachment: Attachment;
  single: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const { info } = useChat();
  const addresses = useFileAddresses(info.serverUrl, attachment.id);
  // GIFs play (A23): their thumbnail would be a still.
  const src =
    attachment.mime === 'image/gif' ? addresses?.original : (addresses?.thumbnail ?? undefined);
  const size = fitted(attachment, single);
  return (
    <button
      type="button"
      className="media-thumb"
      style={size}
      data-testid="attachment-media"
      aria-label={attachment.name}
      title={attachment.name}
      onClick={onOpen}
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : attachment.kind === 'video' && addresses ? (
        // No poster frame (no ffmpeg on the server): the video's own first frame.
        <video src={`${addresses.original}#t=0.1`} preload="metadata" muted />
      ) : (
        <span className="media-thumb__placeholder" />
      )}
      {attachment.kind === 'video' && (
        <span className="media-thumb__play" aria-hidden>
          ▶{attachment.durationMs !== null && <span>{formatDuration(attachment.durationMs)}</span>}
        </span>
      )}
      <span className="visually-hidden">
        {attachment.kind === 'video' ? t('attachment.video') : t('attachment.photo')}
      </span>
    </button>
  );
}

/** A voice message (A22): play and pause, where it is, and how long it is. */
function VoicePlayer({ attachment }: { attachment: Attachment }) {
  const t = useT();
  const { info } = useChat();
  const addresses = useFileAddresses(info.serverUrl, attachment.id);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // Recorded WebM often has no duration in its header ("Infinity"): the recorder's measurement.
  const total = attachment.durationMs ?? 0;
  return (
    <div className="voice" data-testid="voice-message" data-playing={playing ? true : undefined}>
      <button
        type="button"
        className="voice__play"
        disabled={!addresses}
        aria-label={playing ? t('voice.pause') : t('voice.play')}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play();
          else el.pause();
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        className="voice__seek"
        type="range"
        min={0}
        max={Math.max(total, 1)}
        step={100}
        value={Math.min(position, total)}
        aria-label={t('voice.message')}
        onChange={(e) => {
          const el = audio.current;
          if (el) el.currentTime = Number(e.target.value) / 1000;
        }}
      />
      <span className="voice__time">
        {formatDuration(playing || position > 0 ? position : total)}
      </span>
      {addresses && (
        <audio
          ref={audio}
          src={addresses.original}
          preload="metadata"
          onPlay={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => {
            setPosition(e.currentTarget.currentTime * 1000);
          }}
        />
      )}
    </div>
  );
}

function AudioPlayer({ attachment }: { attachment: Attachment }) {
  const { info } = useChat();
  const addresses = useFileAddresses(info.serverUrl, attachment.id);
  return (
    <div className="file-card file-card--audio" data-testid="attachment-file">
      <span className="file-card__name">{attachment.name}</span>
      {addresses && <audio controls preload="metadata" src={addresses.original} />}
    </div>
  );
}

function FileCard({ attachment }: { attachment: Attachment }) {
  const t = useT();
  const { info } = useChat();
  const addresses = useFileAddresses(info.serverUrl, attachment.id);
  return (
    <div className="file-card" data-testid="attachment-file">
      <span className="file-card__icon" aria-hidden>
        📄
      </span>
      <span className="file-card__text">
        <span className="file-card__name">{attachment.name}</span>
        <span className="file-card__size">{formatSize(attachment.size, locale)}</span>
      </span>
      {addresses && (
        <a className="button" href={addresses.original} download={attachment.name}>
          {t('attachment.download')}
        </a>
      )}
    </div>
  );
}

/** Full size, one at a time, with the arrow keys moving between a message's photos and videos. */
function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: Attachment[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { info } = useChat();
  const dialog = useRef<HTMLDialogElement>(null);
  const item = items[index];
  const addresses = useFileAddresses(info.serverUrl, item?.id ?? null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  if (!item) return null;
  const step = (by: number) => {
    onIndex((index + by + items.length) % items.length);
  };
  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={item.name}
      data-testid="viewer"
      onClose={onClose}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') step(1);
        else if (e.key === 'ArrowLeft') step(-1);
      }}
      onClick={(e) => {
        // A click on the dark backdrop, not on the picture, closes it.
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
    >
      <div className="viewer__bar">
        <span className="viewer__name">
          {item.name}
          {items.length > 1 && ` · ${String(index + 1)} / ${String(items.length)}`}
        </span>
        {addresses && (
          <a className="viewer__action" href={addresses.original} download={item.name}>
            {t('attachment.download')}
          </a>
        )}
        <button
          type="button"
          className="viewer__action"
          onClick={() => dialog.current?.close()}
          aria-label={t('attachment.close')}
        >
          ✕
        </button>
      </div>
      {addresses &&
        (item.kind === 'video' ? (
          <video
            key={item.id}
            className="viewer__media"
            src={addresses.original}
            controls
            autoPlay
          />
        ) : (
          <img key={item.id} className="viewer__media" src={addresses.original} alt={item.name} />
        ))}
      {items.length > 1 && (
        <>
          <button
            type="button"
            className="viewer__step viewer__step--back"
            aria-label={t('attachment.previous')}
            onClick={() => {
              step(-1);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="viewer__step viewer__step--next"
            aria-label={t('attachment.next')}
            onClick={() => {
              step(1);
            }}
          >
            ›
          </button>
        </>
      )}
    </dialog>
  );
}
