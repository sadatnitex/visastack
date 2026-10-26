/**
 * AI Gateway OCR/scanned-evidence contract (Part 8 §9: "For image/scanned
 * PDF: use approved OCR component OR configured evaluated vision model").
 *
 * Deliberately reuses the SAME admin-configured provider relationship Part 8
 * §5 already built (`AiExtractionPort`/`resolveAiExtractor`'s own ACTIVE
 * `ai_provider_configs` row) rather than introducing a second, independently
 * configured OCR pipeline -- directive §1's own "no second AI architecture"
 * concern applies here too, not just to field-proposal extraction. This is a
 * real, deliberate reversal of `AiExtractionPort`'s own "never send raw file
 * bytes, text only" privacy-minimization discipline: OCR has no text to send
 * in the first place, so image bytes must leave the server by design. That
 * tradeoff is the whole reason this lives in its own file and its own
 * explicit port, rather than being folded into `AiExtractionPort` as an
 * optional image field -- a caller must opt into this specific, different
 * data-sharing posture, never get it implicitly.
 *
 * Concrete provider adapters live in `@visastack/adapters` (the composition
 * root, same layering as `AiExtractionPort`'s own adapters). Alongside the
 * contract, this file also holds `renderOcrSourceImage`, the one piece of
 * real logic every OCR caller needs regardless of provider: turning a
 * document version into the actual image bytes this port's `AiOcrInput`
 * requires.
 */

import { eq } from 'drizzle-orm';
import { type Db, first, schema } from './db';
import type { PreviewRendererPort } from './preview-rendering';
import type { BlobStore } from './storage';

/** Content types this port actually accepts; matches EVI-01's own existing image support (`content-limits.ts`'s `checkImage`), never a new format the rest of the vault doesn't already bound. */
export type AiOcrContentType = 'image/png' | 'image/jpeg';

export interface AiOcrInput {
  readonly documentVersionId: string;
  readonly imageBytes: Uint8Array;
  readonly contentType: AiOcrContentType;
}

/**
 * Part 8 §9's own named review signals ("show: low quality; ambiguous date;
 * unsupported script; missing text as review issues") -- a set, since more
 * than one can genuinely co-occur on the same page (e.g. a low-quality scan
 * that ALSO has an ambiguous date). Never silently dropped: a caller that
 * ignores this array loses exactly the signal §9 requires be shown.
 */
export type OcrReviewIssueCode =
  | 'low_quality'
  | 'ambiguous_date'
  | 'unsupported_script'
  | 'missing_text';

export interface AiOcrUsage {
  readonly costUnits: number;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly providerRequestId?: string;
  readonly latencyMs: number;
}

export interface AiOcrResult {
  readonly text: string;
  readonly reviewIssues: readonly OcrReviewIssueCode[];
  readonly usage: AiOcrUsage;
}

/** Mirrors `AiExtractionErrorCode`'s own explicit-over-generic discipline (Part 8 §4) -- each failure mode is its own code so a caller can tell "the network hung" apart from "the provider rejected the key" apart from "the model declined," never folded into one generic bucket. */
export type AiOcrErrorCode =
  | 'upstream_error'
  | 'invalid_response'
  | 'rate_limited'
  | 'timeout'
  | 'auth_failed'
  | 'refused'
  | 'truncated'
  | 'disabled';

export type AiOcrOutcome =
  | { readonly ok: true; readonly result: AiOcrResult }
  | {
      readonly ok: false;
      readonly code: AiOcrErrorCode;
      readonly message: string;
      readonly provider?: string;
      readonly latencyMs?: number;
    };

export interface AiOcrCacheKeyComponents {
  /** Which provider reads the image; part of the cache key (see `AiCacheKeyComponents.provider` in ai.ts). */
  readonly provider?: string;
  readonly model: string;
  readonly promptVersion: string;
}

export interface AiOcrPort {
  performOcr(input: AiOcrInput): Promise<AiOcrOutcome>;
  cacheKeyComponents(): AiOcrCacheKeyComponents;
}

/**
 * Failure modes for `renderOcrSourceImage`, kept separate from
 * `AiOcrErrorCode` above -- these describe why an image was never even
 * PREPARED to send to a provider (a bytes/storage/rendering problem), not
 * why a provider call itself failed.
 */
export type OcrSourceImageErrorCode =
  | 'document_version_not_found'
  | 'storage_object_missing'
  | 'object_bytes_missing'
  | 'unsupported_format'
  | 'render_failed';

export type OcrSourceImageOutcome =
  | {
      readonly ok: true;
      readonly imageBytes: Uint8Array;
      readonly contentType: AiOcrContentType;
    }
  | { readonly ok: false; readonly code: OcrSourceImageErrorCode; readonly message: string };

/**
 * Prepares the actual bytes `AiOcrPort.performOcr` needs, from a document
 * version alone -- the missing piece between "OCR wants `image/png` or
 * `image/jpeg` bytes" and "a document version might be a scanned PDF, a
 * photographed JPEG, or anything else the vault accepts." Deliberately
 * reuses `PreviewRendererPort` (EVI-02/EVI-06's existing document-preview
 * renderer, `packages/adapters/src/preview-renderer.ts`) rather than
 * inventing new PDF-rasterization logic: it already rasterizes a PDF's
 * page 1 to PNG (via `unpdf`/`@napi-rs/canvas`, the same pdfjs renderer
 * Firefox ships) and already re-encodes a raw PNG/JPEG upload by
 * decode-and-redraw, which strips EXIF/ICC metadata and any
 * polyglot-appended bytes -- exactly the same "active content stripped"
 * guarantee OCR wants for a second reason (never sending a provider more
 * than the visible pixels). A source this renderer cannot handle at all
 * (DOCX, plain text -- nothing image-shaped to OCR) is `unsupported_format`,
 * not a render failure; there was never an image here to begin with.
 *
 * Only page 1 of a multi-page scanned PDF, matching the renderer's own
 * existing "preview thumbnail, not a full-document viewer" scope --
 * multi-page OCR is a separate, larger gap, tracked in
 * `docs/commercial-v1/known-issues.md`, not silently implied by this
 * function's name.
 */
export async function renderOcrSourceImage(
  db: Db,
  blobStore: BlobStore,
  previewRenderer: PreviewRendererPort,
  documentVersionId: string,
): Promise<OcrSourceImageOutcome> {
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, documentVersionId))
      .limit(1),
  );
  if (!version) {
    return {
      ok: false,
      code: 'document_version_not_found',
      message: 'document version not found',
    };
  }

  const storageObject = first(
    await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, version.storageObjectId))
      .limit(1),
  );
  if (!storageObject) {
    return { ok: false, code: 'storage_object_missing', message: 'stored object missing' };
  }

  const stored = await blobStore.getObject(storageObject.objectKey);
  if (!stored) {
    return {
      ok: false,
      code: 'object_bytes_missing',
      message: 'object bytes missing from storage',
    };
  }

  const rendered = await previewRenderer.render({
    bytes: stored.bytes,
    contentType: stored.contentType,
  });
  if (!rendered.rendered) {
    return { ok: false, code: 'unsupported_format', message: rendered.detail };
  }
  // Defensive, not expected to trip in practice: every source
  // `previewRenderer` actually renders (PDF page 1, PNG, JPEG) always comes
  // back as `image/png` today (see its own doc comment) -- this guards
  // against that contract silently changing rather than trusting it blindly.
  if (rendered.contentType !== 'image/png' && rendered.contentType !== 'image/jpeg') {
    return {
      ok: false,
      code: 'render_failed',
      message: `renderer produced an unusable content type for OCR: ${rendered.contentType}`,
    };
  }

  return { ok: true, imageBytes: rendered.bytes, contentType: rendered.contentType };
}
