import { useEffect, useRef, useState, type ReactNode } from 'react';
import { foldTurkish, parseMarkdown, toPlainText } from '@hasbihal/core';
import { type Message } from '@hasbihal/protocol';
import { useChat, useChatState } from '../chat/context.tsx';
import { formatDateTime, useT } from '../i18n.tsx';
import { EmptyState } from './EmptyState.tsx';
import { Paperclip } from 'lucide-react';
import { Icon } from './Icon.tsx';

/** Searching starts from this many characters; one letter matches half the archive. */
const MIN_LENGTH = 2;
const DEBOUNCE_MS = 250;
/** Around the first match, this much of a long message is shown. */
const EXCERPT = 160;

const wordsOf = (q: string) =>
  q
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(foldTurkish);

interface Found {
  query: string;
  messages: Message[];
  hasMore: boolean;
}

/**
 * Search across every room (A27), in the right-hand column: while there is a query it shows
 * results, newest first, in place of the member list (`children`).
 */
export function SearchPanel({
  onOpenRoom,
  children,
}: {
  onOpenRoom: (roomId: string) => void;
  children: ReactNode;
}) {
  const t = useT();
  const { client } = useChat();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const active = query.trim().length >= MIN_LENGTH;

  // ⌘F / Ctrl+F: there is no page to find in, so it searches the messages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const run = async (q: string, before?: string) => {
    const ticket = ++latest.current;
    const result = await client.search({ q, ...(before ? { before } : {}) });
    if (ticket !== latest.current) return; // a newer search has started
    if (!result.ok) {
      setFailed(true);
      return;
    }
    const page = result.value;
    setFailed(false);
    setFound((previous) => ({
      query: q,
      messages: before && previous ? [...previous.messages, ...page.messages] : page.messages,
      hasMore: page.hasMore,
    }));
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_LENGTH) return;
    const timer = setTimeout(() => void run(q), DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
    // `run` reads only stable values and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const current = active && found?.query === query.trim() ? found : null;
  return (
    <>
      <div className="search">
        <input
          ref={input}
          className="search__input"
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              setFound(null);
            }
          }}
        />
      </div>
      {!active ? (
        children
      ) : (
        <div className="search__results" data-testid="search-results" aria-live="polite">
          {failed ? (
            <p className="search__note">{t('error.unavailable')}</p>
          ) : !current ? (
            <p className="search__note">{t('search.searching')}</p>
          ) : current.messages.length === 0 ? (
            <EmptyState>{t('search.none')}</EmptyState>
          ) : (
            <>
              {current.messages.map((m) => (
                <Result
                  key={m.id}
                  message={m}
                  words={wordsOf(current.query)}
                  onOpen={() => {
                    onOpenRoom(m.roomId);
                  }}
                />
              ))}
              {current.hasMore && (
                <button
                  type="button"
                  className="link search__more"
                  onClick={() => void run(current.query, current.messages.at(-1)?.id)}
                >
                  {t('search.more')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

function Result({
  message,
  words,
  onOpen,
}: {
  message: Message;
  words: string[];
  onOpen: () => void;
}) {
  const t = useT();
  const { rooms, members } = useChatState();
  const text = toPlainText(parseMarkdown(message.body));
  return (
    <button type="button" className="search-result" data-testid="search-result" onClick={onOpen}>
      <span className="search-result__meta">
        <span className="search-result__room"># {rooms.get(message.roomId)?.name ?? '?'}</span>
        <span>{formatDateTime(message.createdAt)}</span>
      </span>
      <span className="search-result__author">
        {members.get(message.authorId)?.displayName ?? '?'}
      </span>
      <span className="search-result__text">{highlighted(excerpt(text, words), words)}</span>
      {message.attachments.length > 0 && (
        <span className="search-result__files">
          <Icon icon={Paperclip} /> {t('search.files', { count: message.attachments.length })}
        </span>
      )}
    </button>
  );
}

/** A long message cut around its first match, so the match is visible. */
function excerpt(text: string, words: string[]): string {
  if (text.length <= EXCERPT) return text;
  const folded = foldTurkish(text);
  const at = Math.max(0, Math.min(...words.map((w) => folded.indexOf(w)).filter((i) => i >= 0)));
  const start = Math.max(0, Math.min(at - 40, text.length - EXCERPT));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + EXCERPT).trim()}${start + EXCERPT < text.length ? '…' : ''}`;
}

/** Marks the words that start with what was searched for, the way the server matched them. */
function highlighted(text: string, words: string[]): ReactNode[] {
  return text.split(/([\p{L}\p{N}]+)/u).map((piece, i) => {
    const folded = foldTurkish(piece);
    return piece && words.some((w) => folded.startsWith(w)) ? <mark key={i}>{piece}</mark> : piece;
  });
}
