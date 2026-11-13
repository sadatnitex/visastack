import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { assessDetailChangeImpact } from './detail';
import { assessDocumentChangeImpact } from './document';
import {
  HEAVY,
  type ImpactWorld,
  askForDetail,
  askForDocument,
  buildImpactWorld,
  changeEmploymentDetail,
  itemOf,
  ownerManage,
  readDetailImpact,
  readDocumentImpact,
  reasons,
  replaceWithNewerPassport,
  sendDetail,
  sendDocument,
} from './scenario.test-support';

/*
 * Records that cannot settle the answer: sends made before exact versions were kept, missing
 * dates, history that contradicts itself and tables that are not there yet. Each case must come
 * back as UNKNOWN (or, where the records do prove it, as the proven answer), never as a guess.
 *
 * Where no service can produce the state any more (a send from before exact versions were kept, a
 * contradiction), the rows are put into that state by hand, and each place says so.
 */

/**
 * A new handle on the same database. The presence checks remember "present" per handle, so a
 * table dropped in a test is only seen as missing through a handle that never saw it.
 */
function freshHandle(world: ImpactWorld): ImpactWorld {
  const db = drizzle(world.client, {
    schema,
    logger: { logQuery: (statement: string) => world.log.push(statement) },
  }) as unknown as Db;
  return { ...world, db };
}

/** By hand: forget the exact value a detail send pinned, as a send from before 0135 looks. */
async function forgetDetailPins(db: Db, requestId: string): Promise<void> {
  await db.execute(
    sql`delete from evidence_request_decision_fact_submissions where submission_id in (select id from evidence_request_fact_submissions where evidence_request_id = ${requestId})`,
  );
  await db.execute(
    sql`delete from evidence_request_fact_submissions where evidence_request_id = ${requestId}`,
  );
}

describe('a detail sent before exact values were kept', () => {
  it(
    'is unknown once the detail has changed, and never guessed in either direction',
    async () => {
      const w = await buildImpactWorld();
      await forgetDetailPins(w.db, w.detailRequestId);

      // One saved value ever: whatever was sent can only have been that value.
      expect(itemOf(await readDetailImpact(w), `request:${w.detailRequestId}`).reason).toBe(
        'AGENCY_HOLDS_CURRENT',
      );

      await changeEmploymentDetail(w);
      const impact = await readDetailImpact(w);
      expect(itemOf(impact, `request:${w.detailRequestId}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'SENT_BEFORE_EXACT_VERSIONS',
        nextStep: { kind: 'OPEN_REQUEST', requestId: w.detailRequestId },
      });
      const about = itemOf(impact, `request:${w.detailRequestId}`).about;
      // The send's own date was never recorded with the decision: it is null, not invented.
      expect(about).toMatchObject({ kind: 'AGENCY_REQUEST', sentAt: null });
      expect(impact.quiet).toBe(false);
      expect(impact.complete).toBe(true);
    },
    HEAVY,
  );

  it(
    'reads a waiting send by its date: provably after the current value, else unknown',
    async () => {
      const w = await buildImpactWorld();
      const saved = await changeEmploymentDetail(w);
      const waiting = await askForDetail(w.db, w.agencyA, w.rahim);
      await sendDetail(w.db, w.rahim, waiting, w.e.factId);
      await forgetDetailPins(w.db, waiting);

      // Sent after the current value was saved, and that value is the newest: it is the current one.
      expect(itemOf(await readDetailImpact(w), `request:${waiting}`).reason).toBe(
        'AGENCY_HOLDS_CURRENT',
      );

      // By hand: the send's date is missing. Nothing proves which value went.
      await w.db
        .update(schema.evidenceRequests)
        .set({ respondedAt: null })
        .where(eq(schema.evidenceRequests.id, waiting));
      expect(itemOf(await readDetailImpact(w), `request:${waiting}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'SENT_BEFORE_EXACT_VERSIONS',
      });

      // By hand: the send is dated before the current value was saved. Still not provable.
      await w.db
        .update(schema.evidenceRequests)
        .set({ respondedAt: new Date(saved.version.createdAt.getTime() - 1000) })
        .where(eq(schema.evidenceRequests.id, waiting));
      expect(itemOf(await readDetailImpact(w), `request:${waiting}`).reason).toBe(
        'SENT_BEFORE_EXACT_VERSIONS',
      );
    },
    HEAVY,
  );

  it(
    'is the same answer while the tables for exact values are not there yet',
    async () => {
      const built = await buildImpactWorld();
      // The database as it is before migration 0135.
      await built.client.exec(
        'drop table evidence_request_decision_fact_submissions, evidence_request_fact_submissions cascade',
      );
      const w = freshHandle(built);
      const later = await askForDetail(w.db, w.agencyA, w.rahim);
      await changeEmploymentDetail(w);
      // A real send through the service, which keeps only the older pointer for now.
      await sendDetail(w.db, w.rahim, later, w.e.factId);

      const impact = await readDetailImpact(w);
      // The accepted answer from before: which value it was is not recorded.
      expect(itemOf(impact, `request:${w.detailRequestId}`).reason).toBe(
        'SENT_BEFORE_EXACT_VERSIONS',
      );
      // Sent after the current value was saved: provably the current one.
      expect(itemOf(impact, `request:${later}`).reason).toBe('AGENCY_HOLDS_CURRENT');
      expect(impact.complete).toBe(true);
    },
    HEAVY,
  );
});

describe('a document sent before exact copies were kept', () => {
  it(
    'is unknown for the document that was the answer',
    async () => {
      const built = await buildImpactWorld();
      // The database as it is before migration 0132.
      await built.client.exec(
        'drop table evidence_request_decision_submissions, evidence_request_submissions cascade',
      );
      const w = freshHandle(built);
      const waiting = await askForDocument(w.db, w.agencyA, w.rahim);
      await sendDocument(w.db, w.rahim, waiting, w.p1.documentId);
      await replaceWithNewerPassport(w);

      const impact = await readDocumentImpact(w);
      for (const requestId of [w.documentRequestId, waiting]) {
        expect(itemOf(impact, `request:${requestId}`)).toMatchObject({
          outcome: 'UNKNOWN',
          reason: 'SENT_BEFORE_EXACT_VERSIONS',
          nextStep: { kind: 'OPEN_REQUEST', requestId },
        });
      }
      expect(itemOf(impact, `case:${w.liveCaseId}`).reason).toBe(
        'LIVE_CASE_USES_REPLACED_DOCUMENT',
      );
      expect(impact.complete).toBe(true);
    },
    HEAVY,
  );
});

describe('stored history that contradicts itself', () => {
  it(
    'is reported as an incomplete record, for a document and for a detail',
    async () => {
      const w = await buildImpactWorld();
      await replaceWithNewerPassport(w);
      await changeEmploymentDetail(w);
      // By hand: the requests say "sent back" while their latest decision says accepted.
      await w.db.update(schema.evidenceRequests).set({ status: 'NEEDS_REPLACEMENT' });

      const document = await readDocumentImpact(w);
      expect(itemOf(document, `request:${w.documentRequestId}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'RECORD_INCOMPLETE',
        nextStep: { kind: 'OPEN_REQUEST', requestId: w.documentRequestId },
      });
      const detail = await readDetailImpact(w);
      expect(itemOf(detail, `request:${w.detailRequestId}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'RECORD_INCOMPLETE',
      });
    },
    HEAVY,
  );

  it(
    'covers a pinned copy that is no longer the stored file that was sent',
    async () => {
      const w = await buildImpactWorld();
      await replaceWithNewerPassport(w);
      expect(itemOf(await readDocumentImpact(w), `request:${w.documentRequestId}`).reason).toBe(
        'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
      );
      // By hand: the stored version's checksum no longer matches what the send recorded.
      await w.db
        .update(schema.documentVersions)
        .set({ sha256: 'b'.repeat(64) })
        .where(eq(schema.documentVersions.id, w.p1.versionId));
      expect(itemOf(await readDocumentImpact(w), `request:${w.documentRequestId}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'RECORD_INCOMPLETE',
      });
    },
    HEAVY,
  );

  it(
    'covers a live case whose void confirmation did not record exact values',
    async () => {
      const w = await buildImpactWorld();
      await changeEmploymentDetail(w);
      // By hand: the confirmed copy as an older copy looks, with no list of exact values.
      await w.db.execute(
        sql`update mission_snapshots set content = content - 'facts' where id = ${w.liveCaseSnapshotId}`,
      );
      expect(itemOf(await readDetailImpact(w), `case:${w.liveCaseId}`)).toMatchObject({
        outcome: 'UNKNOWN',
        reason: 'RECORD_INCOMPLETE',
        nextStep: { kind: 'OPEN_CASE', missionId: w.liveCaseId },
      });
    },
    HEAVY,
  );
});

describe('a table that is not there yet', () => {
  it(
    'makes that part "could not check" while the rest of the read still answers',
    async () => {
      const built = await buildImpactWorld();
      await replaceWithNewerPassport(built);
      await changeEmploymentDetail(built);
      const full = await readDocumentImpact(built);

      await built.client.exec(
        'drop table agency_collection_reviews, agency_collection_response_items, agency_collection_response_withdrawals, agency_collection_responses cascade',
      );
      const w = freshHandle(built);
      const document = await readDocumentImpact(w);
      expect(document.complete).toBe(false);
      expect(itemOf(document, 'area:AGENCY_REQUESTS')).toEqual({
        id: 'area:AGENCY_REQUESTS',
        outcome: 'UNKNOWN',
        reason: 'COULD_NOT_CHECK',
        area: 'AGENCY_REQUESTS',
        about: { kind: 'AREA', area: 'AGENCY_REQUESTS' },
        nextStep: null,
      });
      // Everything that could be read is still there, unchanged.
      expect(document.items.filter((item) => item.reason !== 'COULD_NOT_CHECK')).toEqual(
        full.items,
      );
      expect(document.quiet).toBe(false);
      const detail = await readDetailImpact(w);
      expect(detail.complete).toBe(false);
      expect(reasons(detail)).toContainEqual(['area:AGENCY_REQUESTS', 'COULD_NOT_CHECK']);
      expect(itemOf(detail, `case:${w.liveCaseId}`).reason).toBe('LIVE_CASE_CONFIRMATION_VOID');

      // Copy choices missing as well: the case part says so, and selections still answer.
      await built.client.exec(
        'drop table umpe_package_choices, umpe_package_handoffs, umpe_package_changes cascade',
      );
      const both = await readDocumentImpact(freshHandle(built));
      expect(reasons(both)).toContainEqual(['area:CASES', 'COULD_NOT_CHECK']);
      expect(reasons(both)).toContainEqual(['area:AGENCY_REQUESTS', 'COULD_NOT_CHECK']);
      expect(itemOf(both, `case:${w.liveCaseId}`).reason).toBe('LIVE_CASE_USES_REPLACED_DOCUMENT');
      // A control document is no longer quiet: a part of its record could not be read.
      const control = await readDocumentImpact(freshHandle(built), w.controlDocument.documentId);
      expect(control.quiet).toBe(false);
      expect(control.complete).toBe(false);
    },
    HEAVY,
  );

  it(
    'answers in full while the Recently Deleted records are not there yet',
    async () => {
      const built = await buildImpactWorld();
      // The database as it is before migration 0113: nothing can have been deleted or archived.
      await built.client.exec(
        'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
      );
      const w = freshHandle(built);
      const preview = await readDocumentImpact(w);
      await replaceWithNewerPassport(w);
      const recorded = await readDocumentImpact(w);
      expect(recorded.phase).toBe('RECORDED');
      expect(recorded.complete).toBe(true);
      expect(reasons(recorded)).toEqual(reasons(preview));
      expect(reasons(recorded)).toHaveLength(5);
    },
    HEAVY,
  );

  it(
    'returns a service error, not a partial answer, when the database itself fails',
    async () => {
      const built = await buildImpactWorld();
      const proof = await ownerManage(built.db, built.rahim);
      // A table every read needs is gone: a real failure, not a pending migration.
      await built.client.exec('drop table selected_evidence cascade');
      const document = await assessDocumentChangeImpact(proof, { documentId: built.p1.documentId });
      const detail = await assessDetailChangeImpact(proof, { factId: built.e.factId });
      for (const result of [document, detail]) {
        expect(result).toEqual({
          ok: false,
          error: { code: 'upstream_error', message: 'the record could not be read' },
        });
      }
    },
    HEAVY,
  );
});
