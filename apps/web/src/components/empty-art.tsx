import type { ItemMark } from '../lib/item-icons';
import { MarkTile } from './mark-tile';

/** The three places that can be empty and have a small drawing of their own. */
export type EmptyArtKind = 'documents' | 'trips' | 'sharing';

/**
 * Three small flat spot drawings built from the product's own icons: the middle tile is large, the
 * two beside it small. They say what belongs in the empty place (papers, a trip, who can see what)
 * before a word is read. No shadow, no gradient, no new colour: the six Harbor tones only.
 */
const ART: Readonly<Record<EmptyArtKind, readonly [ItemMark, ItemMark, ItemMark]>> = {
  documents: [
    { icon: 'docBank', tone: 'teal' },
    { icon: 'docPassport', tone: 'blue' },
    { icon: 'docCertificate', tone: 'violet' },
  ],
  trips: [
    { icon: 'docHotel', tone: 'violet' },
    { icon: 'plane', tone: 'blue' },
    { icon: 'tripTourist', tone: 'teal' },
  ],
  sharing: [
    { icon: 'lock', tone: 'violet' },
    { icon: 'share', tone: 'blue' },
    { icon: 'users', tone: 'teal' },
  ],
};

export function EmptyArt({ kind }: { readonly kind: EmptyArtKind }) {
  const [left, middle, right] = ART[kind];
  return (
    <span className="empty-art" data-art={kind} aria-hidden="true">
      <MarkTile mark={left} size="sm" />
      <MarkTile mark={middle} size="lg" />
      <MarkTile mark={right} size="sm" />
    </span>
  );
}
