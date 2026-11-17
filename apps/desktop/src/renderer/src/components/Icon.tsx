import type { LucideIcon, LucideProps } from 'lucide-react';

/**
 * Every icon in the app goes through here: Lucide line icons (lucide.dev), drawn as inline SVG
 * so they look the same on macOS and Windows, unlike emoji or symbol characters. Icons size
 * with the surrounding text (1.15em) and take its colour; they are decorative unless given a
 * label, since the button around them already carries one.
 */
export function Icon({
  icon: Glyph,
  label,
  className,
  ...rest
}: { icon: LucideIcon; label?: string } & Omit<LucideProps, 'ref'>) {
  return (
    <Glyph
      className={className ? `icon ${className}` : 'icon'}
      size="1.15em"
      strokeWidth={2}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
    />
  );
}
