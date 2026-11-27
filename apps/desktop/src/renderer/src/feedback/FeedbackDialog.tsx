import { useId, useState, type SubmitEvent } from 'react';
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_TITLE_MAX,
  SendFeedbackRequest,
  type FeedbackDiagnostics,
  type FeedbackKind,
} from '@hasbihal/protocol';
import type { MessageKey } from '@hasbihal/core';
import { Bug, Lightbulb, MessageCircle, X, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { AppInfo } from '../../../shared/app-info.ts';
import { useChat } from '../chat/context.tsx';
import { Checkbox } from '../components/controls.tsx';
import { Icon } from '../components/Icon.tsx';
import { Modal, ModalClose, ModalTitle, useCloseModal } from '../components/Modal.tsx';
import { useT } from '../i18n.tsx';

const KINDS: { kind: FeedbackKind; icon: LucideIcon }[] = [
  { kind: 'bug', icon: Bug },
  { kind: 'idea', icon: Lightbulb },
  { kind: 'other', icon: MessageCircle },
];

const OS_NAMES: Record<AppInfo['platform'], string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

/** The versions a bug report may carry, if the sender agrees: nothing about them. */
export const diagnosticsOf = (info: AppInfo): FeedbackDiagnostics => ({
  appVersion: info.appVersion,
  os: `${OS_NAMES[info.platform]} ${info.osVersion}`,
});

/** "Send feedback" (A56): a bug, an idea, or anything else, as a public issue without a name. */
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal className="profile feedback" testId="feedback" onClose={onClose}>
      <header className="profile__header">
        <ModalTitle>{t('feedback.title')}</ModalTitle>
        <ModalClose className="icon-button" aria-label={t('feedback.close')}>
          <Icon icon={X} />
        </ModalClose>
      </header>
      <FeedbackForm />
    </Modal>
  );
}

function FeedbackForm() {
  const t = useT();
  const id = useId();
  const close = useCloseModal();
  const { client, info } = useChat();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [withDiagnostics, setWithDiagnostics] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const diagnostics = diagnosticsOf(info);
  const request = SendFeedbackRequest.safeParse({
    kind,
    title,
    body,
    diagnostics: withDiagnostics ? diagnostics : null,
  });

  const send = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request.success || sending) return;
    setSending(true);
    setError(null);
    const result = await client.feedback(request.data);
    setSending(false);
    if (result.ok) {
      toast.success(t('feedback.sent'));
      close();
      return;
    }
    const code = result.error.code;
    setError(
      code === 'rate_limited'
        ? 'feedback.tooMany'
        : code === 'unavailable'
          ? 'error.unavailable'
          : 'error.unexpected',
    );
  };

  return (
    <form className="event-form" onSubmit={(e) => void send(e)}>
      <div className="event-form__body">
        <p className="field__hint feedback__intro">{t('feedback.intro')}</p>
        <fieldset className="event-form__chips">
          <legend className="field__label">{t('feedback.kind')}</legend>
          {KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              className="chip"
              aria-pressed={kind === option.kind}
              onClick={() => {
                setKind(option.kind);
              }}
            >
              <Icon icon={option.icon} />
              {t(`feedback.kind.${option.kind}`)}
            </button>
          ))}
        </fieldset>
        <label className="event-form__field" htmlFor={`${id}-title`}>
          <span className="field__label">{t('feedback.subject')}</span>
          <input
            id={`${id}-title`}
            className="field__input"
            value={title}
            maxLength={FEEDBACK_TITLE_MAX}
            placeholder={t(`feedback.subject.${kind}`)}
            autoFocus
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label className="event-form__field" htmlFor={`${id}-body`}>
          <span className="field__label">{t('feedback.details')}</span>
          <textarea
            id={`${id}-body`}
            className="field__input"
            rows={6}
            value={body}
            maxLength={FEEDBACK_BODY_MAX}
            placeholder={t(`feedback.details.${kind}`)}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
        </label>
        <Checkbox checked={withDiagnostics} onChange={setWithDiagnostics}>
          {t('feedback.diagnostics', { app: diagnostics.appVersion, os: diagnostics.os })}
        </Checkbox>
        <p className="field__hint">{t('feedback.public')}</p>
        {error && <p className="field__error">{t(error)}</p>}
      </div>
      <div className="event-form__actions">
        <ModalClose type="button" className="button">
          {t('feedback.cancel')}
        </ModalClose>
        <button
          type="submit"
          className="button button--primary"
          disabled={!request.success || sending}
        >
          {t('feedback.send')}
        </button>
      </div>
    </form>
  );
}
