import type {
  DocumentReadingState,
  NotReadReason,
  ReadingSource,
  ReadingStage,
} from '@visastack/services';

/**
 * The plain words for how a file is being read (S6, ADR 0019). One place, so the documents page
 * and the review screen cannot drift apart. No tool names, no engineering terms; a name is Title
 * Case, a sentence is a sentence. Imports types only, so it is safe to use in a browser bundle.
 */

export type ReadingTone = 'neutral' | 'success' | 'warning';

export interface ReadingStatusCopy {
  /** The state's name, as in ADR 0019. */
  readonly title: string;
  readonly tone: ReadingTone;
  /** One or two plain sentences: what is happening, or what to do next. */
  readonly body: string;
}

const STAGE_COPY: Readonly<Record<Exclude<ReadingStage, 'done'>, ReadingStatusCopy>> = {
  checking: {
    title: 'Checking the File',
    tone: 'neutral',
    body: 'We are making sure this file is safe to open. This page updates by itself.',
  },
  reading: {
    title: 'Reading the File',
    tone: 'neutral',
    body: 'We are reading this file for details you can use. This page updates by itself.',
  },
  found: {
    title: 'We Found These Details',
    tone: 'success',
    body: 'Check each one below. Nothing is saved to your profile until you accept it.',
  },
  could_not_read: {
    title: 'We Could Not Read This One',
    tone: 'warning',
    body: 'Add the details yourself.',
  },
  needs_attention: {
    title: 'Needs Attention',
    tone: 'warning',
    body: 'This file could not be used as it is.',
  },
};

/** Why nothing was found, in a sentence a person can act on. */
const REASON_COPY: Readonly<Record<NotReadReason, string>> = {
  NOTHING_FOUND: 'We did not find details in this file that we could place in your profile.',
  NO_CONSENT: 'Reading with AI is off, so only the file itself was checked.',
  SWITCHED_OFF: 'Reading with AI is switched off for now.',
  PROTECTED: 'We only read this kind of document with AI when you ask.',
  LIMIT_REACHED: 'We reached a reading limit for this file.',
  COULD_NOT_READ: 'The reading did not work this time.',
  NOTHING_TO_READ: 'There was no text in this file that we could read.',
};

/**
 * What to show for a file's reading state, or null when there is nothing to say (every suggestion
 * has been decided). `problemNextStep` is the page's existing advice for a file that needs
 * attention, kept as it was.
 */
export function readingStatusCopy(
  state: DocumentReadingState,
  options: { readonly problemNextStep?: string; readonly canReadAgain?: boolean } = {},
): ReadingStatusCopy | null {
  if (state.stage === 'done') return null;
  const copy = STAGE_COPY[state.stage];
  if (state.stage === 'needs_attention' && options.problemNextStep) {
    return { ...copy, body: options.problemNextStep };
  }
  if (state.stage === 'could_not_read') {
    const why = REASON_COPY[state.reason ?? 'NOTHING_FOUND'];
    const next = options.canReadAgain
      ? 'Add the details yourself, or try Read Again.'
      : 'Add the details yourself.';
    return { ...copy, body: `${why} ${next}` };
  }
  return copy;
}

/** Where a suggestion came from, as a short name. */
export const READING_SOURCE_LABELS: Readonly<Record<ReadingSource, string>> = {
  machine_readable: 'Read from the Machine-Readable Lines',
  document_text: 'Read from the Document',
  ai_image: 'Read with AI',
};

/** The same, as a sentence that explains it, for the line under a suggestion. */
export const READING_SOURCE_NOTES: Readonly<Record<ReadingSource, string>> = {
  machine_readable:
    "Taken from the two lines of letters and numbers at the bottom of the passport's photo page. No AI was used.",
  document_text:
    "Taken from the document's own text. An AI service picked out the details from that text; the file itself was not sent.",
  ai_image: 'Read from a picture of the file by an AI service.',
};

export interface ReadingOffer {
  readonly question: string;
  readonly detail: string;
  readonly action: string;
}

/**
 * The one invitation to switch AI reading on, or null when it is on (or cannot be used here). It
 * names only what is missing, and it is shown once for the page, never once per document.
 */
export function readingOffer(input: {
  /** Reading details from a document's text is available on this platform. */
  readonly detailsAvailable: boolean;
  /** Reading a scan or photo is available on this platform. */
  readonly scansAvailable: boolean;
  readonly detailsGranted: boolean;
  readonly scansGranted: boolean;
}): ReadingOffer | null {
  const needsDetails = input.detailsAvailable && !input.detailsGranted;
  const needsScans = input.scansAvailable && !input.scansGranted;
  if (!needsDetails && !needsScans) return null;
  if (needsDetails) {
    return {
      question: 'Want VisaStack to read your documents for you?',
      detail:
        'Passports are already read from their machine-readable lines. With AI reading on, other documents are read too, and a scan or photo can be read as a picture. You still accept every detail yourself before it reaches your profile.',
      action: 'Turn On Reading with AI',
    };
  }
  return {
    question: 'Want scans and photos read too?',
    detail:
      'Reading a picture shares the picture with an AI service, which is more than text alone. You still accept every detail yourself before it reaches your profile.',
    action: 'Turn On Reading Scans with AI',
  };
}
