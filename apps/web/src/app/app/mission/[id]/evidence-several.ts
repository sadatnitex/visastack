import type { CandidateView } from './collaboration-panels';

/** Whether an item has more than one file or answer on file to choose from. */
export function hasSeveralToChoose(c: CandidateView): boolean {
  return c.factCandidates.length + c.documentCandidates.length > 1;
}
