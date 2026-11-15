import type { GatewayStatus } from '@hasbihal/core';
import { useT } from '../i18n.tsx';

export function ConnectionBadge({ status }: { status: GatewayStatus }) {
  const t = useT();
  const label =
    status.kind === 'connected'
      ? t('connection.connected')
      : status.kind === 'disconnected'
        ? t('connection.offline')
        : t('connection.connecting');
  return (
    <span className="connection" data-state={status.kind} role="status">
      <span className="connection__dot" />
      {label}
    </span>
  );
}
