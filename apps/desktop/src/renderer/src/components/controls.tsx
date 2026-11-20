import { useId, type ReactNode } from 'react';
import {
  Checkbox as RadixCheckbox,
  Progress as RadixProgress,
  RadioGroup as RadixRadioGroup,
  Select as RadixSelect,
  Slider as RadixSlider,
  Switch as RadixSwitch,
} from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { Icon } from './Icon.tsx';

/*
 * Form controls drawn by the app (Radix primitives), so they look the same on macOS and Windows
 * and match the rest of the UI. Text fields stay <input>: Radix has no primitive for them.
 */

/** A checkbox with its label; clicking the label toggles it. */
export function Checkbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="check" data-disabled={disabled ? true : undefined}>
      <RadixCheckbox.Root
        className="checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => {
          onChange(value === true);
        }}
      >
        <RadixCheckbox.Indicator className="checkbox__mark">
          <Icon icon={Check} strokeWidth={3} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span>{children}</span>
    </label>
  );
}

/** An on/off setting with its label. */
export function Switch({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="check check--switch" data-disabled={disabled ? true : undefined}>
      <span>{children}</span>
      <RadixSwitch.Root
        className="switch"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      >
        <RadixSwitch.Thumb className="switch__thumb" />
      </RadixSwitch.Root>
    </label>
  );
}

/** One choice out of a few, all visible, under a label. */
export function RadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
}) {
  const id = useId();
  return (
    <div className="option-group">
      <span className="field__label" id={`${id}-label`}>
        {label}
      </span>
      <RadixRadioGroup.Root
        className="option-group__items"
        aria-labelledby={`${id}-label`}
        value={value}
        onValueChange={(next) => {
          const option = options.find((o) => o.value === next);
          if (option) onChange(option.value);
        }}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className="check"
            data-disabled={option.disabled ? true : undefined}
          >
            <RadixRadioGroup.Item className="radio" value={option.value} disabled={option.disabled}>
              <RadixRadioGroup.Indicator className="radio__dot" />
            </RadixRadioGroup.Item>
            <span>{option.label}</span>
          </label>
        ))}
      </RadixRadioGroup.Root>
    </div>
  );
}

/** Radix Select can't hold '' as a value; this stands in for "no choice" (e.g. "Default"). */
const NONE = '__none__';

/** One choice out of many, in a list that opens from the field. */
export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  /** For a field whose purpose shows already (the label still names it for screen readers). */
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={['select-field', className].filter(Boolean).join(' ')}>
      {!hideLabel && (
        <span className="field__label" id={`${id}-label`}>
          {label}
        </span>
      )}
      <RadixSelect.Root
        value={value === '' ? NONE : value}
        onValueChange={(next) => {
          const option = options.find((o) => (o.value === '' ? NONE : o.value) === next);
          if (option) onChange(option.value);
        }}
      >
        <RadixSelect.Trigger
          className="select"
          aria-label={hideLabel ? label : undefined}
          aria-labelledby={hideLabel ? undefined : `${id}-label`}
        >
          <RadixSelect.Value />
          <RadixSelect.Icon className="select__icon">
            <Icon icon={ChevronDown} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            className="popover select__menu"
            position="popper"
            sideOffset={4}
            collisionPadding={8}
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value === '' ? NONE : option.value}
                  className="menu-item select__item"
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="select__check">
                    <Icon icon={Check} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}

/** A value along a range, e.g. a volume. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <RadixSlider.Root
      className={['slider', className].filter(Boolean).join(' ')}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([next]) => {
        if (next !== undefined) onChange(next);
      }}
    >
      <RadixSlider.Track className="slider__track">
        <RadixSlider.Range className="slider__range" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="slider__thumb" aria-label={label} />
    </RadixSlider.Root>
  );
}

/** How far along something is, from 0 to 1 (an upload, a recording). */
export function Progress({ value, className }: { value: number; className?: string }) {
  const ratio = Math.min(Math.max(value, 0), 1);
  return (
    <RadixProgress.Root
      className={['progress', className].filter(Boolean).join(' ')}
      value={ratio * 100}
    >
      <RadixProgress.Indicator
        className="progress__fill"
        style={{ translate: `${String(-100 + ratio * 100)}% 0` }}
      />
    </RadixProgress.Root>
  );
}
