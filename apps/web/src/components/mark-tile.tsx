import type { ItemMark } from '../lib/item-icons';
import { Icon } from './icons';

export type MarkTileSize = 'sm' | 'md' | 'lg';

const ICON_SIZE: Readonly<Record<MarkTileSize, number>> = { sm: 16, md: 18, lg: 26 };

/**
 * A flat line icon in a soft tone tile: what a thing is, or where it stands, at a glance. The
 * picture and the tone come from `lib/item-icons.ts` (never chosen on a screen); the tone is one
 * of the six Harbor tones. The tile is hidden from screen readers because the plain word beside it
 * is always the name. Add `className` to place it; its size does not add height to a 56px row.
 */
export function MarkTile({
  mark,
  size = 'md',
  className,
}: {
  readonly mark: ItemMark;
  readonly size?: MarkTileSize;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={className ? `mark-tile ${className}` : 'mark-tile'}
      data-size={size}
      data-mark={mark.icon}
      {...(mark.tone === 'neutral' ? { 'data-neutral': '' } : { 'data-tone': mark.tone })}
      aria-hidden="true"
    >
      <Icon name={mark.icon} size={ICON_SIZE[size]} />
    </span>
  );
}
