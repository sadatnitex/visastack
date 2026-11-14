import type { Result } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import type { AuthorizedApplicant } from '../access';
import type { ServiceError } from '../errors';
import type { ChangeImpact } from './contract';
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
  freshHandle,
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

/**
 * Statements one read of the full scenario sends on a cold handle (measured). Production makes a
 * handle per request, so every read pays for the presence check: the budget includes it.
 */
const DOCUMENT_STATEMENT_BUDGET = 13;
const DETAIL_STATEMENT_BUDGET = 16;
/**
 * No read of the scenario can be done in fewer statements than this: a count below it means the
 * statements were not recorded, and the budget would then prove nothing.
 */
const STATEMENT_FLOOR = 8;

const NOW = new Date('2026-11-13T12:00:00Z');

async function bothChanges(): Promise<ImpactWorld> {
  const w = await buildImpactWorld();
  await replaceWithNewerPassport(w);
  await changeEmploymentDetail(w);
  return w;
}

type Read = (proof: AuthorizedApplicant<'MANAGE'>) => Promise<Result<ChangeImpact, ServiceError>>;

/** One read on a new handle (cold, as each request is in production): its answer, statements and time. */
async function coldRead(w: ImpactWorld, read: Read) {
  const handle = freshHandle(w);
  const proof = await ownerManage(handle.db, handle.rahim);
  w.log.length = 0;
  const started = Date.now();
  const impact = must(await read(proof), 'read');
  return { impact, statements: [...w.log], ms: Date.now() - started };
}

const documentRead =
  (documentId: string): Read =>
  (proof) =>
    assessDocumentChangeImpact(proof, { documentId }, { now: NOW });
const detailRead =
  (factId: string): Read =>
  (proof) =>
    assessDetailChangeImpact(proof, { factId }, { now: NOW });

async function measured(w: ImpactWorld) {
  const document = await coldRead(w, documentRead(w.p1.documentId));
  const detail = await coldRead(w, detailRead(w.e.factId));
  return {
    document: document.impact,
    detail: detail.impact,
    documentStatements: document.statements,
    detailStatements: detail.statements,
    documentMs: document.ms,
    detailMs: detail.ms,
  };
}

/** How many of these statements are the presence check. */
const presenceChecks = (statements: readonly string[]) =>
  statements.filter((statement) => statement.includes('to_regclass')).length;

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

describe('a look that is slow, abandoned or finished late', () => {
  it(
    'takes only share locks, which never block another look and end with the look',
    async () => {
      const w = await bothChanges();
      const run = await measured(w);
      const statements = [...run.documentStatements, ...run.detailStatements];
      // The snapshot of the record being looked at is held with a share lock for the length of
      // the look (so a replacement is seen wholly recorded or not at all). That lock makes a
      // later save of the same record wait until the look ends, which is why a look past its
      // budget is handed on to finish instead of being left hanging. It is never a write lock.
      expect(
        statements.filter((statement) => /\bfor\s+share\b/i.test(statement)).length,
      ).toBeGreaterThan(0);
      for (const statement of statements) {
        expect(statement).not.toMatch(/\bfor\s+(update|no\s+key\s+update)\b/i);
        expect(statement).not.toMatch(/\block\s+table\b/i);
      }
    },
    HEAVY,
  );

  it(
    'leaves a saved replacement and a saved detail exactly as they were, even when its answer is never used',
    async () => {
      const w = await bothChanges();
      const countsBefore = await writeCounts(w.db);
      const historyBefore = await historyFingerprint(w.db);

      // The screen gave up on this look (it ran past its budget); it is started and left to end
      // on its own, as the platform does with a late look, and its ending is swallowed.
      const handle = freshHandle(w);
      const proof = await ownerManage(handle.db, handle.rahim);
      const abandoned = Promise.all([
        documentRead(w.p1.documentId)(proof),
        detailRead(w.e.factId)(proof),
      ]);
      // Meanwhile the saved result is already there and unchanged.
      expect(await writeCounts(w.db)).toEqual(countsBefore);
      expect(await historyFingerprint(w.db)).toBe(historyBefore);
      // The late look still ends in a real answer, not an error.
      for (const result of await abandoned) expect(result.ok).toBe(true);
      // And after the late look has ended, still nothing was written or removed.
      expect(await writeCounts(w.db)).toEqual(countsBefore);
      expect(await historyFingerprint(w.db)).toBe(historyBefore);
    },
    HEAVY,
  );
});

describe('the cost of one read', () => {
  it(
    'is the measured count on a cold handle, the presence check asked once in one statement',
    async () => {
      const w = await buildImpactWorld();
      const preview = await coldRead(w, documentRead(w.p1.documentId));
      await replaceWithNewerPassport(w);
      await changeEmploymentDetail(w);
      const recorded = await coldRead(w, documentRead(w.p1.documentId));
      const detail = await coldRead(w, detailRead(w.e.factId));
      const controlDocument = await coldRead(w, documentRead(w.controlDocument.documentId));
      const controlDetail = await coldRead(w, detailRead(w.controlDetail.factId));
      const runs = { preview, recorded, detail, controlDocument, controlDetail };
      expect(
        Object.fromEntries(
          Object.entries(runs).map(([name, run]) => [name, run.statements.length]),
        ),
      ).toEqual({
        preview: 10,
        recorded: DOCUMENT_STATEMENT_BUDGET,
        detail: DETAIL_STATEMENT_BUDGET,
        controlDocument: 8,
        controlDetail: 9,
      });
      for (const run of Object.values(runs)) {
        expect(presenceChecks(run.statements)).toBe(1);
        expect(run.statements[0]).toContain('to_regclass');
      }

      // A second read on the same handle remembers that every table is there: one fewer.
      const handle = freshHandle(w);
      const proof = await ownerManage(handle.db, handle.rahim);
      must(await documentRead(w.p1.documentId)(proof), 'cold');
      w.log.length = 0;
      must(await documentRead(w.p1.documentId)(proof), 'warm');
      expect(presenceChecks(w.log)).toBe(0);
      expect(w.log.length).toBe(recorded.statements.length - 1);
    },
    HEAVY,
  );

  it(
    'stays inside the measured statement budget for the full scenario',
    async () => {
      const w = await bothChanges();
      const run = await measured(w);
      expect(run.documentStatements.length).toBeLessThanOrEqual(DOCUMENT_STATEMENT_BUDGET);
      expect(run.detailStatements.length).toBeLessThanOrEqual(DETAIL_STATEMENT_BUDGET);
      expect(run.documentStatements.length).toBeGreaterThanOrEqual(STATEMENT_FLOOR);
      expect(run.detailStatements.length).toBeGreaterThanOrEqual(STATEMENT_FLOOR);
      // The time one read took is measured for the report only; it is never asserted, because a
      // busy machine would make it fail for no fault of the code.
      expect(run.documentMs).toBeGreaterThanOrEqual(0);
      expect(run.detailMs).toBeGreaterThanOrEqual(0);
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
