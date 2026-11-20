import { useEffect, useId, useRef, useState } from 'react';
import type { ScreenSource } from '../../../shared/app-info.ts';
import { useChat, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import type { SharePreset } from './session.ts';

/**
 * The app's own picker for screen sharing (A14): screens and windows with previews, what to tune
 * the share for, and whether the computer's sound goes along.
 */
export function SharePicker({ onClose }: { onClose: () => void }) {
  const t = useT();
  const id = useId();
  const { hangout } = useChat();
  const { settings } = useHangout();
  const dialog = useRef<HTMLDialogElement>(null);
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');

  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    void window.hasbihal.screen.sources().then(
      (list) => {
        if (current) setSources(list);
      },
      () => {
        if (current) setSources([]);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const shown = sources?.filter((s) => s.kind === tab) ?? [];
  const pick = (source: ScreenSource) => {
    onClose();
    void hangout.startScreenShare(source.id);
  };

  return (
    <dialog
      ref={dialog}
      closedby="any"
      className="profile share-picker"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
    >
      <header className="profile__header">
        <h1 id={`${id}-title`}>{t('share.title')}</h1>
      </header>
      <div className="share-picker__tabs" role="tablist">
        {(['screen', 'window'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={tab === kind}
            className="share-picker__tab"
            onClick={() => {
              setTab(kind);
            }}
          >
            {kind === 'screen' ? t('share.screens') : t('share.windows')}
          </button>
        ))}
      </div>
      <div className="share-picker__sources">
        {sources === null ? (
          <p className="field__hint">{t('share.loading')}</p>
        ) : sources.length === 0 ? (
          <p className="field__hint">{t('share.none')}</p>
        ) : (
          shown.map((source) => (
            <button
              key={source.id}
              type="button"
              className="share-source"
              data-testid="share-source"
              onClick={() => {
                pick(source);
              }}
            >
              {source.thumbnail ? (
                <img className="share-source__preview" src={source.thumbnail} alt="" />
              ) : (
                <span className="share-source__preview" />
              )}
              <span className="share-source__name">
                {source.icon && <img src={source.icon} alt="" width={16} height={16} />}
                {source.name}
              </span>
            </button>
          ))
        )}
      </div>
      <fieldset className="profile__section share-picker__options">
        <legend className="field__label">{t('share.preset')}</legend>
        {(['motion', 'detail'] as const satisfies readonly SharePreset[]).map((preset) => (
          <label key={preset} className="voice-settings__check">
            <input
              type="radio"
              name={`${id}-preset`}
              checked={settings.sharePreset === preset}
              onChange={() => {
                hangout.updateSettings({ sharePreset: preset });
              }}
            />
            {preset === 'motion' ? t('share.motion') : t('share.detail')}
          </label>
        ))}
        <label className="voice-settings__check">
          <input
            type="checkbox"
            checked={settings.shareAudio}
            onChange={(e) => {
              hangout.updateSettings({ shareAudio: e.target.checked });
            }}
          />
          {t('share.audio')}
        </label>
      </fieldset>
      <div className="share-picker__actions">
        <button type="button" className="button" onClick={onClose}>
          {t('share.cancel')}
        </button>
      </div>
    </dialog>
  );
}
