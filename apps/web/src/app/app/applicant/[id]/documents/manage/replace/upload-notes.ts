import {
  UPLOAD_BUSY_LINE,
  type UploadOutcome,
} from '../../../../../../../lib/document-upload-client';

/*
 * What the Replace panel says about the file being added as the newer document. One place, so
 * every ending of an upload has its own plain line and none of them blames the connection for
 * something it was not (a file that is too big, a refusal the server explained).
 */

/** The request never got a usable answer: the file may or may not have arrived. */
export const REPLACE_UPLOAD_UNKNOWN =
  'We could not confirm whether the file was added. Check the list above before trying again. If it is not there, add it again.';

/** The panel's own code failed before an answer: the same honest wording, never "check your connection". */
export const REPLACE_UPLOAD_FAILED =
  'We could not confirm whether the file was added. Check the list above before trying again.';

/** The file was stored; it still has to be checked before it can be chosen. */
export const REPLACE_UPLOAD_ADDED = 'Added. We are checking it now; you can choose it in a moment.';

export const REPLACE_UPLOAD_SHRINKING = 'Making this photo smaller to fit.';

/** The share sent so far, in steps of ten so a screen reader is not read every single number. */
export function replaceUploadProgressLine(fraction: number): string {
  const percent = Math.min(99, Math.floor((Math.max(0, fraction) * 100) / 10) * 10);
  return `Uploading, ${percent}% sent. Please keep this page open.`;
}

/** The line for how an upload ended, and whether the file was added. */
export function replaceUploadEnding(outcome: UploadOutcome): { added: boolean; line: string } {
  switch (outcome.kind) {
    case 'added':
      return { added: true, line: REPLACE_UPLOAD_ADDED };
    case 'refused':
      return { added: false, line: outcome.message };
    case 'busy':
      return { added: false, line: outcome.message ?? UPLOAD_BUSY_LINE };
    case 'unknown':
      return { added: false, line: REPLACE_UPLOAD_UNKNOWN };
  }
}
