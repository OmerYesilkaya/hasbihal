import type { ReactElement, ReactNode } from 'react';
import { Tooltip } from 'radix-ui';

/**
 * A tooltip (Radix Tooltip) in the app's own look, on hover or keyboard focus. Wraps one element;
 * other props (e.g. from an outer Radix trigger) pass through to it.
 */
export function Tip({
  label,
  side = 'top',
  children,
  ...rest
}: {
  label: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild {...rest}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Mounted once at the root: tooltips share one delay, so moving along a toolbar is quick. */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </Tooltip.Provider>
  );
}
