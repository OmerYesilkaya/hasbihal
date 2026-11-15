import type { LinkPreview } from '@hasbihal/protocol';
import { useFileAddresses } from '../files.ts';
import { useChat } from './context.tsx';

/** Pictures this much wider than tall (video stills, article banners) show large, below. */
const WIDE = 1.6;

/** A message's link cards (A24): what the server found on the pages it links. */
export function LinkPreviews({ previews }: { previews: LinkPreview[] }) {
  return (
    <div className="previews">
      {previews.map((p) => (
        <Preview key={p.url} preview={p} />
      ))}
    </div>
  );
}

function Preview({ preview }: { preview: LinkPreview }) {
  const { info } = useChat();
  const { image } = preview;
  const addresses = useFileAddresses(info.serverUrl, image?.id ?? null);
  const wide = image?.width && image.height ? image.width / image.height >= WIDE : false;
  const host = new URL(preview.url).hostname.replace(/^www\./, '');
  const picture = image && addresses && (
    <img className="preview__image" src={addresses.original} alt="" draggable={false} />
  );
  return (
    <a
      className="preview"
      data-wide={wide ? true : undefined}
      data-testid="link-preview"
      href={preview.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="preview__text">
        <span className="preview__site">{preview.siteName ?? host}</span>
        <span className="preview__title">{preview.title}</span>
        {preview.description && <span className="preview__description">{preview.description}</span>}
      </span>
      {picture}
    </a>
  );
}
