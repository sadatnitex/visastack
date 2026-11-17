import type { ReactNode } from 'react';
import type { DocumentPictureName } from '../../lib/document-picture';

/**
 * The document illustrations: one small flat drawing per document kind, in one style.
 *
 * Style rules (keep them when adding a drawing):
 * - Canvas is 64 x 80 (a portrait sheet), drawn on whole or half units, at most about 12 shapes.
 * - Colour comes only from the kind's Harbor tone and the page tokens, through four class names
 *   painted in `pictures-depth.css`: `pic-paper` (the sheet), `pic-ground` (the tone's pale
 *   ground), `pic-ink` (solid tone) and `pic-line` (tone outline). No colour is written here, so
 *   the same drawing follows the tone it is placed in.
 * - A drawing shows the TYPE of a paper only: shapes that suggest lines of text, never words,
 *   numbers, faces or anything from a person's own document.
 * - No `<image>`, `<use href>` or links to other files: everything is drawn inline.
 */

/** The sheet most papers share: a rounded page with a folded top corner. */
function Sheet() {
  return (
    <>
      <path
        className="pic-paper"
        d="M14 6h28l14 14v48a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z"
      />
      <path className="pic-ground" d="M42 6v10a4 4 0 0 0 4 4h10z" />
    </>
  );
}

/** Short tone lines that read as text on a page, from a top y, `count` lines apart by 7. */
function TextLines({
  y,
  count,
  x = 16,
  width = 32,
}: { y: number; count: number; x?: number; width?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <rect
          key={`l${y + index * 7}`}
          className="pic-ground"
          x={x}
          y={y + index * 7}
          width={index === count - 1 ? width * 0.6 : width}
          height={3}
          rx={1.5}
        />
      ))}
    </>
  );
}

const DRAWINGS: Readonly<Record<DocumentPictureName, () => ReactNode>> = {
  // A closed passport booklet with a globe emblem and the chip mark.
  docPassport: () => (
    <>
      <rect className="pic-ink" x={10} y={6} width={44} height={68} rx={5} />
      <rect className="pic-line pic-on-ink" x={14} y={10} width={36} height={60} rx={3} />
      <circle className="pic-line pic-on-ink" cx={32} cy={34} r={10} />
      <path
        className="pic-line pic-on-ink"
        d="M22 34h20M32 24c-5 6-5 14 0 20M32 24c5 6 5 14 0 20"
      />
      <rect className="pic-paper" x={24} y={52} width={16} height={3} rx={1.5} />
      <rect className="pic-paper" x={27} y={60} width={10} height={6} rx={2} />
    </>
  ),
  // An identity card on its side: a portrait block and text lines.
  docId: () => (
    <>
      <rect className="pic-paper" x={4} y={18} width={56} height={40} rx={6} />
      <rect className="pic-ink" x={4} y={18} width={56} height={9} rx={4} />
      <rect className="pic-ground" x={10} y={32} width={16} height={20} rx={3} />
      <circle className="pic-ink" cx={18} cy={39} r={4} />
      <path className="pic-ink" d="M11 52c1-6 4-8 7-8s6 2 7 8z" />
      <TextLines y={34} count={3} x={30} width={24} />
    </>
  ),
  // A passport-size photo: a framed head and shoulders shape, no face.
  docPhoto: () => (
    <>
      <rect className="pic-paper" x={10} y={8} width={44} height={60} rx={5} />
      <rect className="pic-ground" x={15} y={13} width={34} height={44} rx={3} />
      <circle className="pic-ink" cx={32} cy={30} r={8} />
      <path className="pic-ink" d="M18 57c1-10 7-15 14-15s13 5 14 15z" />
      <rect className="pic-ground" x={22} y={61} width={20} height={3} rx={1.5} />
    </>
  ),
  // A bank statement: a bank front over rows of figures.
  docBank: () => (
    <>
      <Sheet />
      <path className="pic-ink" d="M18 26l10-7 10 7z" />
      <rect className="pic-ink" x={19} y={27} width={18} height={2} />
      <rect className="pic-ink" x={21} y={30} width={2.5} height={7} />
      <rect className="pic-ink" x={26.75} y={30} width={2.5} height={7} />
      <rect className="pic-ink" x={32.5} y={30} width={2.5} height={7} />
      <rect className="pic-ink" x={18} y={37} width={20} height={2} />
      <TextLines y={46} count={4} />
    </>
  ),
  // A salary slip: a coin beside text lines.
  docSalary: () => (
    <>
      <Sheet />
      <circle className="pic-ink" cx={24} cy={28} r={8} />
      <circle className="pic-line pic-on-ink" cx={24} cy={28} r={5} />
      <TextLines y={22} count={2} x={36} width={14} />
      <TextLines y={44} count={4} />
    </>
  ),
  // A tax form: a ruled table with a percent mark.
  docTax: () => (
    <>
      <Sheet />
      <circle className="pic-line" cx={20} cy={23} r={3} />
      <circle className="pic-line" cx={30} cy={33} r={3} />
      <path className="pic-line" d="M32 20L18 36" />
      <rect className="pic-line" x={16} y={44} width={32} height={22} rx={2} />
      <path className="pic-line" d="M16 51h32M16 58h32M30 44v22" />
    </>
  ),
  // A licence: text with an official round stamp.
  docLicence: () => (
    <>
      <Sheet />
      <TextLines y={20} count={4} />
      <circle className="pic-ground" cx={40} cy={56} r={9} />
      <circle className="pic-line" cx={40} cy={56} r={6} />
      <path className="pic-ink" d="M37 56l2 2 4-4" />
    </>
  ),
  // A certificate: a title band, text and a ribbon seal.
  docCertificate: () => (
    <>
      <Sheet />
      <rect className="pic-ink" x={16} y={18} width={22} height={4} rx={2} />
      <TextLines y={28} count={3} />
      <path className="pic-ink" d="M36 60l-3 10 5-3 5 3-3-10z" />
      <circle className="pic-ink" cx={38} cy={56} r={7} />
      <circle className="pic-line pic-on-ink" cx={38} cy={56} r={4} />
    </>
  ),
  // A letter: an open envelope with the page rising out of it.
  docLetter: () => (
    <>
      <rect className="pic-paper" x={16} y={10} width={32} height={40} rx={3} />
      <TextLines y={17} count={3} x={21} width={22} />
      <path className="pic-ground" d="M6 36l26 18 26-18v32a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4z" />
      <path className="pic-line" d="M6 36l26 18 26-18M6 36v32a4 4 0 0 0 4 4h44a4 4 0 0 0 4-4V36" />
    </>
  ),
  // A flight ticket: a boarding pass with a plane and a tear line.
  docFlight: () => (
    <>
      <path
        className="pic-paper"
        d="M10 8h44a4 4 0 0 1 4 4v38a5 5 0 0 0 0 10v8a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4v-8a5 5 0 0 0 0-10V12a4 4 0 0 1 4-4z"
      />
      <path
        className="pic-ink"
        d="M32 14l3 9 10 5v3l-10-2-1 8 3 2v2l-5-1-5 1v-2l3-2-1-8-10 2v-3l10-5z"
      />
      <path className="pic-line pic-dash" d="M10 55h44" />
      <TextLines y={61} count={1} x={14} width={36} />
    </>
  ),
  // A hotel booking: a building with lit windows on a page.
  docHotel: () => (
    <>
      <Sheet />
      <rect className="pic-ink" x={18} y={22} width={22} height={34} rx={2} />
      <rect className="pic-paper" x={22} y={27} width={5} height={5} rx={1} />
      <rect className="pic-paper" x={31} y={27} width={5} height={5} rx={1} />
      <rect className="pic-paper" x={22} y={36} width={5} height={5} rx={1} />
      <rect className="pic-paper" x={31} y={36} width={5} height={5} rx={1} />
      <rect className="pic-paper" x={26} y={47} width={6} height={9} rx={1} />
      <rect className="pic-ground" x={14} y={62} width={34} height={3} rx={1.5} />
    </>
  ),
  // Travel insurance: a shield with a tick over a page.
  docInsurance: () => (
    <>
      <Sheet />
      <path className="pic-ink" d="M32 20l13 5v11c0 9-6 15-13 18-7-3-13-9-13-18V25z" />
      <path className="pic-line pic-on-ink" d="M26 37l4 4 8-8" />
      <TextLines y={60} count={1} />
    </>
  ),
  // The generic paper: a page with text lines.
  file: () => (
    <>
      <Sheet />
      <TextLines y={24} count={6} />
    </>
  ),
};

/** True when the picture layer has a drawing for this name. */
export function hasDocumentDrawing(name: string): name is DocumentPictureName {
  return Object.hasOwn(DRAWINGS, name);
}

/** The shapes of one document illustration, for the 64 x 80 canvas. */
export function documentDrawing(name: DocumentPictureName): ReactNode {
  const draw = DRAWINGS[name];
  return draw ? draw() : null;
}

/** The canvas every document illustration is drawn on. */
export const DOCUMENT_CANVAS = { width: 64, height: 80 } as const;
