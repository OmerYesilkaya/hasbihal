import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { useChat, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import { RadioGroup, Select, Slider, Switch } from '../components/controls.tsx';

const isMac = navigator.userAgent.includes('Mac');
/** How the global shortcuts (main/shortcuts.ts) read on this platform. */
const SHORTCUT_LABELS = isMac
  ? { mute: '⌘⌥M', deafen: '⌘⌥D' }
  : { mute: 'Ctrl+Alt+M', deafen: 'Ctrl+Alt+D' };

/** "AltRight" → "Alt (sağ)"-ish: readable enough without a full keyboard-layout table. */
const keyLabel = (code: string) =>
  code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/(Left|Right)$/, ' $1');

/**
 * Devices, noise suppression, and how the mic opens (A29, A37): in the call's settings popover
 * and on the Settings page. Outside a call it can play the microphone back; `cameraPreview`
 * adds a look through the camera (the Settings page has the room for it).
 */
export function VoiceSettingsFields({ cameraPreview = false }: { cameraPreview?: boolean }) {
  const t = useT();
  const { hangout } = useChat();
  const call = useHangout();
  const { settings } = call;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(-100);
  const [capturingKey, setCapturingKey] = useState(false);

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then(setDevices);
  }, []);

  // The live level against the sensitivity line, so people can see where to put it.
  useEffect(() => {
    const timer = setInterval(() => {
      setLevel(hangout.micLevelDb());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [hangout]);

  useEffect(() => {
    if (!capturingKey) return;
    const capture = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code !== 'Escape') hangout.updateSettings({ pttKey: e.code });
      setCapturingKey(false);
    };
    window.addEventListener('keydown', capture, { once: true });
    return () => {
      window.removeEventListener('keydown', capture);
    };
  }, [capturingKey, hangout]);

  const deviceSelect = (
    kind: 'audioinput' | 'videoinput',
    label: string,
    value: string | null,
    onChange: (id: string | null) => void,
  ) => (
    <Select
      label={label}
      value={value ?? ''}
      onChange={(next) => {
        onChange(next || null);
      }}
      options={[
        { value: '', label: t('settings.default') },
        ...devices
          .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default')
          .map((d) => ({ value: d.deviceId, label: d.label || d.deviceId.slice(0, 8) })),
      ]}
    />
  );

  const meter = Math.max(0, Math.min(100, ((level + 80) / 70) * 100));
  const line = Math.max(0, Math.min(100, ((settings.thresholdDb + 80) / 70) * 100));
  return (
    <div className="voice-settings">
      {deviceSelect('audioinput', t('settings.microphone'), settings.deviceId, (deviceId) => {
        hangout.updateSettings({ deviceId });
      })}
      {/* In a call the meter already shows the real microphone. */}
      {call.roomId === null && <MicTest />}
      {deviceSelect('videoinput', t('settings.camera'), settings.cameraId, (cameraId) => {
        hangout.updateSettings({ cameraId });
      })}
      {cameraPreview && <CameraPreview cameraId={settings.cameraId} />}
      <Switch
        checked={settings.noiseSuppression && call.noiseSuppressionAvailable}
        disabled={!call.noiseSuppressionAvailable}
        onChange={(noiseSuppression) => {
          hangout.updateSettings({ noiseSuppression });
        }}
      >
        {t('settings.noiseSuppression')}
      </Switch>

      <RadioGroup
        label={t('settings.inputMode')}
        value={settings.mode}
        onChange={(mode) => {
          hangout.updateSettings({ mode });
        }}
        options={[
          { value: 'voice', label: t('settings.voiceActivation') },
          { value: 'ptt', label: t('settings.pushToTalk') },
        ]}
      />

      {settings.mode === 'voice' ? (
        <>
          <span className="field__label">{t('settings.sensitivity')}</span>
          <div className="level">
            <div
              className="level__fill"
              style={{ width: `${String(meter)}%` }}
              data-open={level >= settings.thresholdDb ? true : undefined}
            />
            <div className="level__line" style={{ left: `${String(line)}%` }} />
          </div>
          <Slider
            label={t('settings.sensitivity')}
            min={-80}
            max={-10}
            value={settings.thresholdDb}
            onChange={(thresholdDb) => {
              hangout.updateSettings({ thresholdDb });
            }}
          />
        </>
      ) : (
        <div className="voice-settings__ptt">
          <span>
            {capturingKey
              ? t('settings.pttPress')
              : t('settings.pttKey', { key: keyLabel(settings.pttKey) })}
          </span>
          <button
            type="button"
            className="link"
            onClick={() => {
              setCapturingKey(true);
            }}
          >
            {t('settings.pttChange')}
          </button>
          <p className="field__hint">{t('settings.pttHint')}</p>
        </div>
      )}
      <p className="field__hint">{t('settings.shortcuts', SHORTCUT_LABELS)}</p>
    </div>
  );
}

/** "Mikrofonu dene": hear yourself as a call would send you, and see the level move. */
function MicTest() {
  const t = useT();
  const { hangout } = useChat();
  const { micTest } = useHangout();
  // Closing the settings ends the test: the microphone never stays open unseen.
  useEffect(
    () => () => {
      hangout.stopMicTest();
    },
    [hangout],
  );
  return (
    <div className="device-test">
      <button
        type="button"
        className={micTest ? 'button button--primary' : 'button'}
        data-testid="mic-test"
        onClick={() => {
          if (micTest) hangout.stopMicTest();
          else void hangout.startMicTest();
        }}
      >
        <Icon icon={micTest ? MicOff : Mic} />{' '}
        {micTest ? t('settings.micTestStop') : t('settings.micTest')}
      </button>
      <p className="field__hint">{t('settings.micTestHint')}</p>
    </div>
  );
}

/** A look through the chosen camera; it's on only while shown and asked for. */
function CameraPreview({ cameraId }: { cameraId: string | null }) {
  const t = useT();
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let current = true;
    void navigator.mediaDevices
      .getUserMedia({ video: cameraId ? { deviceId: { exact: cameraId } } : true })
      .then(
        (s) => {
          if (!current) {
            for (const track of s.getTracks()) track.stop();
            return;
          }
          stream = s;
          if (video.current) video.current.srcObject = s;
        },
        () => {
          if (current) setFailed(true);
        },
      );
    return () => {
      current = false;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [on, cameraId]);

  return (
    <div className="device-test">
      <button
        type="button"
        className={on ? 'button button--primary' : 'button'}
        data-testid="camera-preview"
        onClick={() => {
          setFailed(false);
          setOn((v) => !v);
        }}
      >
        <Icon icon={on ? VideoOff : Video} />{' '}
        {on ? t('settings.cameraPreviewStop') : t('settings.cameraPreview')}
      </button>
      {on &&
        (failed ? (
          <p className="field__error">{t('hangout.cameraFailed')}</p>
        ) : (
          <video ref={video} className="device-test__video" autoPlay muted playsInline />
        ))}
    </div>
  );
}
