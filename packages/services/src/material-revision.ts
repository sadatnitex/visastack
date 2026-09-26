import { and, eq, isNull, sql } from 'drizzle-orm';
import { type Db, schema } from './db';

/**
 * TRU-03 (master directive Part 7 §4): case material revision.
 *
 * Bumping the counter is atomic (a database-side `+ 1`, never a
 * read-modify-write from a value already held in memory) and always runs
 * inside the caller's own transaction, alongside the material mutation that
 * triggered it -- never as a separate, later write that could commit
 * independently. The exact value is never meaningful on its own, only
 * whether it still matches what a snapshot or acknowledgement (TRU-02)
 * captured.
 *
 * Lives in its own module, depending only on `db`/`schema`, specifically so
 * `missions.ts`, `profile.ts` (`editFact`), `documents.ts`
 * (`addDocumentVersion`), and `erasure.ts` can all call it without any of
 * them importing from one another. `missions.ts` already imports from
 * `documents.ts`, so either of those importing this same concern back from
 * `missions.ts` would be a circular import.
 *
 * §4's own text: "Material changes increment revision in SAME transaction
 * as mutation AND ACKNOWLEDGEMENT INVALIDATION" -- so this function also
 * invalidates any currently-live acknowledgement (TRU-02) for the mission,
 * right here, rather than making every one of the call sites above
 * separately re-derive "does this mutation invalidate the current
 * acknowledgement" (they would all get the same answer: yes, always, since
 * ANY material change does). This references `schema.acknowledgements`
 * directly -- a table shape from `@visastack/db`, not a service export --
 * so it needs no import from `acknowledgements.ts` and creates no new edge
 * at all. Only a still-valid ACKNOWLEDGED row is touched:
 * REJECTED/CORRECTION_REQUESTED rows were never a valid green light to
 * begin with, and an already-invalidated row has nothing left to mark.
 */
export async function incrementMaterialRevision(tx: Db, missionId: string): Promise<void> {
  await tx
    .update(schema.missions)
    .set({ materialRevision: sql`${schema.missions.materialRevision} + 1` })
    .where(eq(schema.missions.id, missionId));
  await tx
    .update(schema.acknowledgements)
    .set({ invalidatedAt: sql`now()` })
    .where(
      and(
        eq(schema.acknowledgements.missionId, missionId),
        eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
        isNull(schema.acknowledgements.invalidatedAt),
      ),
    );
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

/**
 * The mission's current live acknowledgement, if any: the most recent
 * ACKNOWLEDGED row not yet invalidated by a later material change (the
 * `invalidatedAt` this same module's `incrementMaterialRevision` sets).
 * Never REJECTED/CORRECTION_REQUESTED (those were never a valid green
 * light). Lives here, not in `acknowledgements.ts`, specifically so
 * `missions.ts` can call it too (CAS-07's own SUBMISSION_READY gate,
 * master directive Part 7 §6) without a circular import:
 * `acknowledgements.ts` already imports `getMissionForOwner` from
 * `missions.ts`, so the reverse import would be a cycle.
 * `acknowledgements.ts` re-exports this as its own API. Not owner-gated
 * itself, since every caller so far already holds an owner-checked mission.
 */
export async function getLiveAcknowledgement(
  db: Db,
  missionId: string,
): Promise<typeof schema.acknowledgements.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(schema.acknowledgements)
    .where(
      and(
        eq(schema.acknowledgements.missionId, missionId),
        eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
      ),
    );
  const valid = rows.filter((row) => row.invalidatedAt === null);
  return valid.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}
