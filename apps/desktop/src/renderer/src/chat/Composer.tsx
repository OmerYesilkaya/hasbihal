import {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { decorate, foldTurkish, newId, type Decoration, type MessageKey } from '@hasbihal/core';
import { Message, MESSAGE_BODY_MAX, type User } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useT } from '../i18n.tsx';
import { formatSize, uploadFile } from '../files.ts';
import { currentLocale } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';
import { useUploads } from './useUploads.ts';
import { VoiceRecorder, type Recording } from './VoiceRecorder.tsx';
import { CircleEllipsis, FileText, Mic, Paperclip, X } from 'lucide-react';
import { Popover } from '../components/Popover.tsx';
import { EmojiPicker } from './EmojiPicker.tsx';
import { Icon } from '../components/Icon.tsx';
import { Progress } from '../components/controls.tsx';
import { Tip } from '../components/Tip.tsx';

/** Typing notices go out at most this often while typing (the server throttles too). */
const TYPING_EVERY_MS = 3_000;
const MAX_SUGGESTIONS = 6;
const MAX_HEIGHT_PX = 240;

/** What the room view can ask of the composer: files dropped anywhere on it. */
export interface ComposerHandle {
  addFiles(files: File[]): void;
}

interface ComposerProps {
  ref?: Ref<ComposerHandle>;
  roomId: string;
  roomName: string;
  replyTo: Message | null;
  editing: Message | null;
  /** Leaves reply or edit mode. */
  onCancel: () => void;
  /** ↑ in an empty composer: edit your last message. */
  onEditLast: () => void;
}

/**
 * Writing a message, with live formatting (A47): a real textarea, so typing, IME, undo,
 * spellcheck, and accessibility all behave natively, over a mirror that draws the same text
 * styled by the message parser. Styles keep character widths, so the caret stays aligned.
 */
export function Composer({
  ref,
  roomId,
  roomName,
  replyTo,
  editing,
  onCancel,
  onEditLast,
}: ComposerProps) {
  const t = useT();
  const { info, store, typing } = useChat();
  const { members, me } = useChatState();
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  /** A failed send keeps its id, so trying again can't create a duplicate (ARCHITECTURE §3.4). */
  const pending = useRef<{ id: string; key: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  /** Where the caret goes once a programmatic text change has rendered. */
  const caretAfterRender = useRef<number | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [error, setError] = useState<MessageKey | null>(null);
  const [selected, setSelected] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const { uploads, add, remove, retry, clear } = useUploads(info.serverUrl);
  const [recording, setRecording] = useState(false);
  /** A voice message on its way: upload progress, 0–1. */
  const [voiceProgress, setVoiceProgress] = useState<number | null>(null);

  const sendVoice = async ({ file, durationMs }: Recording) => {
    setRecording(false);
    setVoiceProgress(0);
    const replyToId = replyTo?.id;
    const upload = await uploadFile(
      info.serverUrl,
      file,
      setVoiceProgress,
      new AbortController().signal,
      { durationMs },
    );
    const result = upload.ok
      ? await api(info.serverUrl, 'POST', `/rooms/${roomId}/messages`, {
          body: {
            id: newId(),
            body: '',
            attachmentIds: [upload.value.id],
            ...(replyToId ? { replyToId } : {}),
          },
          schema: Message,
        })
      : upload;
    setVoiceProgress(null);
    if (result.ok && result.value) {
      store.apply({ type: 'message_created', message: result.value });
      onCancel();
    } else {
      setError('voice.sendFailed');
    }
    input.current?.focus();
  };
  const addFiles = (files: File[]) => {
    if (!files.length || editing) return;
    setError(add(files));
    input.current?.focus();
  };
  useImperativeHandle(ref, () => ({ addFiles }));

  // Entering edit mode loads the message; leaving it clears the field.
  const [editingId, setEditingId] = useState<string | null>(null);
  if ((editing?.id ?? null) !== editingId) {
    setEditingId(editing?.id ?? null);
    setText(editing?.body ?? '');
    setError(null);
  }

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    // Place the caret in the same commit as the new text, before the next keystroke is handled
    // (a later frame would move it after letters typed in between).
    if (caretAfterRender.current !== null) {
      el.setSelectionRange(caretAfterRender.current, caretAfterRender.current);
      caretAfterRender.current = null;
    }
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(el.scrollHeight, MAX_HEIGHT_PX))}px`;
  }, [text]);

  useLayoutEffect(() => {
    if (editing || replyTo) input.current?.focus();
  }, [editing, replyTo]);

  // ---- @mention suggestions --------------------------------------------------------------

  const token = /(?:^|[^\p{L}\p{N}_.@])@([\p{L}\p{N}._]{0,20})$/u.exec(text.slice(0, caret));
  const query = token?.[1] ?? '';
  const suggestions = useMemo((): (User | 'everyone')[] => {
    if (!token || dismissedAt === caret) return [];
    const q = foldTurkish(query);
    const people = [...members.values()]
      .filter(
        (m) =>
          m.id !== me?.id && (m.username.startsWith(q) || foldTurkish(m.displayName).includes(q)),
      )
      .slice(0, MAX_SUGGESTIONS);
    return 'everyone'.startsWith(q)
      ? [...people, 'everyone' as const].slice(0, MAX_SUGGESTIONS)
      : people;
  }, [token, query, members, me, dismissedAt, caret]);

  /** Puts `piece` where the caret is, and the caret after it. */
  const insertText = (piece: string) => {
    const position = caret + piece.length;
    caretAfterRender.current = position;
    setText(`${text.slice(0, caret)}${piece}${text.slice(caret)}`);
    setCaret(position);
  };

  const insertMention = (choice: User | 'everyone') => {
    const name = choice === 'everyone' ? 'everyone' : choice.username;
    const start = caret - query.length - 1;
    const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
    const position = start + name.length + 2;
    caretAfterRender.current = position;
    setText(next);
    setCaret(position);
    setSelected(0);
  };

  // ---- sending ---------------------------------------------------------------------------

  const submit = async () => {
    const body = text.trim();
    const files = editing ? [] : uploads;
    if (!body && !files.length && !editing) return;
    if (files.some((u) => u.status === 'uploading')) {
      setError('composer.stillUploading');
      return;
    }
    if (files.some((u) => u.status === 'failed')) {
      setError('composer.uploadFailed');
      return;
    }
    if (body.length > MESSAGE_BODY_MAX) {
      setError('composer.tooLong');
      return;
    }
    setError(null);

    if (editing) {
      if (body === editing.body) {
        onCancel();
        return;
      }
      const result = await api(info.serverUrl, 'PATCH', `/messages/${editing.id}`, {
        body: { body },
        schema: Message,
      });
      if (!result.ok || !result.value) {
        setError(
          result.ok
            ? 'error.unexpected'
            : result.error.code === 'unavailable'
              ? 'error.unavailable'
              : 'error.unexpected',
        );
        return;
      }
      store.apply({ type: 'message_updated', message: result.value });
      onCancel();
      return;
    }

    const attachmentIds = files.flatMap((u) => (u.attachment ? [u.attachment.id] : []));
    const key = `${body}\n${attachmentIds.join(',')}`;
    const id = pending.current?.key === key ? pending.current.id : newId();
    pending.current = { id, key };
    setText('');
    onCancel();
    const result = await api(info.serverUrl, 'POST', `/rooms/${roomId}/messages`, {
      body: { id, body, attachmentIds, ...(replyTo ? { replyToId: replyTo.id } : {}) },
      schema: Message,
    });
    if (result.ok && result.value) {
      pending.current = null;
      clear();
      store.apply({ type: 'message_created', message: result.value });
      return;
    }
    // Give the text back (unless they've started a new one) so nothing typed is lost.
    setText((current) => current || body);
    setError(
      result.ok
        ? 'error.unexpected'
        : result.error.code === 'unavailable'
          ? 'composer.sendFailed'
          : 'error.unexpected',
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSelected((s) => (s + step + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const choice = suggestions[Math.min(selected, suggestions.length - 1)];
        if (choice) insertMention(choice);
        return;
      }
      if (e.key === 'Escape') {
        setDismissedAt(caret);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && (editing || replyTo)) {
      onCancel();
    } else if (e.key === 'ArrowUp' && !text && !editing) {
      e.preventDefault();
      onEditLast();
    }
  };

  const replyAuthor = replyTo ? members.get(replyTo.authorId)?.displayName : undefined;

  return (
    <div className="composer">
      {(replyTo ?? editing) && (
        <div className="composer__banner">
          <span>
            {editing
              ? t('composer.editing')
              : t('composer.replyingTo', { name: replyAuthor ?? '?' })}
          </span>
          <button type="button" className="link" onClick={onCancel}>
            {t('composer.cancel')}
          </button>
        </div>
      )}
      {error && (
        <p className="composer__error" role="alert">
          {t(error)}
        </p>
      )}
      {!editing && uploads.length > 0 && (
        <ul className="uploads" aria-label={t('composer.files')}>
          {uploads.map((u) => (
            <li key={u.key} className="upload" data-status={u.status} data-testid="upload">
              {u.preview ? (
                <img className="upload__preview" src={u.preview} alt="" />
              ) : (
                <span className="upload__preview upload__preview--file" aria-hidden>
                  <Icon icon={FileText} />
                </span>
              )}
              <span className="upload__text">
                <span className="upload__name">{u.file.name}</span>
                <span className="upload__size">
                  {u.status === 'failed' && u.error
                    ? t(u.error)
                    : formatSize(u.file.size, currentLocale())}
                </span>
              </span>
              {u.status === 'uploading' && (
                <Progress className="upload__progress" value={u.progress} />
              )}
              {u.status === 'failed' && (
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    retry(u.key);
                  }}
                >
                  {t('composer.retry')}
                </button>
              )}
              <button
                type="button"
                className="upload__remove"
                aria-label={t('composer.removeFile', { name: u.file.name })}
                onClick={() => {
                  remove(u.key);
                }}
              >
                <Icon icon={X} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {recording ? (
        <VoiceRecorder
          onSend={(r) => void sendVoice(r)}
          onCancel={(why) => {
            setRecording(false);
            setError(why ?? null);
          }}
        />
      ) : voiceProgress !== null ? (
        <div className="recorder">
          <span className="recorder__hint">{t('voice.sending')}</span>
          <Progress className="recorder__progress" value={voiceProgress} />
        </div>
      ) : (
        <div className="composer__field">
          {!editing && (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                data-testid="file-picker"
                onChange={(e) => {
                  addFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <div className="composer__mirror" ref={mirror} aria-hidden>
            {renderDecorated(text)}
            {'​'}
          </div>
          <textarea
            ref={input}
            className="composer__input"
            rows={1}
            value={text}
            placeholder={t('composer.placeholder', { room: roomName })}
            aria-label={t('composer.label')}
            spellCheck
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
              setDismissedAt(null);
              setSelected(0);
              const now = Date.now();
              if (!editing && e.target.value.trim() && now - lastTyping.current > TYPING_EVERY_MS) {
                lastTyping.current = now;
                typing(roomId);
              }
            }}
            onSelect={(e) => {
              setCaret(e.currentTarget.selectionStart);
            }}
            onScroll={(e) => {
              if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              // Pasted pictures and files (a screenshot, a copied photo) become attachments.
              const files = [...e.clipboardData.files];
              if (!files.length || editing) return;
              e.preventDefault();
              addFiles(files);
            }}
          />
          {suggestions.length > 0 && (
            <ul className="suggestions" role="listbox" aria-label={t('composer.mentions')}>
              {suggestions.map((choice, i) => (
                <li
                  key={choice === 'everyone' ? 'everyone' : choice.id}
                  role="option"
                  aria-selected={i === selected}
                >
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep the textarea focused
                      insertMention(choice);
                    }}
                  >
                    {choice === 'everyone' ? (
                      <>
                        <strong>@everyone</strong> <span>{t('composer.everyone')}</span>
                      </>
                    ) : (
                      <>
                        <strong>{choice.displayName}</strong> <span>@{choice.username}</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* #36: files, a voice message and emoji, behind one button on the right. */}
          <Popover
            label={t('composer.more')}
            className="composer__more-panel"
            placement="above-end"
            onCloseFocus={() => input.current?.focus()}
            trigger={
              <Tip label={t('composer.more')}>
                <button
                  type="button"
                  className="composer__more"
                  aria-label={t('composer.more')}
                  data-testid="composer-more"
                >
                  <Icon icon={CircleEllipsis} />
                </button>
              </Tip>
            }
          >
            {(close) => (
              <>
                {!editing && (
                  <div className="composer__actions">
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close();
                        picker.current?.click();
                      }}
                    >
                      <Icon icon={Paperclip} /> {t('composer.attach')}
                    </button>
                    {/* A voice message replaces what's typed, so only with nothing typed. */}
                    {!text && uploads.length === 0 && (
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          setError(null);
                          setRecording(true);
                        }}
                      >
                        <Icon icon={Mic} /> {t('voice.record')}
                      </button>
                    )}
                  </div>
                )}
                <EmojiPicker
                  onPick={(emoji) => {
                    insertText(emoji);
                    close();
                  }}
                />
              </>
            )}
          </Popover>
        </div>
      )}
      {text.length > MESSAGE_BODY_MAX - 500 && (
        <p
          className="composer__count"
          data-over={text.length > MESSAGE_BODY_MAX ? true : undefined}
        >
          {text.length} / {MESSAGE_BODY_MAX}
        </p>
      )}
    </div>
  );
}

/**
 * The text split at every decoration boundary, each piece styled by the decorations covering it.
 * Decorations nest, so a piece can be, say, bold and a marker at once.
 */
function renderDecorated(text: string): ReactNode[] {
  const decorations: Decoration[] = decorate(text);
  if (!decorations.length) return [text];
  const cuts = new Set([0, text.length]);
  for (const d of decorations) {
    cuts.add(d.from);
    cuts.add(d.to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces: ReactNode[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const from = points[k] ?? 0;
    const to = points[k + 1] ?? 0;
    const kinds = decorations
      .filter((d) => d.from <= from && d.to >= to)
      .map((d) => `dk-${d.kind}`);
    const piece = text.slice(from, to);
    pieces.push(
      kinds.length ? (
        <span key={from} className={kinds.join(' ')}>
          {piece}
        </span>
      ) : (
        piece
      ),
    );
  }
  return pieces;
}
