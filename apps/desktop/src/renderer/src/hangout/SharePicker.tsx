import { useEffect, useState } from 'react';
import type { ScreenSource } from '../../../shared/app-info.ts';
import { useChat, useHangout } from '../chat/context.tsx';
import { useT } from '../i18n.tsx';
import type { SharePreset } from './session.ts';
import { Modal, ModalClose, ModalTitle } from '../components/Modal.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { Checkbox, RadioGroup } from '../components/controls.tsx';

/**
 * The app's own picker for screen sharing (A14): screens and windows with previews, what to tune
 * the share for, and whether the computer's sound goes along.
 */
export function SharePicker({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { hangout } = useChat();
  const { settings } = useHangout();
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');

  useEffect(() => {
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
    void hangout.startScreenShare(source.id);
  };

  return (
    <Modal className="profile share-picker" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>{t('share.title')}</ModalTitle>
      </header>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={(['screen', 'window'] as const).map((value) => ({
          value,
          label: value === 'screen' ? t('share.screens') : t('share.windows'),
        }))}
        panelClassName="share-picker__sources"
      >
        {sources === null ? (
          <p className="field__hint">{t('share.loading')}</p>
        ) : sources.length === 0 ? (
          <p className="field__hint">{t('share.none')}</p>
        ) : (
          shown.map((source) => (
            <ModalClose
              key={source.id}
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
            </ModalClose>
          ))
        )}
      </Tabs>
      <div className="profile__section share-picker__options">
        <RadioGroup
          label={t('share.preset')}
          value={settings.sharePreset}
          onChange={(sharePreset) => {
            hangout.updateSettings({ sharePreset });
          }}
          options={(['motion', 'detail'] as const satisfies readonly SharePreset[]).map(
            (preset) => ({
              value: preset,
              label: preset === 'motion' ? t('share.motion') : t('share.detail'),
            }),
          )}
        />
        <Checkbox
          checked={settings.shareAudio}
          onChange={(shareAudio) => {
            hangout.updateSettings({ shareAudio });
          }}
        >
          {t('share.audio')}
        </Checkbox>
      </div>
      <div className="share-picker__actions">
        <ModalClose className="button">{t('share.cancel')}</ModalClose>
      </div>
    </Modal>
  );
}
