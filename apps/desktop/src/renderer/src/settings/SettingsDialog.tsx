import { useEffect, useState } from 'react';
import { LOCALES } from '@hasbihal/core';
import { X } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { VoiceSettingsFields } from '../hangout/VoiceSettings.tsx';
import { systemLocale, useLanguage, useT } from '../i18n.tsx';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { Select, Switch } from '../components/controls.tsx';

type Tab = 'general' | 'voice';

/**
 * The app's settings for this computer: language (A18) and starting with the computer (A39);
 * microphone, camera and how the mic opens (A29, A37). The profile (A41) stays about the person.
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
        tabs={(['general', 'voice'] as const).map((value) => ({
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
        ) : (
          <section className="profile__section">
            <VoiceSettingsFields cameraPreview />
            <p className="field__hint">{t('settings.voiceHint')}</p>
          </section>
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
