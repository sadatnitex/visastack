import 'server-only';
import {
  BuiltinContentLimitsChecker,
  BuiltinPreviewRenderer,
  DeterministicTextExtractor,
  SharpImageSanitizer,
} from '@visastack/adapters';
import {
  type BlobStore,
  type ContentLimitsPort,
  type DocumentConverterPort,
  type ImageSanitizerPort,
  type PreviewRendererPort,
  loadUploadQuotaConfig,
} from '@visastack/services';
import { checkKnownProvider } from './provider-env';

/**
 * The factories for the heavy document and image libraries (picture re-encoding, document text
 * reading, safe previews, page and size limits). They live apart from `./providers` on purpose:
 * the deployed server includes a library's files for every page that imports the code that uses
 * it, so a page that never reads a document must not import this file. Import from here only in
 * code that really reads or re-encodes documents or images.
 */

/**
 * Server-side re-encoding for agency logos and photo proofs of payment (S27): a brand-new JPEG or
 * PNG written from the decoded pixels, so nothing from the upload but image data is stored.
 */
export function createImageSanitizer(): ImageSanitizerPort {
  return new SharpImageSanitizer();
}

/** The deterministic, bounded document-to-text converter - the only `DocumentConverterPort` implementation today. */
export function createDocumentConverter(blobStore: BlobStore): DocumentConverterPort {
  checkKnownProvider('DOCUMENT_CONVERTER_PROVIDER');
  return new DeterministicTextExtractor({ blobStore });
}

/**
 * The safe preview renderer (EVI-02/EVI-06), the only `PreviewRendererPort`
 * implementation today, matching `createDocumentConverter`'s "builtin,
 * always active" shape: no external account, no configuration branch.
 * Shares `maxPdfPages` with `createContentLimitsChecker` below (same
 * `loadUploadQuotaConfig()` source) so a render at serve time re-checks the
 * same page-count limit intake already enforced, using the same number an
 * operator override would change for both, never a second independently
 * drifting constant.
 */
export function createPreviewRenderer(): PreviewRendererPort {
  checkKnownProvider('PREVIEW_RENDERER_PROVIDER');
  const { maxPdfPages } = loadUploadQuotaConfig();
  return new BuiltinPreviewRenderer({ maxPdfPages });
}

/**
 * The content-limits checker (EVI-01's "50 PDF pages, 40 megapixels per
 * image"), the only `ContentLimitsPort` implementation today, same
 * "builtin, always active" shape as `createPreviewRenderer`. Reads its
 * limits from the same `loadUploadQuotaConfig()` the upload-size checks
 * use, so an operator overriding `QUOTA_MAX_PDF_PAGES`/
 * `QUOTA_MAX_IMAGE_MEGAPIXELS` changes both what `quotas.ts` reports and
 * what this checker enforces from the one place.
 */
export function createContentLimitsChecker(blobStore: BlobStore): ContentLimitsPort {
  checkKnownProvider('CONTENT_LIMITS_PROVIDER');
  const { maxPdfPages, maxImageMegapixels } = loadUploadQuotaConfig();
  return new BuiltinContentLimitsChecker({
    blobStore,
    config: { maxPdfPages, maxImageMegapixels },
  });
}
