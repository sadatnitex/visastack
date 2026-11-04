/** The states of a safe copy and their plain names. Pure, so server pages can read the labels. */
export type SafeCopyStateName =
  | 'NOT_PREPARED'
  | 'PREPARING'
  | 'MASKED'
  | 'NOTHING_TO_HIDE'
  | 'UNSUPPORTED'
  | 'TOO_LARGE';

export const SAFE_COPY_STATE_LABELS: Readonly<Record<SafeCopyStateName, string>> = {
  NOT_PREPARED: 'Safe Copy: Not Prepared Yet',
  PREPARING: 'Safe Copy: Preparing',
  MASKED: 'Safe Copy: Ready',
  NOTHING_TO_HIDE: 'Safe Copy: Ready, Nothing Hidden',
  UNSUPPORTED: 'Safe Copy: Not Available',
  TOO_LARGE: 'Safe Copy: Too Large',
};
