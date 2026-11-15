import { useEffect, useId, useState } from 'react';
import { useChat, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';

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

/** Devices, noise suppression, and how the mic opens (A29, A37). */
export function VoiceSettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const id = useId();
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

  const select = (
    kind: 'audioinput' | 'videoinput',
    value: string | null,
    onChange: (id: string | null) => void,
  ) => (
    <select
      className="field__input"
      value={value ?? ''}
      onChange={(e) => {
        onChange(e.target.value || null);
      }}
    >
      <option value="">{t('settings.default')}</option>
      {devices
        .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default')
        .map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId.slice(0, 8)}
          </option>
        ))}
    </select>
  );

  const meter = Math.max(0, Math.min(100, ((level + 80) / 70) * 100));
  const line = Math.max(0, Math.min(100, ((settings.thresholdDb + 80) / 70) * 100));
  return (
    <div
      className="voice-settings"
      role="dialog"
      aria-label={t('hangout.settings')}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !capturingKey) onClose();
      }}
    >
      <label className="field__label">{t('settings.microphone')}</label>
      {select('audioinput', settings.deviceId, (deviceId) => {
        hangout.updateSettings({ deviceId });
      })}
      <label className="field__label">{t('settings.camera')}</label>
      {select('videoinput', settings.cameraId, (cameraId) => {
        hangout.updateSettings({ cameraId });
      })}
      <label className="voice-settings__check">
        <input
          type="checkbox"
          checked={settings.noiseSuppression && call.noiseSuppressionAvailable}
          disabled={!call.noiseSuppressionAvailable}
          onChange={(e) => {
            hangout.updateSettings({ noiseSuppression: e.target.checked });
          }}
        />
        {t('settings.noiseSuppression')}
      </label>

      <fieldset className="voice-settings__mode">
        <legend className="field__label">{t('settings.inputMode')}</legend>
        {(['voice', 'ptt'] as const).map((mode) => (
          <label key={mode} className="voice-settings__check">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={settings.mode === mode}
              onChange={() => {
                hangout.updateSettings({ mode });
              }}
            />
            {mode === 'voice' ? t('settings.voiceActivation') : t('settings.pushToTalk')}
          </label>
        ))}
      </fieldset>

      {settings.mode === 'voice' ? (
        <>
          <label className="field__label" htmlFor={`${id}-sensitivity`}>
            {t('settings.sensitivity')}
          </label>
          <div className="level">
            <div
              className="level__fill"
              style={{ width: `${String(meter)}%` }}
              data-open={level >= settings.thresholdDb ? true : undefined}
            />
            <div className="level__line" style={{ left: `${String(line)}%` }} />
          </div>
          <input
            id={`${id}-sensitivity`}
            type="range"
            min={-80}
            max={-10}
            step={1}
            value={settings.thresholdDb}
            onChange={(e) => {
              hangout.updateSettings({ thresholdDb: Number(e.target.value) });
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
