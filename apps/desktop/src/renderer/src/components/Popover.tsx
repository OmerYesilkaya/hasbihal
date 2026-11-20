import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/** What the opening button needs: spread it onto a `<button type="button">`. */
export interface PopoverTriggerProps {
  popoverTarget: string;
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog' | 'menu';
  'data-open': true | undefined;
  style: CSSProperties;
}

interface PopoverProps {
  /** The accessible name of the panel. */
  label: string;
  /** `menu` for a list of actions (`MenuItem`s), `dialog` for a small form. */
  role?: 'dialog' | 'menu';
  /** Below the button, lined up with its right edge; or above it, centred. */
  placement?: 'below-end' | 'above';
  className?: string;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** Rendered only while open, so nothing in it runs while it's closed. */
  children: (close: () => void) => ReactNode;
}

/**
 * A panel anchored to the button that opens it. It is the browser's own popover, so a click
 * anywhere outside or Esc closes it, it sits above everything (even an open dialog), and CSS
 * anchor positioning keeps it next to its button, flipping when there's no room.
 */
export function Popover({
  label,
  role = 'dialog',
  placement = 'below-end',
  className,
  trigger,
  children,
}: PopoverProps) {
  const reactId = useId();
  const id = `popover-${reactId.replace(/[^\w-]/g, '')}`;
  const anchor = `--${id}`;
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Keyboard users land inside it, as they would in a menu.
  useEffect(() => {
    if (open)
      panel.current
        ?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select')
        ?.focus();
  }, [open]);

  const close = () => {
    document.getElementById(id)?.hidePopover();
  };

  return (
    <>
      {trigger({
        popoverTarget: id,
        'aria-expanded': open,
        'aria-haspopup': role,
        'data-open': open ? true : undefined,
        style: { anchorName: anchor },
      })}
      <div
        ref={panel}
        id={id}
        popover="auto"
        role={role}
        aria-label={label}
        className={['popover', `popover--${placement}`, className].filter(Boolean).join(' ')}
        style={{ positionAnchor: anchor }}
        onToggle={(e) => {
          setOpen(e.newState === 'open');
        }}
        onKeyDown={role === 'menu' ? moveFocus : undefined}
      >
        {open && children(close)}
      </div>
    </>
  );
}

/** Arrow keys move between a menu's items, wrapping around. */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + step + items.length) % items.length]?.focus();
}

/** One action in a `role="menu"` popover; choosing it closes the menu. */
export function MenuItem({
  icon,
  danger,
  onSelect,
  close,
  children,
  testId,
}: {
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
  close: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      data-danger={danger ? true : undefined}
      data-testid={testId}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
