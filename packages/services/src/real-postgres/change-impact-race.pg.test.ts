import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import {
  type RealPostgres,
  realPostgresDb,
  startRealPostgres,
} from '@visastack/db/real-postgres-testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { submitEvidenceResponse } from '../agency';
import { AUDIT_CHAIN_LOCK_KEY } from '../audit';
import { assessDetailChangeImpact, assessDocumentChangeImpact } from '../change-impact';
import {
  E_VALUE_2,
  PASSPORT_TYPE,
  askForDetail,
  buildImpactRecords,
  itemOf,
  makeDocument,
  must,
  ownerManage,
} from '../change-impact/scenario.test-support';
import type { Db } from '../db';
import { replaceDocument } from '../lifecycle/replace';
import { editFact } from '../profile';

/**
 * "What This Change Affects" read at the same moment as the change it describes, on separate real
 * database connections (PGlite has one connection, so it cannot show this).
 *
 * The read takes a share lock on the changed item's row first and keeps it for its whole
 * transaction. Recording a replacement locks the document's row for update; saving a detail
 * updates the detail's row; sending a detail locks it for update. So a read and a change of the
 * same item never interleave: whichever locks the row first finishes first, and the read's
 * picture is wholly before or wholly after the change.
 *
 * How an order is forced: a third connection holds the audit chain's lock (every audited write
 * takes it just before its audit record, after its real work, still holding its row locks). The
 * change runs until it waits there; the read is started and is seen, in `pg_locks`, waiting on
 * the row; then the third connection lets go.
 *
 * Runs only against a real server (`pnpm --filter @visastack/services test:pg`, with
 * TEST_POSTGRES_URL set); CI runs it against a throwaway Postgres service container.
 */

const TIMEOUT = 180_000;

let pg: RealPostgres;

beforeAll(async () => {
  pg = await startRealPostgres();
}, TIMEOUT);

afterAll(async () => {
  await pg?.close();
}, TIMEOUT);

async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false;
  p.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  return done;
}

/** The shared scenario on one real database, with separate pools for the change, the read and an observer. */
async function race() {
  const database = await pg.freshDatabase();
  const changeDb = realPostgresDb(pg.pool(database)) as unknown as Db;
  const sendDb = realPostgresDb(pg.pool(database)) as unknown as Db;
  const readDb = realPostgresDb(pg.pool(database)) as unknown as Db;
  const observerPool = pg.pool(database, 2);
  const observer = realPostgresDb(observerPool) as unknown as Db;
  const w = await buildImpactRecords(observer);

  /** Hold the audit chain's lock on a connection of its own until `release()`. */
  async function holdAuditLock() {
    const client = await observerPool.connect();
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK_KEY]);
    let held = true;
    return {
      async release() {
        if (!held) return;
        held = false;
        await client.query('commit');
        client.release();
      },
    };
  }

  /** Wait until the connections waiting for a lock are exactly `expected` (sorted). */
  async function waitForWaiters(expected: readonly ('audit' | 'row')[]) {
    const want = [...expected].sort().join(',');
    const deadline = Date.now() + 30_000;
    let seen = '';
    for (;;) {
      const { rows } = await observerPool.query<{ kind: string }>(
        `select case when l.locktype = 'advisory' then 'audit'
                     when l.locktype in ('transactionid', 'tuple') then 'row'
                     else l.locktype end as kind
           from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where not l.granted and a.datname = current_database() and l.pid <> pg_backend_pid()`,
      );
      seen = rows
        .map((row) => row.kind)
        .sort()
        .join(',');
      if (seen === want) return;
      if (Date.now() > deadline)
        throw new Error(`waiting locks: expected [${want}], saw [${seen}]`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return { w, observer, changeDb, sendDb, readDb, holdAuditLock, waitForWaiters };
}

describe('a read racing a replacement being recorded, on real connections', () => {
  it(
    'replacement first: the read waits for it and then shows it wholly recorded',
    async () => {
      const r = await race();
      const { w } = r;
      const newer = await makeDocument(r.observer, w.rahim, PASSPORT_TYPE, 'sample-newer.pdf');
      const readProof = await ownerManage(r.readDb, w.rahim);
      const before = must(
        await assessDocumentChangeImpact(readProof, { documentId: w.p1.documentId }),
        'before',
      );
      expect(before.phase).toBe('PREVIEW');

      const lock = await r.holdAuditLock();
      try {
        // The replacement links the documents, flags the case, and stops at the audit lock,
        // still holding both document rows.
        const replacing = replaceDocument(await ownerManage(r.changeDb, w.rahim), {
          oldDocumentId: w.p1.documentId,
          newDocumentId: newer.documentId,
        });
        await r.waitForWaiters(['audit']);
        // The read cannot look around the half-made change: it waits on the document's row.
        const reading = assessDocumentChangeImpact(readProof, { documentId: w.p1.documentId });
        await r.waitForWaiters(['audit', 'row']);
        expect(await settled(reading)).toBe(false);
        await lock.release();

        expect(isOk(await replacing)).toBe(true);
        const impact = must(await reading, 'read');
        expect(impact.phase).toBe('RECORDED');
        expect(impact.subject).toMatchObject({ replacement: { documentId: newer.documentId } });
        expect(itemOf(impact, `case:${w.liveCaseId}`).reason).toBe(
          'LIVE_CASE_USES_REPLACED_DOCUMENT',
        );
        expect(itemOf(impact, `share:${w.agencyBShareId}`).reason).toBe(
          'SHARE_COVERS_EARLIER_ONLY',
        );
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );

  it(
    'read first: a replacement started during the read waits until the read is done',
    async () => {
      const r = await race();
      const { w } = r;
      const newer = await makeDocument(r.observer, w.rahim, PASSPORT_TYPE, 'sample-newer.pdf');
      let replacing: Promise<Awaited<ReturnType<typeof replaceDocument>>> | undefined;

      // The read runs inside a caller's transaction that is kept open after it returns, which
      // stands in for a read that is still going: its share lock is held until that ends.
      const impact = await readDb(r.readDb, async (tx) => {
        const proof = must(
          await requireAccess(
            tx,
            accountPrincipal(w.rahim.accountId),
            'MANAGE',
            { applicantId: w.rahim.applicantId },
            { purpose: 'change_impact' },
          ),
          'proof',
        );
        const read = must(
          await assessDocumentChangeImpact(proof, { documentId: w.p1.documentId }),
          'read',
        );
        replacing = replaceDocument(await ownerManage(r.changeDb, w.rahim), {
          oldDocumentId: w.p1.documentId,
          newDocumentId: newer.documentId,
        });
        await r.waitForWaiters(['row']);
        expect(await settled(replacing)).toBe(false);
        // Nothing of the replacement is visible while it waits.
        const [row] = await r.observer
          .select({ by: schema.documents.supersededByDocumentId })
          .from(schema.documents)
          .where(eq(schema.documents.id, w.p1.documentId));
        expect(row?.by).toBeNull();
        return read;
      });
      expect(impact.phase).toBe('PREVIEW');
      expect(impact.subject).toMatchObject({ replacement: null });
      if (!replacing) throw new Error('replacement was not started');
      expect(isOk(await replacing)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'unforced: a read beside a replacement is never a mix of before and after',
    async () => {
      const r = await race();
      const { w } = r;
      const newer = await makeDocument(r.observer, w.rahim, PASSPORT_TYPE, 'sample-newer.pdf');
      const readProof = await ownerManage(r.readDb, w.rahim);
      const reads = Array.from({ length: 6 }, () =>
        assessDocumentChangeImpact(readProof, { documentId: w.p1.documentId }),
      );
      const replacing = replaceDocument(await ownerManage(r.changeDb, w.rahim), {
        oldDocumentId: w.p1.documentId,
        newDocumentId: newer.documentId,
      });
      const later = Array.from({ length: 6 }, () =>
        assessDocumentChangeImpact(readProof, { documentId: w.p1.documentId }),
      );
      expect(isOk(await replacing)).toBe(true);
      for (const result of await Promise.all([...reads, ...later])) {
        const impact = must(result, 'read');
        const replacement = impact.subject.kind === 'DOCUMENT' ? impact.subject.replacement : null;
        if (impact.phase === 'RECORDED') {
          expect(replacement).toMatchObject({ documentId: newer.documentId });
        } else {
          expect(replacement).toBeNull();
        }
        expect(itemOf(impact, `share:${w.agencyBShareId}`).reason).toBe(
          'SHARE_COVERS_EARLIER_ONLY',
        );
      }
    },
    TIMEOUT,
  );
});

/** Run `fn` in one transaction on `db` and return what it returns. */
function readDb<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx as unknown as Db));
}

describe('a read racing a detail edit and a send, on real connections', () => {
  it(
    'send first: the read waits, then classifies the send by the value it pinned',
    async () => {
      const r = await race();
      const { w } = r;
      const requestId = await askForDetail(r.observer, w.agencyA, w.rahim);
      const readProof = await ownerManage(r.readDb, w.rahim);
      const lock = await r.holdAuditLock();
      try {
        // The send pins the first value and stops at the audit lock, holding the detail's row.
        const sending = submitEvidenceResponse(r.sendDb, {
          actorAccountId: w.rahim.accountId,
          requestId,
          factId: w.e.factId,
        });
        await r.waitForWaiters(['audit']);
        // The edit and the read both wait on the detail's row.
        const editing = editFact(r.changeDb, {
          actorAccountId: w.rahim.accountId,
          applicantId: w.rahim.applicantId,
          fieldKey: 'current_employer',
          value: E_VALUE_2,
        });
        await r.waitForWaiters(['audit', 'row']);
        const reading = assessDetailChangeImpact(readProof, { factId: w.e.factId });
        await r.waitForWaiters(['audit', 'row', 'row']);
        expect(await settled(reading)).toBe(false);
        expect(await settled(editing)).toBe(false);
        await lock.release();

        expect(isOk(await sending)).toBe(true);
        const edited = await editing;
        expect(isOk(edited)).toBe(true);
        const racing = must(await reading, 'racing read');

        // The send pinned the first value, whatever happened around it.
        const pins = await r.observer
          .select()
          .from(schema.evidenceRequestFactSubmissions)
          .where(eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, requestId));
        expect(pins.map((pin) => pin.factVersionId)).toEqual([w.e.v1]);

        // The racing read ran wholly before the edit or wholly after it, and says the matching
        // thing about the send: never "one saved value" together with "an earlier value".
        const saved = racing.subject.kind === 'DETAIL' ? racing.subject.savedValues : 0;
        expect([1, 2]).toContain(saved);
        expect(itemOf(racing, `request:${requestId}`).reason).toBe(
          saved === 1 ? 'AGENCY_HOLDS_CURRENT' : 'AGENCY_CHECKING_EARLIER',
        );
        expect(itemOf(racing, `case:${w.liveCaseId}`).reason).toBe(
          saved === 1 ? 'LIVE_CASE_FOLLOWS_CURRENT' : 'LIVE_CASE_CONFIRMATION_VOID',
        );

        // Once everything has landed: the send carried the earlier value.
        const after = must(
          await assessDetailChangeImpact(readProof, { factId: w.e.factId }),
          'after',
        );
        expect(after.subject).toMatchObject({ savedValues: 2 });
        expect(itemOf(after, `request:${requestId}`).reason).toBe('AGENCY_CHECKING_EARLIER');
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );

  it(
    'edit first: the send pins the new value and the read says the agency holds the current one',
    async () => {
      const r = await race();
      const { w } = r;
      const requestId = await askForDetail(r.observer, w.agencyA, w.rahim);
      const readProof = await ownerManage(r.readDb, w.rahim);
      const lock = await r.holdAuditLock();
      try {
        // The edit saves the second value and stops at the audit lock, holding the detail's row.
        const editing = editFact(r.changeDb, {
          actorAccountId: w.rahim.accountId,
          applicantId: w.rahim.applicantId,
          fieldKey: 'current_employer',
          value: E_VALUE_2,
        });
        await r.waitForWaiters(['audit']);
        const sending = submitEvidenceResponse(r.sendDb, {
          actorAccountId: w.rahim.accountId,
          requestId,
          factId: w.e.factId,
        });
        await r.waitForWaiters(['audit', 'row']);
        const reading = assessDetailChangeImpact(readProof, { factId: w.e.factId });
        await r.waitForWaiters(['audit', 'row', 'row']);
        expect(await settled(reading)).toBe(false);
        await lock.release();

        const edited = await editing;
        if (!isOk(edited)) throw new Error('edit');
        expect(isOk(await sending)).toBe(true);
        const racing = must(await reading, 'racing read');
        // The read waited for the edit, so it never shows the detail as unchanged.
        expect(racing.subject).toMatchObject({ savedValues: 2 });
        expect(itemOf(racing, `case:${w.liveCaseId}`).reason).toBe('LIVE_CASE_CONFIRMATION_VOID');
        // The send is either not there yet or pinned to the new value: never "earlier".
        const racingRequest = racing.items.find((item) => item.id === `request:${requestId}`);
        if (racingRequest) expect(racingRequest.reason).toBe('AGENCY_HOLDS_CURRENT');

        const pins = await r.observer
          .select()
          .from(schema.evidenceRequestFactSubmissions)
          .where(eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, requestId));
        expect(pins.map((pin) => pin.factVersionId)).toEqual([edited.value.version.id]);
        const after = must(
          await assessDetailChangeImpact(readProof, { factId: w.e.factId }),
          'after',
        );
        expect(itemOf(after, `request:${requestId}`).reason).toBe('AGENCY_HOLDS_CURRENT');
        // The answer accepted before the edit still holds the earlier value.
        expect(itemOf(after, `request:${w.detailRequestId}`).reason).toBe(
          'AGENCY_ACCEPTED_EARLIER_LIVE_WORK',
        );
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );
});
