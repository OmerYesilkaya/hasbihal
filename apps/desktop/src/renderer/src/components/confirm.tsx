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
  // The question stays after answering, so the dialog fades out with its words still in it.
  const [request, setRequest] = useState<(Request & { answer: (yes: boolean) => void }) | null>(
    null,
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    ask = (next) =>
      new Promise<boolean>((resolve) => {
        setRequest({ ...next, answer: resolve });
        setOpen(true);
      });
    return () => {
      ask = null;
    };
  }, []);

  // A promise settles once, so answering again (Action, then the close it causes) is harmless.
  const answer = (yes: boolean) => {
    request?.answer(yes);
    setOpen(false);
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-overlay" />
        <AlertDialog.Content
          className="modal confirm"
          data-testid="confirm"
          aria-describedby={undefined}
        >
          <AlertDialog.Title className="confirm__title">{request?.message}</AlertDialog.Title>
          <div className="confirm__actions">
            <AlertDialog.Cancel className="button">{t('confirm.cancel')}</AlertDialog.Cancel>
            <AlertDialog.Action
              className="button button--primary"
              data-danger={request?.danger ? true : undefined}
              onClick={() => {
                answer(true);
              }}
            >
              {request?.action}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
