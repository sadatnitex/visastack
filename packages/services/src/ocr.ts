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
 * root, same layering as `AiExtractionPort`'s own adapters) -- this file is
 * the contract only.
 */

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
  readonly model: string;
  readonly promptVersion: string;
}

export interface AiOcrPort {
  performOcr(input: AiOcrInput): Promise<AiOcrOutcome>;
  cacheKeyComponents(): AiOcrCacheKeyComponents;
}
