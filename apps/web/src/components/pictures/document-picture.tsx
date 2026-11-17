import type { ReactNode } from 'react';
import { type DocumentPictureChoice, documentPicture } from '../../lib/document-picture';
import { Icon } from '../icons';
import { DOCUMENT_CANVAS, documentDrawing, hasDocumentDrawing } from './document-drawings';
import { pictureNaming } from './picture-naming';
import { SaveDataFlag } from './save-data-flag';
import './pictures-depth.css';

/**
 * The illustration of a document type, drawn on the server as inline SVG (no file to download,
 * nothing for the page security policy to allow). It shows what KIND of paper a thing is, in the
 * kind's Harbor tone, and never anything from the paper itself.
 *
 * Anything without an illustration (a form, an unknown word, a missing drawing) shows today's
 * icon for that type instead, in the same tone, so the screen never shows an empty hole.
 *
 * Naming: pass `label` when the picture stands alone and carries meaning (it becomes the picture's
 * accessible name). Leave it out when the plain word sits right next to it: the picture is then
 * decoration and hidden from screen readers.
 *
 * Depth: `depth` adds the soft shadow from `pictures-depth.css`. Motion classes (`pic-float`,
 * `pic-arrive`) are passed through `className`; at most one moving hero per screen.
 */
export interface DocumentPictureProps {
  /** A stored document type, a catalogue key or a typed name, as `documentMark` accepts. */
  readonly type: string | null | undefined;
  /** Accessible name when the picture stands alone; omit when the word is beside it. */
  readonly label?: string | undefined;
  /** Width in CSS pixels; the height follows the 64 x 80 sheet. Default 64. */
  readonly size?: number | undefined;
  /** For a type with no kind of its own: today's icon (default) or the generic paper picture. */
  readonly generic?: 'icon' | 'picture' | undefined;
  /** Adds the soft resting shadow. */
  readonly depth?: boolean | undefined;
  /** Extra classes, for placement or one of the motion classes in `pictures-depth.css`. */
  readonly className?: string | undefined;
}

function classes(...names: ReadonlyArray<string | false | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** The shapes for a choice, or null when the picture cannot be drawn and the icon must show. */
function drawingFor(choice: DocumentPictureChoice): ReactNode {
  if (choice.kind !== 'picture' || !hasDocumentDrawing(choice.picture)) return null;
  try {
    return documentDrawing(choice.picture);
  } catch {
    return null;
  }
}

export function DocumentPicture({
  type,
  label,
  size = 64,
  generic = 'icon',
  depth = false,
  className,
}: DocumentPictureProps) {
  const choice = documentPicture(type, { generic });
  const drawing = drawingFor(choice);
  const tone = choice.mark.tone === 'neutral' ? {} : { 'data-tone': choice.mark.tone };
  const width = Math.max(16, Math.round(size));
  const height = Math.round((width * DOCUMENT_CANVAS.height) / DOCUMENT_CANVAS.width);

  if (drawing === null) {
    return (
      <span
        className={classes('pic', 'pic-fallback', depth && 'pic-depth', className)}
        data-picture="icon"
        data-mark={choice.mark.icon}
        {...tone}
        {...pictureNaming(label)}
      >
        <Icon name={choice.mark.icon} size={Math.max(16, Math.round(width / 2))} />
        <SaveDataFlag />
      </span>
    );
  }

  return (
    <span
      className={classes('pic', 'pic-document', depth && 'pic-depth', className)}
      data-picture={choice.kind === 'picture' ? choice.picture : 'icon'}
      {...tone}
      {...pictureNaming(label)}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${DOCUMENT_CANVAS.width} ${DOCUMENT_CANVAS.height}`}
        aria-hidden="true"
        focusable="false"
      >
        {drawing}
      </svg>
      <SaveDataFlag />
    </span>
  );
}
