import { memo, useState } from 'react';
import { parseMarkdown, toPlainText } from '@hasbihal/core';
import type { Message } from '@hasbihal/protocol';
import { api } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
import { formatDateTime, formatTime, useT } from '../i18n.tsx';
import { useChat, useChatState } from './context.tsx';
import { Attachments } from './Attachments.tsx';
import { LinkPreviews } from './LinkPreviews.tsx';
import { MarkdownView } from './Markdown.tsx';
import { CornerDownRight, Pencil, Plus, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker.tsx';
import { Icon } from '../components/Icon.tsx';
import { Popover } from '../components/Popover.tsx';

/** The reactions offered first; every other emoji is a click away (EmojiPicker). */
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
  const author = members.get(message.authorId);
  const mine = message.authorId === me?.id;
  const deleted = message.deletedAt !== null;
  const replyAuthor = message.replyTo ? members.get(message.replyTo.authorId) : undefined;

  const react = (emoji: string, add: boolean) => {
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
              <Icon icon={CornerDownRight} />{' '}
              {replyAuthor?.displayName ?? t('message.unknownAuthor')}
            </span>{' '}
            {message.replyTo.deleted ? (
              <em>{t('message.deleted')}</em>
            ) : !message.replyTo.excerpt ? (
              <em>{t('attachment.only')}</em>
            ) : (
              toPlainText(parseMarkdown(message.replyTo.excerpt))
            )}
          </div>
        )}
        {deleted ? (
          <p className="message__deleted">{t('message.deleted')}</p>
        ) : (
          <>
            {(message.body || message.editedAt) && (
              <div className="message__body" data-testid="message-body">
                <MarkdownView source={message.body} />
                {message.editedAt && (
                  <span className="message__edited" title={formatDateTime(message.editedAt)}>
                    ({t('message.edited')})
                  </span>
                )}
              </div>
            )}
            {message.attachments.length > 0 && <Attachments attachments={message.attachments} />}
            {message.previews.length > 0 && <LinkPreviews previews={message.previews} />}
          </>
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
          <Popover
            label={t('message.react')}
            className="reaction-picker"
            trigger={(props) => (
              <button
                type="button"
                className="icon-button"
                title={t('message.react')}
                aria-label={t('message.react')}
                {...props}
              >
                <Icon icon={SmilePlus} />
              </button>
            )}
          >
            {(close) => (
              <ReactionPicker
                onPick={(emoji) => {
                  close();
                  react(emoji, true);
                }}
              />
            )}
          </Popover>
          <button
            type="button"
            className="icon-button"
            title={t('message.reply')}
            aria-label={t('message.reply')}
            onClick={() => {
              onReply(message);
            }}
          >
            <Icon icon={Reply} />
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
                <Icon icon={Pencil} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t('message.delete')}
                aria-label={t('message.delete')}
                onClick={remove}
              >
                <Icon icon={Trash2} />
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
});

/** The quick reactions; "more" swaps them for every emoji, with search. */
function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (all) return <EmojiPicker onPick={onPick} />;
  return (
    <div className="reaction-picker__quick">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-picker__emoji"
          onClick={() => {
            onPick(emoji);
          }}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        className="reaction-picker__emoji reaction-picker__more"
        title={t('emoji.more')}
        aria-label={t('emoji.more')}
        data-testid="emoji-more"
        onClick={() => {
          setAll(true);
        }}
      >
        <Icon icon={Plus} />
      </button>
    </div>
  );
}
