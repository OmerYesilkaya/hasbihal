import { useEffect, useRef, useState } from 'react';
import {
  Apple,
  Flag,
  Lamp,
  Leaf,
  Plane,
  Shapes,
  Smile,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Icon } from '../components/Icon.tsx';
import { useLanguage, useT } from '../i18n.tsx';
import {
  EMOJI_GROUPS,
  foldForSearch,
  loadEmoji,
  type EmojiEntry,
  type EmojiGroup,
} from './emoji-data.ts';
import { Tip } from '../components/Tip.tsx';

const GROUP_ICONS: Record<EmojiGroup, LucideIcon> = {
  0: Smile,
  1: Users,
  3: Leaf,
  4: Apple,
  5: Plane,
  6: Trophy,
  7: Lamp,
  8: Shapes,
  9: Flag,
};

/**
 * Every emoji (A22 reactions), by Unicode group, with search in Turkish and English. Enter picks
 * the first match.
 */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useT();
  const { locale } = useLanguage();
  const [all, setAll] = useState<EmojiEntry[] | null>(null);
  const [query, setQuery] = useState('');
  /** Named in the footer, as a tooltip on each of ~1800 emoji would be heavy. */
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);
  const sections = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    void loadEmoji().then((list) => {
      if (current) setAll(list);
    });
    return () => {
      current = false;
    };
  }, []);

  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  const matches = all?.filter((e) => words.every((w) => e.search.includes(w))) ?? [];

  const button = (e: EmojiEntry) => (
    <button
      key={e.emoji}
      type="button"
      className="emoji-picker__emoji"
      aria-label={e.name[locale]}
      onMouseEnter={() => {
        setHovered(e);
      }}
      onFocus={() => {
        setHovered(e);
      }}
      onClick={() => {
        onPick(e.emoji);
      }}
    >
      {e.emoji}
    </button>
  );

  return (
    <div className="emoji-picker">
      <input
        className="field__input emoji-picker__search"
        type="search"
        placeholder={t('emoji.search')}
        aria-label={t('emoji.search')}
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          const first = matches[0];
          if (e.key === 'Enter' && words.length && first) onPick(first.emoji);
        }}
      />
      {!words.length && (
        <div className="emoji-picker__groups" role="toolbar" aria-label={t('emoji.groups')}>
          {EMOJI_GROUPS.map((group) => (
            <Tip label={t(`emoji.group.${group}`)} key={group}>
              <button
                type="button"
                className="icon-button"
                aria-label={t(`emoji.group.${group}`)}
                onClick={() => {
                  sections.current
                    ?.querySelector(`[data-group="${String(group)}"]`)
                    ?.scrollIntoView({ block: 'start' });
                }}
              >
                <Icon icon={GROUP_ICONS[group]} />
              </button>
            </Tip>
          ))}
        </div>
      )}
      <div ref={sections} className="emoji-picker__sections">
        {!all ? (
          <p className="field__hint">{t('emoji.loading')}</p>
        ) : words.length ? (
          matches.length ? (
            <div className="emoji-picker__grid">{matches.map(button)}</div>
          ) : (
            <p className="field__hint">{t('emoji.none')}</p>
          )
        ) : (
          EMOJI_GROUPS.map((group) => (
            <section key={group} data-group={group} className="emoji-picker__section">
              <h3 className="section-label">{t(`emoji.group.${group}`)}</h3>
              <div className="emoji-picker__grid">
                {all.filter((e) => e.group === group).map(button)}
              </div>
            </section>
          ))
        )}
      </div>
      <div className="emoji-picker__footer" aria-hidden>
        {hovered && (
          <>
            <span className="emoji-picker__preview">{hovered.emoji}</span>
            <span>{hovered.name[locale]}</span>
          </>
        )}
      </div>
    </div>
  );
}
