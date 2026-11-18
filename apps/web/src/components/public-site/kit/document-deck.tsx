import { DocumentPicture } from '../../pictures/document-picture';
import { PassportCover } from '../../pictures/passport-cover';
import { DOC_NAME, DOC_TYPE, type DocKind } from './doc-kinds';
import './kit-steps.css';
import './kit.css';

export interface DocumentDeckProps {
  /**
   * Five kinds, left to right. The middle one is the hero (the passport). With fewer than five,
   * the first ones are used from the left.
   */
  readonly docs: readonly DocKind[];
  /** Plain words for the whole picture, read once by a screen reader. */
  readonly label: string;
  /** Marks the figure as English on a Bangla page. */
  readonly lang?: string;
}

const SLOTS = ['far-left', 'left', 'hero', 'right', 'far-right'] as const;

/**
 * Five paper drawings that fly in from scattered places and fan into a deck around the hero as the
 * scene scrolls (CSS from the scene's --p, transform only). With no scene, without motion, with
 * data saver or on a phone the deck rests fanned and still. The pictures are the ones the product
 * already draws (`DocumentPicture`), and the hero passport is the real Bangladesh cover (the type of
 * cover, never anyone's own): never a face, number or word from anyone's file.
 */
export function DocumentDeck({ docs, label, lang }: DocumentDeckProps) {
  return (
    <div className="kit-deck" role="img" aria-label={label} {...(lang ? { lang } : {})}>
      {docs.slice(0, SLOTS.length).map((kind, index) => (
        <span
          className="kit-deck-doc"
          data-slot={SLOTS[index]}
          data-kind={kind}
          key={`${index}-${kind}`}
        >
          {kind === 'passport' && SLOTS[index] === 'hero' ? (
            <PassportCover nationality="BD" width={220} decorative />
          ) : (
            <DocumentPicture type={DOC_TYPE[kind]} label={DOC_NAME[kind]} size={160} />
          )}
        </span>
      ))}
    </div>
  );
}
