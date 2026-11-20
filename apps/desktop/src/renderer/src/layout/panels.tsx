import { createContext, useContext, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { useT } from '../i18n.tsx';

/** Which side columns (A36) are showing; hiding them gives the chat the whole window. */
export interface Panels {
  rooms: boolean;
  members: boolean;
}
type Side = keyof Panels;

const STORAGE_KEY = 'hasbihal.panels';
const ALL_OPEN: Panels = { rooms: true, members: true };

function load(): Panels {
  try {
    return { ...ALL_OPEN, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as object) };
  } catch {
    return ALL_OPEN;
  }
}

interface PanelsContext {
  panels: Panels;
  toggle: (side: Side) => void;
}

const Context = createContext<PanelsContext | null>(null);

/** Remembers the choice on this computer, like the window's size. */
export function usePanelsState(): PanelsContext {
  const [panels, setPanels] = useState(load);
  const toggle = (side: Side) => {
    setPanels((current) => {
      const next = { ...current, [side]: !current[side] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return { panels, toggle };
}

export function PanelsProvider({ value, children }: { value: PanelsContext; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The button that shows or hides one side column, at that side of the room's header. */
export function PanelToggle({ side }: { side: Side }) {
  const t = useT();
  const context = useContext(Context);
  if (!context) return null;
  const open = context.panels[side];
  const label = t(open ? `panels.hide.${side}` : `panels.show.${side}`);
  const glyph =
    side === 'rooms'
      ? open
        ? PanelLeftClose
        : PanelLeftOpen
      : open
        ? PanelRightClose
        : PanelRightOpen;
  return (
    <button
      type="button"
      className="icon-button panel-toggle"
      aria-label={label}
      title={label}
      data-testid={`toggle-${side}`}
      onClick={() => {
        context.toggle(side);
      }}
    >
      <Icon icon={glyph} />
    </button>
  );
}
