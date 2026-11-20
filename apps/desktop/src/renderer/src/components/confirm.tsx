import { useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { useT } from '../i18n.tsx';

interface Request {
  message: string;
  /** The button that goes ahead, e.g. "Sil". */
  action: string;
  /** For something that can't be undone: the button is red. */
  danger?: boolean;
}

let ask: ((request: Request) => Promise<boolean>) | null = null;

/**
 * Asks before doing something (Radix AlertDialog), in the app's own look instead of the
 * system's dialog: `if (await confirm({ … })) remove()`. Esc or "Vazgeç" answers no.
 */
export function confirm(request: Request): Promise<boolean> {
  if (!ask) throw new Error('confirm() before <ConfirmHost> mounted');
  return ask(request);
}

/** Mounted once, near the root. */
export function ConfirmHost() {
  const t = useT();
  const [pending, setPending] = useState<(Request & { answer: (yes: boolean) => void }) | null>(
    null,
  );

  useEffect(() => {
    ask = (request) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...request, answer: resolve });
      });
    return () => {
      ask = null;
    };
  }, []);

  const answer = (yes: boolean) => {
    pending?.answer(yes);
    setPending(null);
  };

  return (
    <AlertDialog.Root
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content
          className="modal confirm"
          data-testid="confirm"
          aria-describedby={undefined}
        >
          <AlertDialog.Title className="confirm__title">{pending?.message}</AlertDialog.Title>
          <div className="confirm__actions">
            <AlertDialog.Cancel className="button button--secondary">
              {t('confirm.cancel')}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className="button"
              data-danger={pending?.danger ? true : undefined}
              onClick={() => {
                answer(true);
              }}
            >
              {pending?.action}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
