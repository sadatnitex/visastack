import type { AiFeatureOffReason } from '@visastack/core/ai-features';

/** What the Add Documents page tells a person about automatic reading, and what they can do. */
export interface ReadingView {
  /** on: both kinds of reading are allowed. partly_on: one is. needs_consent: allowed to run, not allowed by this person. off: not running for anyone, or not for this plan or today. */
  readonly status: 'on' | 'partly_on' | 'needs_consent' | 'off';
  /** True only when a file added now will really be read automatically. */
  readonly reads: boolean;
  readonly headline: string;
  readonly detail: string;
  /** Whether the person's own switch applies (it does only when reading can run at all). */
  readonly canChange: boolean;
  readonly extraction: boolean;
  readonly ocr: boolean;
}

export interface ReadingInput {
  /** `ai_automatic_reading` for this person, exactly as the reading job decides it; null when it could not be read. */
  readonly feature: {
    readonly available: boolean;
    readonly reason: AiFeatureOffReason | null;
  } | null;
  /** Let AI Read Details from My Documents (AI_EXTRACTION). */
  readonly extraction: boolean;
  /** Let AI Read Text from My Scans (AI_OCR). */
  readonly ocr: boolean;
}

const SAVED_ONLY = 'Your files are saved and checked for safety. You add the details yourself.';

/**
 * The truth about automatic reading for one person, from the same two things the reading job
 * checks: the platform feature (switch, plan, today's limit) and the person's own consent. When it
 * cannot be read, the page says it is off, never that it is on.
 */
export function describeReading(input: ReadingInput): ReadingView {
  const { feature, extraction, ocr } = input;
  const base = { extraction, ocr };
  if (!feature || !feature.available) {
    const detail =
      feature?.reason === 'not_in_plan'
        ? `It is not part of your plan. ${SAVED_ONLY}`
        : feature?.reason === 'daily_limit'
          ? `Today's reading limit is used up, so files added now are not read. ${SAVED_ONLY}`
          : `It is off for now. ${SAVED_ONLY}`;
    return {
      ...base,
      status: 'off',
      reads: false,
      headline: 'Automatic Reading Is Off',
      detail,
      canChange: false,
    };
  }
  if (!extraction && !ocr) {
    return {
      ...base,
      status: 'needs_consent',
      reads: false,
      headline: 'Automatic Reading Is Off for You',
      detail: `You have not allowed it. ${SAVED_ONLY}`,
      canChange: true,
    };
  }
  if (extraction && ocr) {
    return {
      ...base,
      status: 'on',
      reads: true,
      headline: 'Automatic Reading Is On',
      detail:
        'Files you add now are read for suggestions. The text of a file, and a picture of a scan, are sent to an AI service. You approve every detail.',
      canChange: true,
    };
  }
  return {
    ...base,
    status: 'partly_on',
    reads: true,
    headline: 'Automatic Reading Is Partly On',
    detail: extraction
      ? 'Files with text are read for suggestions. Scanned pages are not read, because you have not allowed that. You approve every detail.'
      : 'Scanned pages are read for suggestions. The text of a file is not read, because you have not allowed that. You approve every detail.',
    canChange: true,
  };
}
