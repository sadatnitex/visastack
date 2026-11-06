import type { StarterImportPreviewRow } from '@visastack/services';

/**
 * What the starter lists screen shows after "Check What Would Change". It lives here, not in the
 * server actions file: a file that starts with "use server" may export only async functions, and
 * this is a value the screen also needs as its starting state.
 */
export interface StarterPreviewState {
  readonly ok: boolean;
  readonly message: string;
  readonly rows: readonly StarterImportPreviewRow[];
  /** Lines of the sheet that could not be placed, with the plain reason. */
  readonly skipped: readonly string[];
}

export const NO_PREVIEW: StarterPreviewState = { ok: false, message: '', rows: [], skipped: [] };
