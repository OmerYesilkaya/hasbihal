import { useEffect, useRef, useState } from 'react';
import type { MessageKey } from '@hasbihal/core';
import { VOICE_MAX_MS } from '@hasbihal/protocol';
import { formatDuration } from '../files.ts';
import { useT } from '../i18n.tsx';

/** Opus in WebM (ARCHITECTURE §7): small, and every client plays it. */
const MIME = 'audio/webm;codecs=opus';
/** Clear speech at a fraction of the size of music-grade audio. */
const BITRATE = 32_000;
/** Shorter than this is a slip of the finger, not a message. */
const MIN_MS = 700;

export interface Recording {
  file: File;
  durationMs: number;
}

/**
 * Records a voice message (A22) in place of the text field: a running clock, cancel, and send.
 * Recording starts as soon as it appears.
 */
export function VoiceRecorder({
  onSend,
  onCancel,
}: {
  onSend: (recording: Recording) => void;
  onCancel: (error?: MessageKey) => void;
}) {
  const t = useT();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const sendWhenStopped = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    // An object, not a let: the cleanup below changes it while the setup awaits the mic.
    const life = { cancelled: false };
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        onCancel('voice.micUnavailable');
        return;
      }
      if (life.cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: BITRATE });
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        for (const track of stream?.getTracks() ?? []) track.stop();
        if (!sendWhenStopped.current) return;
        const durationMs = performance.now() - startedAt.current;
        if (durationMs < MIN_MS) {
          onCancel('voice.tooShort');
          return;
        }
        const name = `sesli-mesaj-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.webm`;
        onSend({
          file: new File(chunks.current, name, { type: 'audio/webm' }),
          durationMs: Math.min(durationMs, VOICE_MAX_MS),
        });
      };
      rec.start(250);
      recorder.current = rec;
      startedAt.current = performance.now();
      setReady(true);
    })();
    return () => {
      life.cancelled = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
    // Runs once: the callbacks are read when recording ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (send: boolean) => {
    sendWhenStopped.current = send;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    if (!send) onCancel();
  };

  // The clock, and the five-minute limit.
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const ms = performance.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= VOICE_MAX_MS) finish(true);
    }, 200);
    return () => {
      clearInterval(timer);
    };
  });

  return (
    <div
      className="recorder"
      role="group"
      aria-label={t('voice.recording')}
      data-testid="recorder"
      onKeyDown={(e) => {
        if (e.key === 'Escape') finish(false);
        else if (e.key === 'Enter') finish(true);
      }}
    >
      <span className="recorder__dot" aria-hidden />
      <span className="recorder__time" data-testid="recorder-time">
        {formatDuration(elapsed)}
      </span>
      <span className="recorder__hint">{t('voice.recording')}</span>
      <button
        type="button"
        className="link"
        onClick={() => {
          finish(false);
        }}
      >
        {t('composer.cancel')}
      </button>
      <button
        type="button"
        className="button button--primary"
        disabled={!ready}
        // Enter sends and Escape cancels, straight away.
        autoFocus
        onClick={() => {
          finish(true);
        }}
      >
        {t('voice.send')}
      </button>
    </div>
  );
}
