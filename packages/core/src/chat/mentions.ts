import type { Block, Inline } from '../markdown/ast.ts';
import { parseMarkdown } from '../markdown/parse.ts';

/**
 * Mentions in a message body (A22): `@username` (A53 usernames) and `@everyone`. They come from
 * the same parser that renders the message, so what's highlighted is exactly what notifies, and
 * text inside code never pings anyone.
 */
export interface Mentions {
  /** Lowercase usernames, each once, in order of appearance. They may not exist. */
  usernames: string[];
  everyone: boolean;
}

export function extractMentions(body: string): Mentions {
  const usernames: string[] = [];
  let everyone = false;
  const visitInline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'mention' && !usernames.includes(node.username))
        usernames.push(node.username);
      else if (node.type === 'everyone') everyone = true;
      else if ('children' in node) visitInline(node.children);
    }
  };
  const visitBlocks = (blocks: Block[]) => {
    for (const block of blocks) {
      if (block.type === 'paragraph') visitInline(block.children);
      else if (block.type === 'quote') visitBlocks(block.children);
      else if (block.type === 'list') block.items.forEach(visitInline);
    }
  };
  visitBlocks(parseMarkdown(body));
  return { usernames, everyone };
}
