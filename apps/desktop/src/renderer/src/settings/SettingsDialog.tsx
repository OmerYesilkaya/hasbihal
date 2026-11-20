import { useEffect, useId, useRef, useState } from 'react';
import { LOCALES, type Locale } from '@hasbihal/core';
import { X } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { VoiceSettingsFields } from '../hangout/VoiceSettings.tsx';
import { systemLocale, useLanguage, useT } from '../i18n.tsx';

type Tab = 'general' | 'voice';

/**
 * The app's settings for this computer: language (A18) and starting with the computer (A39);
 * microphone, camera and how the mic opens (A29, A37). The profile (A41) stays about the person.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('general');

  // A native modal: focus stays inside, and Esc or a click outside (closedby) closes it.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      closedby="any"
      className="profile settings"
      aria-label={t('settings.title')}
      data-testid="settings"
      onClose={onClose}
    >
      <header className="profile__header">
        <h1>{t('settings.title')}</h1>
        <button
          type="button"
          className="icon-button"
          aria-label={t('settings.close')}
          onClick={onClose}
        >
          <Icon icon={X} />
        </button>
      </header>
      <div className="share-picker__tabs" role="tablist">
        {(['general', 'voice'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            className="share-picker__tab"
            aria-selected={tab === name}
            onClick={() => {
              setTab(name);
            }}
          >
            {t(`settings.tab.${name}`)}
          </button>
        ))}
      </div>
      <div className="settings__body" role="tabpanel">
        {tab === 'general' ? (
          <>
            <LanguageSection />
            <StartupSection />
          </>
        ) : (
          <section className="profile__section">
            <VoiceSettingsFields />
            <p className="field__hint">{t('settings.voiceHint')}</p>
          </section>
        )}
      </div>
    </dialog>
  );
}

/** A18: Turkish first, English too; by default the computer's language. */
function LanguageSection() {
  const t = useT();
  const id = useId();
  const { choice, setChoice } = useLanguage();
  const options: (Locale | null)[] = [null, ...LOCALES];
  return (
    <section className="profile__section">
      <fieldset className="option-group">
        <legend className="field__label">{t('settings.language')}</legend>
        {options.map((option) => (
          <label key={option ?? 'system'} className="voice-settings__check">
            <input
              type="radio"
              name={`${id}-language`}
              checked={choice === option}
              onChange={() => {
                setChoice(option);
              }}
            />
            {option
              ? t(`settings.language.${option}`)
              : `${t('settings.language.system')} · ${t(`settings.language.${systemLocale()}`)}`}
          </label>
        ))}
      </fieldset>
      <p className="field__hint">{t('settings.languageHint')}</p>
    </section>
  );
}

/** A39: starting with the computer, on by default; shown only where the build manages it. */
function StartupSection() {
  const t = useT();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    void window.hasbihal.system.launchAtStartup().then((value) => {
      if (current) setOn(value);
    });
    return () => {
      current = false;
    };
  }, []);
  if (on === null) return null;
  return (
    <section className="profile__section">
      <label className="voice-settings__check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const value = e.target.checked;
            setOn(value);
            void window.hasbihal.system.setLaunchAtStartup(value);
          }}
        />
        {t('settings.launchAtStartup')}
      </label>
      <p className="field__hint">{t('settings.launchAtStartupHint')}</p>
    </section>
  );
}
