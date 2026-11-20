import { useState, type ReactElement, type ReactNode } from 'react';
import { DropdownMenu, Popover as RadixPopover } from 'radix-ui';
import { Check } from 'lucide-react';

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
  side = 'bottom',
  align = 'end',
  className,
  children,
}: {
  label: string;
  trigger: ReactElement;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          className={['popover menu', className].filter(Boolean).join(' ')}
          side={side}
          align={align}
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

/** A heading inside a `Menu`, e.g. whose menu it is. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="menu-label">{children}</DropdownMenu.Label>;
}

/** A choice of one, inside a `Menu`; picking one keeps the menu open, so the change shows. */
export function MenuRadioGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; icon?: ReactNode }[];
}) {
  return (
    <DropdownMenu.RadioGroup
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onChange(option.value);
      }}
    >
      {options.map((option) => (
        <DropdownMenu.RadioItem
          key={option.value}
          value={option.value}
          className="menu-item"
          onSelect={(e) => {
            e.preventDefault();
          }}
        >
          {option.icon}
          <span>{option.label}</span>
          <DropdownMenu.ItemIndicator className="menu-item__check">
            <Check size="1em" aria-hidden />
          </DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}
