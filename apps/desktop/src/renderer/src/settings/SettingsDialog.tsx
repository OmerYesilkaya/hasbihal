import { useEffect, useState, useSyncExternalStore } from 'react';
import { LOCALES } from '@hasbihal/core';
import { Play, Square, X } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { VoiceSettingsFields } from '../hangout/VoiceSettings.tsx';
import { systemLocale, useLanguage, useT } from '../i18n.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { Select, Slider, Switch } from '../components/controls.tsx';
import { RINGTONES, ring, soundSettings, stopRing } from '../sound.ts';

type Tab = 'general' | 'voice' | 'sounds';

/**
 * The app's settings for this computer: language (A18) and starting with the computer (A39);
 * microphone, camera and how the mic opens (A29, A37); sound effects and the ringtone (#37). The
 * profile (A41) stays about the person.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('general');

  return (
    <Modal className="profile settings" testId="settings" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>{t('settings.title')}</ModalTitle>
        <ModalClose className="icon-button" aria-label={t('settings.close')}>
          <Icon icon={X} />
        </ModalClose>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={(['general', 'voice', 'sounds'] as const).map((value) => ({
          value,
          label: t(`settings.tab.${value}`),
        }))}
        panelClassName="settings__body"
      >
        {tab === 'general' ? (
          <>
            <LanguageSection />
            <StartupSection />
          </>
        ) : tab === 'voice' ? (
          <section className="profile__section">
            <VoiceSettingsFields cameraPreview />
            <p className="field__hint">{t('settings.voiceHint')}</p>
          </section>
        ) : (
          <SoundsSection />
        )}
      </Tabs>
    </Modal>
  );
}

/** A18: Turkish first, English too; by default the computer's language. */
function LanguageSection() {
  const t = useT();
  const { choice, setChoice } = useLanguage();
  return (
    <section className="profile__section">
      <Select
        className="settings__language"
        label={t('settings.language')}
        value={choice ?? 'system'}
        onChange={(value) => {
          setChoice(value === 'system' ? null : value);
        }}
        options={[
          {
            value: 'system' as const,
            label: `${t('settings.language.system')} · ${t(`settings.language.${systemLocale()}`)}`,
          },
          ...LOCALES.map((locale) => ({ value: locale, label: t(`settings.language.${locale}`) })),
        ]}
      />
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
      <Switch
        checked={on}
        onChange={(value) => {
          setOn(value);
          void window.hasbihal.system.setLaunchAtStartup(value);
        }}
      >
        {t('settings.launchAtStartup')}
      </Switch>
      <p className="field__hint">{t('settings.launchAtStartupHint')}</p>
    </section>
  );
}

/** #37: how loud the sound effects are (or off), and which ringtone a call into a call rings with. */
function SoundsSection() {
  const t = useT();
  const settings = useSyncExternalStore(soundSettings.subscribe, soundSettings.get);
  const ringing = useSyncExternalStore(soundSettings.subscribe, soundSettings.ringing);
  // A ringtone being tried out stops with the settings.
  useEffect(() => stopRing, []);
  const percent = Math.round(settings.volume * 100);
  return (
    <>
      <section className="profile__section">
        <span className="field__label">
          {t('settings.sounds')} ·{' '}
          {percent === 0 ? t('settings.soundsOff') : t('settings.soundsLevel', { percent })}
        </span>
        <Slider
          label={t('settings.sounds')}
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(value) => {
            soundSettings.update({ volume: value / 100 });
          }}
        />
        <p className="field__hint">{t('settings.soundsHint')}</p>
      </section>
      <section className="profile__section">
        <div className="settings__ringtone">
          <Select
            label={t('settings.ringtone')}
            value={settings.ringtone}
            onChange={(ringtone) => {
              soundSettings.update({ ringtone });
              ring(ringtone);
            }}
            options={RINGTONES.map((value) => ({
              value,
              label: t(`settings.ringtone.${value}`),
            }))}
          />
          <button
            type="button"
            className="button"
            data-testid="ringtone-play"
            disabled={percent === 0}
            onClick={() => {
              if (ringing) stopRing();
              else ring();
            }}
          >
            <Icon icon={ringing ? Square : Play} />{' '}
            {ringing ? t('settings.ringtoneStop') : t('settings.ringtonePlay')}
          </button>
        </div>
        <p className="field__hint">{t('settings.ringtoneHint')}</p>
      </section>
    </>
  );
}
