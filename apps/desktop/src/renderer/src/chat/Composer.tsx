import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { decorate, foldTurkish, newId, type Decoration, type MessageKey } from '@hasbihal/core';
import { Message, MESSAGE_BODY_MAX, type User } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { useT } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';

/** Typing notices go out at most this often while typing (the server throttles too). */
const TYPING_EVERY_MS = 3_000;
const MAX_SUGGESTIONS = 6;
const MAX_HEIGHT_PX = 240;

interface ComposerProps {
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
  const pending = useRef<{ id: string; body: string } | null>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [error, setError] = useState<MessageKey | null>(null);
  const [selected, setSelected] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

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

  const insertMention = (choice: User | 'everyone') => {
    const name = choice === 'everyone' ? 'everyone' : choice.username;
    const start = caret - query.length - 1;
    const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
    const position = start + name.length + 2;
    setText(next);
    setCaret(position);
    setSelected(0);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(position, position);
    });
  };

  // ---- sending ---------------------------------------------------------------------------

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
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

    const id = pending.current?.body === body ? pending.current.id : newId();
    pending.current = { id, body };
    setText('');
    onCancel();
    const result = await api(info.serverUrl, 'POST', `/rooms/${roomId}/messages`, {
      body: { id, body, ...(replyTo ? { replyToId: replyTo.id } : {}) },
      schema: Message,
    });
    if (result.ok && result.value) {
      pending.current = null;
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
      <div className="composer__field">
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
      </div>
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
