import { useMemo, useState, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@hasbihal/core';
import { useT } from '../i18n.tsx';
import { useChatState, useMembersByUsername } from './context.tsx';
import { highlight } from './highlight.tsx';

/**
 * A message body (A47, A48). Each AST node becomes one fixed element; there is no path from a
 * message to raw HTML. Links open in the system browser (the window-open handler does that).
 */
export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="md">{renderBlocks(blocks)}</div>;
}

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((block, i) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={i} className="md-p">
            {renderInline(block.children)}
          </p>
        );
      case 'code_block':
        return <CodeBlock key={i} language={block.language} text={block.text} />;
      case 'quote':
        return (
          <blockquote key={i} className="md-quote">
            {renderBlocks(block.children)}
          </blockquote>
        );
      case 'list': {
        const items = block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
        return block.ordered ? (
          <ol key={i} className="md-list" start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={i} className="md-list">
            {items}
          </ul>
        );
      }
    }
  });
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'bold':
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case 'italic':
        return <em key={i}>{renderInline(node.children)}</em>;
      case 'strike':
        return <s key={i}>{renderInline(node.children)}</s>;
      case 'code':
        return (
          <code key={i} className="md-code">
            {node.text}
          </code>
        );
      case 'spoiler':
        return <Spoiler key={i}>{renderInline(node.children)}</Spoiler>;
      case 'link':
        return (
          <a key={i} className="md-link" href={node.url} target="_blank" rel="noreferrer noopener">
            {node.url}
          </a>
        );
      case 'mention':
        return <Mention key={i} username={node.username} />;
      case 'everyone':
        return (
          <span key={i} className="mention" data-me>
            @everyone
          </span>
        );
      case 'break':
        return <br key={i} />;
    }
  });
}

/** Hidden until clicked (A48). */
function Spoiler({ children }: { children: ReactNode }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  if (shown) return <span className="spoiler spoiler--shown">{children}</span>;
  return (
    <span
      className="spoiler"
      role="button"
      tabIndex={0}
      aria-label={t('message.spoiler')}
      onClick={() => {
        setShown(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setShown(true);
      }}
    >
      {children}
    </span>
  );
}

/** A member's display name in a pill; highlighted when it's you. Unknown names stay text. */
function Mention({ username }: { username: string }) {
  const members = useMembersByUsername();
  const { me } = useChatState();
  const member = members.get(username);
  if (!member) return `@${username}`;
  return (
    <span
      className="mention"
      data-me={member.id === me?.id ? true : undefined}
      title={`@${username}`}
    >
      @{member.displayName}
    </span>
  );
}

function CodeBlock({ language, text }: { language: string | null; text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const code = useMemo(() => highlight(text, language), [text, language]);
  return (
    <div className="md-codeblock">
      <div className="md-codeblock__bar">
        <span>{language ?? ''}</span>
        <button
          type="button"
          className="link"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            });
          }}
        >
          {copied ? t('message.copied') : t('message.copy')}
        </button>
      </div>
      <pre>
        <code className="hljs">{code}</code>
      </pre>
    </div>
  );
}
