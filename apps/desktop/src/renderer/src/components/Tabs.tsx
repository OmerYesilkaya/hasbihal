import type { ReactNode } from 'react';
import { Tabs as RadixTabs } from 'radix-ui';

/**
 * A row of tabs and the chosen one's panel (Radix Tabs: arrow keys move between tabs). Only the
 * chosen panel is rendered; `children` is it.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  panelClassName,
  children,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly { value: T; label: string }[];
  panelClassName?: string;
  children: ReactNode;
}) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const tab = tabs.find((t) => t.value === next);
        if (tab) onChange(tab.value);
      }}
    >
      <RadixTabs.List className="share-picker__tabs">
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} className="share-picker__tab">
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} className={panelClassName}>
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  );
}
