import { DETAILS_IN_USE_LINE, DETAIL_IN_USE_LINE } from '../../../../lib/success-lines';

/** Plain wording for the result of accepting clear details at once. */
export function describeClearAcceptance({
  approved,
  leftForReview,
  alreadyDecided,
}: {
  readonly approved: number;
  readonly leftForReview: number;
  readonly alreadyDecided: number;
}): string {
  const parts: string[] = [
    approved === 0
      ? 'Nothing new was saved.'
      : approved === 1
        ? 'Saved 1 detail to your profile.'
        : `Saved ${approved} details to your profile.`,
  ];
  if (alreadyDecided > 0) {
    parts.push(
      alreadyDecided === 1 ? '1 was already decided.' : `${alreadyDecided} were already decided.`,
    );
  }
  if (leftForReview > 0) {
    parts.push(
      leftForReview === 1
        ? '1 needs a closer look before you accept it.'
        : `${leftForReview} need a closer look before you accept them.`,
    );
  }
  // Quiet closure (CCD section 6): when all went in, say what it means next, in the same words as
  // accepting one suggestion.
  if (approved > 0 && alreadyDecided === 0 && leftForReview === 0) {
    parts.push(approved === 1 ? DETAIL_IN_USE_LINE : DETAILS_IN_USE_LINE);
  }
  return parts.join(' ');
}
