import type { ReactNode } from 'react';
import { Tulip } from './Tulip.tsx';

/** "Nothing here yet", with the tulip (DECISIONS §5: Iznik motifs in empty states). */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <Tulip size={44} />
      <p>{children}</p>
    </div>
  );
}
