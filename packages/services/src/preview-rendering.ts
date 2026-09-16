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
