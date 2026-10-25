/**
 * The composite key `page.tsx` (building the fact/document id -> selection
 * id lookup) and `collaboration-panels.tsx` (reading it, to know which
 * selection a "remove" click deletes) must agree on exactly (finding #33,
 * post-programme defect register): the same fact or document can be a
 * candidate for more than one requirement (e.g. two requirements both
 * accepting the same document type), so keying the lookup by
 * factId/documentId ALONE let one requirement's "remove" action silently
 * delete a DIFFERENT requirement's selection whenever they shared a
 * candidate — the second requirement's row simply overwrote the first's in
 * that dict.
 *
 * A shared function (rather than the same string template duplicated in
 * both files) is what actually guarantees the write and read sides can
 * never drift apart — and, deliberately kept in its own module with no
 * Next.js/service imports (mirroring `./snapshots/[snapshotId]/snapshot-facts.ts`'s
 * identical reasoning), is what makes it unit-testable at all: importing
 * `page.tsx` directly into a plain Vitest run fails to resolve because of the
 * `withSession`/`next/navigation` imports it drags in.
 */
export function composeSelectionCandidateKey(
  packRequirementId: string,
  candidateId: string,
): string {
  return `${packRequirementId}:${candidateId}`;
}
