/**
 * The message-formatting AST (DECISIONS A47, A48). It is a closed set of node types: the UI
 * renders each one to a fixed element, so nothing in a message can produce raw HTML.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike' | 'spoiler'; children: Inline[] }
  | { type: 'code'; text: string }
  /** An auto-linked http(s) URL, shown as itself (no masked links: they can hide the target). */
  | { type: 'link'; url: string }
  /** `@username`; the UI decides whether it names a member. */
  | { type: 'mention'; username: string }
  | { type: 'everyone' }
  /** A newline: in chat, every newline is a line break. */
  | { type: 'break' };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code_block'; language: string | null; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] };

/** What a source range is, for the composer's live formatting. `marker` is syntax to dim. */
export type DecorationKind =
  | 'marker'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'spoiler'
  | 'code'
  | 'code_block'
  | 'link'
  | 'mention'
  | 'everyone';

export interface Decoration {
  kind: DecorationKind;
  /** Source offsets, `to` exclusive. */
  from: number;
  to: number;
}
