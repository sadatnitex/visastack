import { eq, sql } from 'drizzle-orm';
import { type Db, schema } from './db';

/**
 * TRU-03 (master directive Part 7 §4): case material revision.
 *
 * Bumping the counter is atomic (a database-side `+ 1`, never a
 * read-modify-write from a value already held in memory) and always runs
 * inside the caller's own transaction, alongside the material mutation that
 * triggered it -- never as a separate, later write that could commit
 * independently. The exact value is never meaningful on its own, only
 * whether it still matches what a snapshot (or, once built, an
 * acknowledgement, TRU-02) captured.
 *
 * Lives in its own module, depending only on `db`/`schema`, specifically so
 * `missions.ts`, `profile.ts` (`editFact`), and `documents.ts`
 * (`addDocumentVersion`) can all call it without any of the three importing
 * from one another. `missions.ts` already imports from `documents.ts`, so
 * either of those importing this same concern back from `missions.ts` would
 * be a circular import.
 */
export async function incrementMaterialRevision(tx: Db, missionId: string): Promise<void> {
  await tx
    .update(schema.missions)
    .set({ materialRevision: sql`${schema.missions.materialRevision} + 1` })
    .where(eq(schema.missions.id, missionId));
}

/**
 * Every mission that currently has this fact selected as evidence for some
 * requirement. A selection (`selectedEvidence.factId`) points at a fact's
 * stable id, not a frozen version -- readiness/snapshots always read
 * whichever value is CURRENT at read time -- so editing an already-selected
 * fact silently changes what a case discloses without ever touching
 * `selectedEvidence` itself. The directive's own material list names this
 * exactly: "selected fact value/version." A fact selected by zero missions
 * (the common case -- most fact edits happen before any mission ever
 * selects them) returns an empty list, a no-op for the caller.
 */
export async function missionsSelectingFact(tx: Db, factId: string): Promise<readonly string[]> {
  const rows = await tx
    .selectDistinct({ missionId: schema.selectedEvidence.missionId })
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.factId, factId));
  return rows.map((r) => r.missionId);
}

/**
 * Every mission that currently has this document selected as evidence for
 * some requirement -- the document-shaped sibling of `missionsSelectingFact`
 * ("selected document version" is material the same way "selected fact
 * value/version" is: a new version of an already-selected document changes
 * disclosed content without touching the selection itself).
 */
export async function missionsSelectingDocument(
  tx: Db,
  documentId: string,
): Promise<readonly string[]> {
  const rows = await tx
    .selectDistinct({ missionId: schema.selectedEvidence.missionId })
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.documentId, documentId));
  return rows.map((r) => r.missionId);
}
