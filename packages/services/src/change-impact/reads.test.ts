import { describe, expect, it } from 'vitest';
import { assessDetailChangeImpact } from './detail';
import { assessDocumentChangeImpact } from './document';
import {
  HEAVY,
  type ImpactWorld,
  PASSPORT_TYPE,
  askForDetail,
  askForDocument,
  buildImpactWorld,
  changeEmploymentDetail,
  decide,
  historyFingerprint,
  makeAgency,
  makeCase,
  must,
  ownerManage,
  replaceWithNewerPassport,
  sendDetail,
  sendDocument,
  shareWith,
  writeCounts,
} from './scenario.test-support';

/*
 * A read is only a read, the same records give the same answer, and its cost does not grow with
 * how much the traveller has: the measured statement counts below are the budget.
 */

/** Statements one read of the full scenario sends on a handle that has read before (measured). */
const DOCUMENT_STATEMENT_BUDGET = 12;
const DETAIL_STATEMENT_BUDGET = 15;
/** Generous for a slow machine; the measured time is about 20 ms per read on the in-memory database. */
const READ_TIME_LIMIT_MS = 5_000;

const NOW = new Date('2026-11-13T12:00:00Z');

async function bothChanges(): Promise<ImpactWorld> {
  const w = await buildImpactWorld();
  await replaceWithNewerPassport(w);
  await changeEmploymentDetail(w);
  return w;
}

async function measured(w: ImpactWorld) {
  const proof = await ownerManage(w.db, w.rahim);
  const options = { now: NOW };
  // Warm the handle: the presence checks that remember "present" run once per handle.
  await assessDocumentChangeImpact(proof, { documentId: w.p1.documentId }, options);
  await assessDetailChangeImpact(proof, { factId: w.e.factId }, options);
  w.log.length = 0;
  let started = Date.now();
  const document = must(
    await assessDocumentChangeImpact(proof, { documentId: w.p1.documentId }, options),
    'document',
  );
  const documentMs = Date.now() - started;
  const documentStatements = [...w.log];
  w.log.length = 0;
  started = Date.now();
  const detail = must(
    await assessDetailChangeImpact(proof, { factId: w.e.factId }, options),
    'detail',
  );
  const detailMs = Date.now() - started;
  const detailStatements = [...w.log];
  return { document, detail, documentStatements, detailStatements, documentMs, detailMs };
}

describe('repeated reads', () => {
  it(
    'are deep-equal and write nothing',
    async () => {
      const w = await bothChanges();
      const countsBefore = await writeCounts(w.db);
      const historyBefore = await historyFingerprint(w.db);

      const first = await measured(w);
      const second = await measured(w);
      expect(second.document).toEqual(first.document);
      expect(second.detail).toEqual(first.detail);
      expect(first.document.assessedAt).toEqual(NOW);

      expect(await writeCounts(w.db)).toEqual(countsBefore);
      expect(await historyFingerprint(w.db)).toBe(historyBefore);
      // Every statement a read sends is a select.
      for (const statement of [...first.documentStatements, ...first.detailStatements]) {
        expect(statement.trimStart().toLowerCase().startsWith('select')).toBe(true);
        expect(statement).not.toMatch(/\b(insert|update|delete)\b/i);
      }
      // The result is plain data: it survives a round trip through JSON apart from its dates.
      const roundTrip = JSON.parse(JSON.stringify(first.detail)) as { items: unknown[] };
      expect(roundTrip.items).toHaveLength(first.detail.items.length);
    },
    HEAVY,
  );
});

describe('the cost of one read', () => {
  it(
    'stays inside the measured statement budget for the full scenario',
    async () => {
      const w = await bothChanges();
      const run = await measured(w);
      expect(run.documentStatements.length).toBeLessThanOrEqual(DOCUMENT_STATEMENT_BUDGET);
      expect(run.detailStatements.length).toBeLessThanOrEqual(DETAIL_STATEMENT_BUDGET);
      expect(run.documentMs).toBeLessThan(READ_TIME_LIMIT_MS);
      expect(run.detailMs).toBeLessThan(READ_TIME_LIMIT_MS);
      // Every statement is filtered by this traveller or by the changed item: each one binds
      // at least one parameter (the presence checks alone name tables, not records).
      for (const statement of [...run.documentStatements, ...run.detailStatements]) {
        if (statement.includes('to_regclass')) continue;
        expect(statement).toMatch(/\$1/);
      }
    },
    HEAVY,
  );

  it(
    'does not grow with the number of cases, requests and shares',
    async () => {
      const w = await buildImpactWorld();
      // Several times the base scenario: more cases, more requests in every state, more shares.
      for (let n = 0; n < 3; n += 1) {
        await makeCase(w.db, w.rahim, w.checklist, {
          title: `Sample Extra Case ${n}`,
          documentId: w.p1.documentId,
          factId: w.e.factId,
        });
        const agency = await makeAgency(
          w.db,
          `owner@sample-extra-agency-${n}.example.test`,
          `Sample Extra Agency ${n}`,
        );
        await shareWith(w.db, w.rahim, agency);
        const forDocument = await askForDocument(w.db, agency, w.rahim, undefined, PASSPORT_TYPE);
        await sendDocument(w.db, w.rahim, forDocument, w.p1.documentId);
        const forDetail = await askForDetail(w.db, agency, w.rahim);
        await sendDetail(w.db, w.rahim, forDetail, w.e.factId);
        if (n > 0) {
          await decide(w.db, agency, forDocument, n === 1 ? 'ACCEPTED' : 'NEEDS_REPLACEMENT');
          await decide(w.db, agency, forDetail, n === 1 ? 'ACCEPTED' : 'CONTRADICTION');
        }
      }
      await replaceWithNewerPassport(w);
      await changeEmploymentDetail(w);

      const run = await measured(w);
      expect(run.document.items.length).toBeGreaterThanOrEqual(14);
      expect(run.detail.items.length).toBeGreaterThanOrEqual(12);
      expect(run.documentStatements.length).toBeLessThanOrEqual(DOCUMENT_STATEMENT_BUDGET);
      expect(run.detailStatements.length).toBeLessThanOrEqual(DETAIL_STATEMENT_BUDGET);
    },
    HEAVY,
  );
});
