import { useState, type ReactElement, type ReactNode } from 'react';
import { DropdownMenu, Popover as RadixPopover } from 'radix-ui';

interface PopoverProps {
  /** The accessible name of the panel. */
  label: string;
  /** Below the button, lined up with its right edge; or above it, centred. */
  placement?: 'below-end' | 'above';
  className?: string;
  /** The button that opens it. */
  trigger: ReactElement;
  /** Rendered only while open; `close` closes it. */
  children: (close: () => void) => ReactNode;
}

/**
 * A small panel next to the button that opens it (Radix Popover): it sits above everything,
 * closes on a click outside or Esc, keeps focus sensible, and moves to stay on screen.
 */
export function Popover({
  label,
  placement = 'below-end',
  className,
  trigger,
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <RadixPopover.Root open={open} onOpenChange={setOpen}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-label={label}
          className={['popover', className].filter(Boolean).join(' ')}
          side={placement === 'above' ? 'top' : 'bottom'}
          align={placement === 'above' ? 'center' : 'end'}
          sideOffset={6}
          collisionPadding={8}
        >
          {children(() => {
            setOpen(false);
          })}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/**
 * A menu of actions (Radix DropdownMenu): arrow keys, typeahead, Esc and outside clicks, and
 * focus back on its button afterwards.
 */
export function Menu({
  label,
  trigger,
  children,
}: {
  label: string;
  trigger: ReactElement;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          className="popover menu"
          align="end"
          sideOffset={6}
          collisionPadding={8}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One action in a `Menu`; choosing it closes the menu. */
export function MenuItem({
  icon,
  danger,
  onSelect,
  children,
  testId,
}: {
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <DropdownMenu.Item
      className="menu-item"
      data-danger={danger ? true : undefined}
      data-testid={testId}
      onSelect={onSelect}
    >
      {icon}
      <span>{children}</span>
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="menu-separator" />;
}
