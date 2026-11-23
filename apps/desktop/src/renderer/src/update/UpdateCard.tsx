import { useEffect, useState } from 'react';
import { CircleArrowDown } from 'lucide-react';
import { DOWNLOAD_PAGE, type UpdateState } from '../../../shared/app-info.ts';
import { confirm } from '../components/confirm.tsx';
import { Progress } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import { useT } from '../i18n.tsx';

/** The main process's update state (DECISIONS A30), kept current. */
export function useUpdate(): UpdateState {
  const [state, setState] = useState<UpdateState>({ kind: 'none' });
  useEffect(() => {
    let live = true;
    const off = window.hasbihal.updates.onChanged(setState);
    void window.hasbihal.updates.state().then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

interface Props {
  /** Restarting leaves the call: ask first. */
  inCall?: boolean;
  /**
   * The A33 screen: this version no longer works, so it looks for an update at once, and offers
   * the download page even when it finds none (or can't update itself).
   */
  required?: boolean;
}

/**
 * "Version x is out · Update" (DECISIONS A30): in the sidebar when an update is available, and on
 * the A33 screen. One press downloads, installs, and restarts.
 */
export function UpdateCard({ inCall = false, required = false }: Props) {
  const t = useT();
  const state = useUpdate();

  useEffect(() => {
    if (required) window.hasbihal.updates.check();
  }, [required]);

  const install = async () => {
    if (inCall && !(await confirm({ message: t('update.inCall'), action: t('update.action') })))
      return;
    window.hasbihal.updates.install();
  };

  const downloadPage = (
    <a className="update__link" href={DOWNLOAD_PAGE} target="_blank" rel="noreferrer">
      {t('update.downloadPage')}
    </a>
  );

  if (state.kind === 'none') {
    return required ? <div className="update update--required">{downloadPage}</div> : null;
  }

  return (
    <div className={required ? 'update update--required' : 'update'} role="status">
      <Icon icon={CircleArrowDown} />
      <div className="update__body">
        <div className="update__title">
          {state.kind === 'failed'
            ? t('update.failed')
            : t('update.available', { version: state.version })}
        </div>
        {state.kind === 'available' && (
          <>
            {state.needsMove && <p className="update__note">{t('update.move')}</p>}
            <button
              type="button"
              className="button button--primary update__button"
              onClick={() => void install()}
            >
              {t(state.needsMove ? 'update.moveAction' : 'update.action')}
            </button>
          </>
        )}
        {state.kind === 'downloading' && (
          <>
            <p className="update__note">{t('update.downloading')}</p>
            <Progress className="update__progress" value={state.progress} />
          </>
        )}
        {state.kind === 'installing' && <p className="update__note">{t('update.installing')}</p>}
        {state.kind === 'failed' && (
          <div className="update__actions">
            <button
              type="button"
              className="button button--primary update__button"
              onClick={() => void install()}
            >
              {t('update.retry')}
            </button>
            {downloadPage}
          </div>
        )}
      </div>
    </div>
  );
}
