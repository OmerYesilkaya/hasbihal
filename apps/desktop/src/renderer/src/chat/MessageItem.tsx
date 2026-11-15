import { memo, useState } from 'react';
import { parseMarkdown, toPlainText } from '@hasbihal/core';
import type { Message } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
import { formatDateTime, formatTime, useT } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';
import { MarkdownView } from './Markdown.tsx';

/** A small, fixed set; no picker library and no emoji search (A23-style simplicity). */
export const QUICK_REACTIONS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🙏',
  '🎉',
  '🔥',
  '👏',
  '😍',
  '🤔',
  '👀',
  '✅',
  '❌',
  '🌷',
  '☕',
];

interface MessageItemProps {
  message: Message;
  /** First message of a run by the same author: shows avatar, name, and time. */
  startsGroup: boolean;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  startsGroup,
  onReply,
  onEdit,
}: MessageItemProps) {
  const t = useT();
  const { info } = useChat();
  const { members, me } = useChatState();
  const [picking, setPicking] = useState(false);
  const author = members.get(message.authorId);
  const mine = message.authorId === me?.id;
  const deleted = message.deletedAt !== null;
  const replyAuthor = message.replyTo ? members.get(message.replyTo.authorId) : undefined;

  const react = (emoji: string, add: boolean) => {
    setPicking(false);
    void api(
      info.serverUrl,
      add ? 'PUT' : 'DELETE',
      `/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`,
    );
  };

  const remove = () => {
    if (window.confirm(t('message.confirmDelete')))
      void api(info.serverUrl, 'DELETE', `/messages/${message.id}`);
  };

  return (
    <article
      className="message"
      data-group-start={startsGroup ? true : undefined}
      data-testid="message"
      data-message-id={message.id}
    >
      <div className="message__gutter">
        {startsGroup && author ? (
          <Avatar user={author} />
        ) : (
          <time
            className="message__hover-time"
            dateTime={message.createdAt}
            title={formatDateTime(message.createdAt)}
          >
            {formatTime(message.createdAt)}
          </time>
        )}
      </div>
      <div className="message__main">
        {startsGroup && (
          <header className="message__header">
            <span className="message__author">
              {author?.displayName ?? t('message.unknownAuthor')}
            </span>
            <time
              className="message__time"
              dateTime={message.createdAt}
              title={formatDateTime(message.createdAt)}
            >
              {formatTime(message.createdAt)}
            </time>
          </header>
        )}
        {message.replyTo && (
          <div className="message__reply">
            <span className="message__reply-author">
              ↪ {replyAuthor?.displayName ?? t('message.unknownAuthor')}
            </span>{' '}
            {message.replyTo.deleted ? (
              <em>{t('message.deleted')}</em>
            ) : (
              toPlainText(parseMarkdown(message.replyTo.excerpt))
            )}
          </div>
        )}
        {deleted ? (
          <p className="message__deleted">{t('message.deleted')}</p>
        ) : (
          <div className="message__body" data-testid="message-body">
            <MarkdownView source={message.body} />
            {message.editedAt && (
              <span className="message__edited" title={formatDateTime(message.editedAt)}>
                ({t('message.edited')})
              </span>
            )}
          </div>
        )}
        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((r) => {
              const mineToo = me !== null && r.userIds.includes(me.id);
              const names = r.userIds.map((id) => members.get(id)?.displayName ?? '?').join(', ');
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className="reaction"
                  data-mine={mineToo ? true : undefined}
                  title={names}
                  onClick={() => {
                    react(r.emoji, !mineToo);
                  }}
                >
                  <span>{r.emoji}</span> {r.userIds.length}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!deleted && (
        <div className="message__toolbar" role="toolbar" aria-label={t('message.actions')}>
          <button
            type="button"
            className="icon-button"
            title={t('message.react')}
            aria-label={t('message.react')}
            onClick={() => {
              setPicking((p) => !p);
            }}
          >
            ☺
          </button>
          <button
            type="button"
            className="icon-button"
            title={t('message.reply')}
            aria-label={t('message.reply')}
            onClick={() => {
              onReply(message);
            }}
          >
            ↩
          </button>
          {mine && (
            <>
              <button
                type="button"
                className="icon-button"
                title={t('message.edit')}
                aria-label={t('message.edit')}
                onClick={() => {
                  onEdit(message);
                }}
              >
                ✎
              </button>
              <button
                type="button"
                className="icon-button"
                title={t('message.delete')}
                aria-label={t('message.delete')}
                onClick={remove}
              >
                🗑
              </button>
            </>
          )}
        </div>
      )}
      {picking && (
        <div className="reaction-picker" role="menu">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              className="reaction-picker__emoji"
              onClick={() => {
                react(emoji, true);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </article>
  );
});
