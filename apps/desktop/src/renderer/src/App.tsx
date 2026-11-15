import type { AppInfo } from '../../shared/app-info.ts';
import { ConnectionBadge } from './components/ConnectionBadge.tsx';
import { Tulip } from './components/Tulip.tsx';
import { I18nProvider, useT } from './i18n.tsx';
import { useGateway } from './useGateway.ts';

export function App({ info }: { info: AppInfo }) {
  return (
    <I18nProvider>
      <Shell info={info} />
    </I18nProvider>
  );
}

function Shell({ info }: { info: AppInfo }) {
  const t = useT();
  const status = useGateway(info.serverUrl, info.appVersion);

  if (status.kind === 'upgrade_required') {
    return (
      <main className="upgrade">
        <Tulip size={56} />
        <p>{t('connection.upgradeRequired')}</p>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Tulip />
          <div>
            <div className="brand__name">{t('app.name')}</div>
            <div className="brand__tagline">{t('app.tagline')}</div>
          </div>
        </div>
        <hr className="divider" />
        <h2 className="section-label">{t('rooms.heading')}</h2>
      </aside>

      <main className="content">
        <header className="content__header">
          <span className="content__spacer" />
          <ConnectionBadge status={status} />
        </header>
        <p className="content__placeholder">{t('placeholder.welcome')}</p>
      </main>

      <aside className="members" aria-label={t('members.heading')}>
        <header className="members__header">{t('members.heading')}</header>
      </aside>
    </div>
  );
}
