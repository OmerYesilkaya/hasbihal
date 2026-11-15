import { parseMarkdown, type Block, type Inline } from '../markdown/index.ts';

/** Previews per message (A24): the first few links are enough. */
export const PREVIEWS_MAX = 3;

/**
 * The links a message would preview, in order, without repeats. Links in spoilers are left out
 * (a preview would give them away), and so are links in code, which the parser doesn't link.
 */
export function extractLinks(body: string, max = PREVIEWS_MAX): string[] {
  const urls: string[] = [];
  const visitInline = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (urls.length >= max) return;
      if (node.type === 'link') {
        if (!urls.includes(node.url)) urls.push(node.url);
      } else if (node.type !== 'spoiler' && 'children' in node) visitInline(node.children);
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
  return urls;
}
