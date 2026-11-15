/**
 * Mentions in a message body (A22): `@username` (A53 usernames) and `@everyone`. Text inside
 * inline code or fenced code blocks is ignored, so pasting code that contains an @ pings nobody.
 */
export interface Mentions {
  /** Lowercase usernames, each once, in order of appearance. They may not exist. */
  usernames: string[];
  everyone: boolean;
}

/** Fenced blocks (``` or ~~~, to the matching fence or the end) and `inline code` spans. */
const CODE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[ \t]*(?=\n|$)|$)|(`+)[\s\S]*?\3/g;
/** `@name` not preceded by a word character, a dot, or another @ (so emails don't match). */
const MENTION = /(?<![\p{L}\p{N}_.@])@([a-z0-9._]{3,20})(?![a-z0-9_])/giu;

export function extractMentions(body: string): Mentions {
  const prose = body.replace(CODE, (match) => match.replace(/[^\n]/g, ' '));
  const usernames: string[] = [];
  let everyone = false;
  for (const [, raw] of prose.matchAll(MENTION)) {
    // A trailing dot ends the sentence, not the name: "selam @omer." mentions "omer".
    const name = raw?.toLowerCase().replace(/\.+$/, '');
    if (!name || name.length < 3) continue;
    if (name === 'everyone') everyone = true;
    else if (!usernames.includes(name)) usernames.push(name);
  }
  return { usernames, everyone };
}
