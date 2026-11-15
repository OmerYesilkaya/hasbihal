/** What a page says about itself, for its preview card (ARCHITECTURE §7). */
export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  /** Absolute http(s) address of the preview picture. */
  imageUrl: string | null;
}

const LIMITS = { title: 200, description: 300, siteName: 80 };

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

const clean = (value: string | undefined, max: number): string | null => {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name && !found.has(name)) found.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

/**
 * The character set to read the page with: the header's, else the page's own `<meta>`, else
 * UTF-8. Older Turkish sites still use windows-1254 or ISO-8859-9.
 */
export function charsetOf(contentType: string, body: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = body.subarray(0, 4096).toString('latin1');
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  return fromMeta?.toLowerCase() ?? 'utf-8';
}

export function decodeHtml(contentType: string, body: Buffer): string {
  try {
    return new TextDecoder(charsetOf(contentType, body)).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body); // an unknown label
  }
}

/** Open Graph and Twitter card metadata, with the page's `<title>` and description as fallbacks. */
export function parsePageMeta(html: string, pageUrl: string): PageMeta {
  // Only the head matters, and stopping there keeps a huge page cheap.
  const end = html.search(/<\/head>|<body[\s>]/i);
  const head = end === -1 ? html : html.slice(0, end);
  const meta = new Map<string, string>();
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const image = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image');
  let imageUrl: string | null = null;
  if (image) {
    try {
      const resolved = new URL(decodeEntities(image.trim()), pageUrl);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:')
        imageUrl = resolved.toString();
    } catch {
      imageUrl = null;
    }
  }
  return {
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? title, LIMITS.title),
    description: clean(
      meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
      LIMITS.description,
    ),
    siteName: clean(meta.get('og:site_name'), LIMITS.siteName),
    imageUrl,
  };
}
