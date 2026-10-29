/**
 * Safe preview rendering port (Commercial V1 EVI-02/EVI-06, PRD §5: "Use
 * safe rendered previews with active content removed; originals are
 * explicit downloads, never an untrusted inline PDF shortcut").
 *
 * A pure bytes-in/bytes-out transform, deliberately free of DB/domain
 * access: the caller (`/api/blob/[key]`) already owns fetching the
 * already-scanned CLEAN original bytes and authorizing the request. This
 * port only ever sees bytes it has already been handed, and produces an
 * inert derivative that cannot carry active content (embedded JS/launch
 * actions/forms in a PDF, macros/OLE objects in a DOCX, EXIF/polyglot
 * trailing data in an image) regardless of what the original actually
 * contained. Mirrors `MalwareScannerPort`'s shape (`intake.ts`): a plain
 * discriminated result, not `Result<T, ServiceError>`, since this is an
 * infrastructure-layer transform, not a domain operation.
 */

export interface RenderedPreview {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export type PreviewRenderResult =
  | ({ readonly rendered: true } & RenderedPreview)
  | { readonly rendered: false; readonly detail: string };

export interface PreviewRendererPort {
  /** Identifies which renderer produced a result (mirrors `MalwareScannerPort.name`/`.version`). */
  readonly name: string;
  readonly version: string;
  render(input: {
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<PreviewRenderResult>;
}

// --- Safe copies (ADR 0022, S23) ---------------------------------------------

/** One box on a page, in fractions of the page (see `@visastack/core/redaction-boxes`). */
export interface SafeCopyBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The stored, already scanned and CLEAN file a safe copy is made from. */
export interface SafeCopySource {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/**
 * Limits for one call. `timeLimitMs` is how long the call may draw, counted from when its drawing
 * actually starts (a call waiting behind another in the same process has not started yet); the
 * renderer gives up between steps once it runs out. `maxPages` refuses a longer document before
 * anything is drawn.
 */
export interface SafeCopyBudget {
  readonly timeLimitMs: number;
  readonly maxPages: number;
}

/**
 * Why a safe copy (or a page for the editor) could not be made. `unsupported`: not a PDF, PNG or
 * JPEG. `too_large`: more pages than allowed, too many pixels, or an output that would not fit.
 * `out_of_time`: the budget ran out. `unreadable`: anything else, including a protected or
 * damaged PDF. Every one fails closed: nothing is returned.
 */
export type SafeCopyFailureReason = 'unsupported' | 'too_large' | 'out_of_time' | 'unreadable';

export interface SafeCopyFailure {
  readonly ok: false;
  readonly reason: SafeCopyFailureReason;
  readonly detail: string;
}

/** Text the file itself carries (a PDF's own text layer), with where it sits on its page. */
export interface PositionedText {
  readonly text: string;
  readonly box: SafeCopyBox;
}

export interface SafeCopyRendererPort {
  readonly name: string;
  readonly version: string;
  /** Pages in the file: a PDF's page count, 1 for a PNG or JPEG. */
  pageCount(
    source: SafeCopySource,
    budget: SafeCopyBudget,
  ): Promise<{ readonly ok: true; readonly pageCount: number } | SafeCopyFailure>;
  /** One page drawn as a JPEG for the owner's editor, with nothing hidden. */
  renderPage(
    source: SafeCopySource,
    page: number,
    budget: SafeCopyBudget,
  ): Promise<
    | {
        readonly ok: true;
        readonly contentType: 'image/jpeg';
        readonly bytes: Uint8Array;
        readonly width: number;
        readonly height: number;
      }
    | SafeCopyFailure
  >;
  /** A PDF's own text with positions, one list per page; an image has none. Never stored. */
  textPositions(
    source: SafeCopySource,
    budget: SafeCopyBudget,
  ): Promise<
    { readonly ok: true; readonly pages: readonly (readonly PositionedText[])[] } | SafeCopyFailure
  >;
  /**
   * One page of the safe copy: the page drawn as pixels with its boxes painted solid black
   * before encoding, as a JPEG with no metadata (PDF pages) or one PNG with only image chunks (a
   * photo), no larger than `maxBytes`. Stored by the service as a private derived file when the
   * owner prepares the copy; nothing of the original's text, metadata, attachments, forms or
   * scripts survives.
   */
  renderMaskedPage(
    source: SafeCopySource,
    page: number,
    boxes: readonly SafeCopyBox[],
    budget: SafeCopyBudget & { readonly maxBytes: number },
  ): Promise<({ readonly ok: true } & SafeCopyPageImage) | SafeCopyFailure>;
  /**
   * The safe copy from stored page drawings, without drawing anything: an image-only PDF of the
   * JPEG pages (no text, metadata, attachments, annotations, forms or scripts), or the single PNG.
   * Refuses mixed or malformed pages, and an output larger than `maxOutputBytes`.
   */
  assembleSafeCopy(
    pages: readonly SafeCopyPageImage[],
    maxOutputBytes: number,
  ):
    | {
        readonly ok: true;
        readonly contentType: 'application/pdf' | 'image/png';
        readonly bytes: Uint8Array;
      }
    | SafeCopyFailure;
}

/** One page of a safe copy as drawn and stored: its image and the page size it is printed at. */
export interface SafeCopyPageImage {
  readonly contentType: 'image/jpeg' | 'image/png';
  readonly bytes: Uint8Array;
  /** Page size in points (1/72 inch); for a photo, its pixel size. */
  readonly widthPt: number;
  readonly heightPt: number;
}
