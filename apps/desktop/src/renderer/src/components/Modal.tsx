import {
  createContext,
  useContext,
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Dialog } from 'radix-ui';

const CloseContext = createContext<() => void>(() => undefined);

/**
 * A modal window (Radix Dialog): shown while mounted; focus stays inside, and Esc or a click
 * outside closes it. It always closes through Radix first, then calls `onClose` for the parent
 * to unmount it: unmounting an open dialog leaves the page unclickable (`pointer-events: none`
 * on the body). So close it from inside (`ModalClose`, `useCloseModal()`), never by unmounting it.
 * Give it a `ModalTitle`, which also names it.
 */
export function Modal({
  className,
  testId,
  onClose,
  onKeyDown,
  onClick,
  overlayClassName,
  children,
}: {
  className?: string;
  testId?: string;
  onClose: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** `close` closes it, as Esc would. */
  onClick?: (e: MouseEvent<HTMLDivElement>, close: () => void) => void;
  overlayClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) onClose();
  }, [open, onClose]);
  const close = () => {
    setOpen(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={['modal-overlay', overlayClassName].filter(Boolean).join(' ')} />
        <Dialog.Content
          className={['modal', className].filter(Boolean).join(' ')}
          data-testid={testId}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onClick={
            onClick &&
            ((e) => {
              onClick(e, close);
            })
          }
        >
          <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Closes the modal this is inside, the same way Esc does. */
export function useCloseModal(): () => void {
  return useContext(CloseContext);
}

/** A button that closes the modal it's in (then does its own `onClick`, if any). */
export const ModalClose = Dialog.Close;

/** The modal's heading; screen readers announce the modal by it. */
export const ModalTitle = Dialog.Title;
