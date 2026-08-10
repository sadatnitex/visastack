/**
 * The shape `snapshotMission` (packages/services/src/missions.ts) actually
 * writes into the jsonb `content.facts` column. Not schema-enforced — this
 * mirrors the current writer, not a contract the database checks. Every
 * fact instance is captured by its exact id, in an array — never collapsed
 * into a key->value slot, so a repeating field's multiple instances (master
 * directive §7 "PR 10") are never overwritten.
 *
 * Deliberately its own module, with no Next.js/service imports: `page.tsx`
 * pulls in `withSession`/`next/navigation`, which drag in enough of the
 * Next.js/WorkOS stack that importing the page file directly from a plain
 * Vitest run fails to resolve (`@workos-inc/authkit-nextjs`'s own `next/cache`
 * import). Keeping the pure normalization logic here, with zero such
 * imports, is what makes it actually testable in isolation.
 */
export interface SnapshotFactEntry {
  readonly fieldKey: string;
  readonly factId: string;
  readonly factVersionId: string | null;
  readonly repeatingRecordKey: string | null;
  readonly value: string | null;
  readonly status: string;
  readonly evidenceLinkIds: readonly string[];
}

/**
 * Pre-PR-10 (PR #63) snapshots wrote `content.facts` as this shape instead —
 * a plain fieldKey->value map, never an array at all (finding #29,
 * post-programme defect register). Confirmed via `git show` against the
 * writer as it existed before that PR. No migration ever rewrote the
 * historical rows (nor should one — they're immutable captures), so the
 * read path has to recognize both shapes rather than assume the current
 * one unconditionally.
 */
export type LegacyFactsShape = Readonly<Record<string, string | null>>;

/**
 * Normalizes `content.facts` to the current array shape regardless of which
 * era wrote it (finding #29). The legacy object shape recorded only a value
 * per field key — no factId/factVersionId/repeatingRecordKey/status/
 * evidenceLinkIds ever existed for it, so those are honestly reported as
 * "not recorded" here rather than fabricated to look like real provenance.
 * The field key itself is stable and unique within one snapshot, standing in
 * for `factId` as a React list key only — never treated as a real database
 * reference.
 */
export function normalizeSnapshotFacts(
  facts: readonly SnapshotFactEntry[] | LegacyFactsShape,
): readonly SnapshotFactEntry[] {
  if (Array.isArray(facts)) return facts;
  return Object.entries(facts).map(([fieldKey, value]) => ({
    fieldKey,
    factId: fieldKey,
    factVersionId: null,
    repeatingRecordKey: null,
    value,
    status: 'not recorded (pre-PR-10 snapshot)',
    evidenceLinkIds: [],
  }));
}
