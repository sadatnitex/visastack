import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import {
  type RealPostgres,
  realPostgresDb,
  startRealPostgres,
} from '@visastack/db/real-postgres-testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideEvidenceResponse, requestEvidence, submitEvidenceResponse } from '../agency';
import { AUDIT_CHAIN_LOCK_KEY } from '../audit';
import type { Db } from '../db';
import { readEvidenceFieldAnswer } from '../evidence-field-answers';
import { ownerProof } from '../evidence-submissions.test-support';
import { editFact } from '../profile';
import {
  agencyNoticesFor,
  registerCatalogueField,
  requestRow,
  trustWorld,
} from '../trust-rules/trust-rules.test-support';

/**
 * A traveller edits a detail at the same moment they send it in answer to an agency's request,
 * on two real database connections (PGlite has one connection, so it cannot show this).
 *
 * The send pins the detail's saved version inside its own locked transaction (#550,
 * `pinFieldVersion`: the detail's row is locked FOR UPDATE and its current version read). An edit
 * appends a new version (its foreign key takes a KEY SHARE lock on the same row) and then points the
 * detail at it. The two therefore cannot interleave inside each other: whichever locks the row
 * first finishes first. These tests force each order on purpose and check that the send carries
 * exactly one consistent, committed version, that the agency's decision is tied to that send, and
 * that nothing shows the detail's current value in place of what was sent.
 *
 * How an order is forced: a third connection holds the audit chain's lock (every audited write
 * takes it just before its audit record, after its real work). The first side runs until it
 * reaches that lock and waits there, still holding its row locks; the second side is started and
 * is seen, in `pg_locks`, waiting on the detail's row (not on the audit lock); then the third
 * connection lets go.
 *
 * Runs only against a real server (`pnpm --filter @visastack/services test:pg`, with
 * TEST_POSTGRES_URL set); CI runs it against a throwaway Postgres service container.
 */

const TIMEOUT = 120_000;
const V1 = '+8801700000111';
const V2 = '+8801700000222';

let pg: RealPostgres;

beforeAll(async () => {
  pg = await startRealPostgres();
}, TIMEOUT);

afterAll(async () => {
  await pg?.close();
}, TIMEOUT);

/** One migrated database with three separate pools: the send's, the edit's, and an observer. */
async function race() {
  const database = await pg.freshDatabase();
  const sendDb = realPostgresDb(pg.pool(database)) as unknown as Db;
  const editDb = realPostgresDb(pg.pool(database)) as unknown as Db;
  const observerPool = pg.pool(database, 2);
  const observer = realPostgresDb(observerPool) as unknown as Db;

  const w = await trustWorld(observer);
  await registerCatalogueField(observer, 'phone');
  const save = (db: Db, value: string) =>
    editFact(db, {
      actorAccountId: w.rahim.accountId,
      applicantId: w.rahim.applicantId,
      fieldKey: 'phone',
      value,
    });
  const firstSave = await save(observer, V1);
  if (!isOk(firstSave)) throw new Error(`first save: ${firstSave.error.message}`);
  const asked = await requestEvidence(observer, {
    actorAccountId: w.north.accountId,
    organizationId: w.north.organizationId,
    applicantId: w.rahim.applicantId,
    kind: 'FIELD',
    fieldKey: 'phone',
  });
  if (!isOk(asked)) throw new Error('field request');
  const requestId = asked.value.id;

  const factId = firstSave.value.fact.id;
  const v1 = firstSave.value.version.id;
  const send = (extra: { factVersionId?: string } = {}) =>
    submitEvidenceResponse(sendDb, {
      actorAccountId: w.rahim.accountId,
      requestId,
      factId,
      ...extra,
    });

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

  /**
   * Wait until the connections of this database that are waiting for a lock are exactly `expected`:
   * `audit` for one held at the audit chain's lock, `row` for one waiting on a row another
   * transaction has locked. Sorted, so the order does not matter.
   */
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

  async function currentVersion() {
    const [row] = await observer
      .select({ current: schema.facts.currentVersionId })
      .from(schema.facts)
      .where(eq(schema.facts.id, factId));
    return row?.current ?? null;
  }

  async function sends() {
    return observer
      .select()
      .from(schema.evidenceRequestFactSubmissions)
      .where(eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, requestId));
  }

  async function ownerHistory() {
    const read = await readEvidenceFieldAnswer(await ownerProof(observer, w.rahim), {
      requestId,
    });
    if (!isOk(read)) throw new Error(`owner read: ${read.error.message}`);
    return read.value;
  }

  async function decide(submissionId: string) {
    return decideEvidenceResponse(observer, {
      actorAccountId: w.north.accountId,
      requestId,
      outcome: 'ACCEPTED',
      submissionId,
    });
  }

  return {
    w,
    factId,
    v1,
    requestId,
    observer,
    editDb,
    edit: (value: string) => save(editDb, value),
    send,
    holdAuditLock,
    waitForWaiters,
    currentVersion,
    sends,
    ownerHistory,
    decide,
  };
}

/** True once a promise has settled, without waiting for it. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  return (
    (await Promise.race([
      p.then(
        () => true,
        () => true,
      ),
      Promise.resolve(marker),
    ])) !== marker
  );
}

describe('a detail edit racing a send, on two real connections', () => {
  it(
    'send first: the send pins the version it locked, the edit waits and lands after it',
    async () => {
      const r = await race();
      const lock = await r.holdAuditLock();
      try {
        // The send pins, writes its row, and stops at the audit lock still holding the detail's row.
        const sending = r.send();
        await r.waitForWaiters(['audit']);
        // The edit now has to wait for the send's row lock: it cannot add a version to a detail
        // being sent (it is seen waiting on that row, not on the audit lock).
        const editing = r.edit(V2);
        await r.waitForWaiters(['audit', 'row']);
        expect(await settled(editing)).toBe(false);
        // Nobody outside either transaction sees a half-made state.
        expect(await r.currentVersion()).toBe(r.v1);
        expect(await r.sends()).toHaveLength(0);
        await lock.release();

        const sent = await sending;
        const edited = await editing;
        expect(isOk(sent)).toBe(true);
        expect(isOk(edited)).toBe(true);
        if (!isOk(sent) || !isOk(edited)) return;
        const v2 = edited.value.version.id;
        expect(v2).not.toBe(r.v1);
        expect(await r.currentVersion()).toBe(v2);

        // Exactly one send, pinned to the version that was current when it locked the detail.
        const rows = await r.sends();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: sent.value.submissionId,
          factId: r.factId,
          factVersionId: r.v1,
          roundNo: 1,
        });

        // The decision is tied to that send, and what was sent is still what is shown.
        const decided = await r.decide(sent.value.submissionId ?? '');
        expect(isOk(decided)).toBe(true);
        const links = await r.observer.select().from(schema.evidenceRequestDecisionFactSubmissions);
        expect(links.map((l) => l.submissionId)).toEqual([sent.value.submissionId]);
        const history = await r.ownerHistory();
        expect(history.rounds).toHaveLength(1);
        expect(history.rounds[0]).toMatchObject({
          submissionId: sent.value.submissionId,
          precision: 'pinned',
          state: 'ACCEPTED',
          version: { id: r.v1, number: 1, value: V1, stillCurrent: false },
        });
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );

  it(
    'edit first: the send waits for the edit and pins the new version, never the old one',
    async () => {
      const r = await race();
      const lock = await r.holdAuditLock();
      try {
        // The edit adds its version, points the detail at it, and stops at the audit lock.
        const editing = r.edit(V2);
        await r.waitForWaiters(['audit']);
        // The send now has to wait on the detail's row until the edit finishes, before it can read
        // which version is current.
        const sending = r.send();
        await r.waitForWaiters(['audit', 'row']);
        expect(await settled(sending)).toBe(false);
        expect(await r.currentVersion()).toBe(r.v1);
        await lock.release();

        const edited = await editing;
        const sent = await sending;
        expect(isOk(edited)).toBe(true);
        expect(isOk(sent)).toBe(true);
        if (!isOk(sent) || !isOk(edited)) return;
        const v2 = edited.value.version.id;
        expect(await r.currentVersion()).toBe(v2);

        const rows = await r.sends();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: sent.value.submissionId,
          factId: r.factId,
          factVersionId: v2,
        });

        const decided = await r.decide(sent.value.submissionId ?? '');
        expect(isOk(decided)).toBe(true);
        const links = await r.observer.select().from(schema.evidenceRequestDecisionFactSubmissions);
        expect(links.map((l) => l.submissionId)).toEqual([sent.value.submissionId]);
        const history = await r.ownerHistory();
        expect(history.rounds[0]).toMatchObject({
          precision: 'pinned',
          state: 'ACCEPTED',
          version: { id: v2, number: 2, value: V2, stillCurrent: true },
        });
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );

  it(
    'edit first, while the screen still showed the old value: the send is refused as out of date and writes nothing',
    async () => {
      const r = await race();
      const lock = await r.holdAuditLock();
      try {
        const editing = r.edit(V2);
        await r.waitForWaiters(['audit']);
        const sending = r.send({ factVersionId: r.v1 });
        await r.waitForWaiters(['audit', 'row']);
        await lock.release();

        expect(isOk(await editing)).toBe(true);
        const sent = await sending;
        expect(isErr(sent) && sent.error.code).toBe('stale');
        expect(await r.sends()).toHaveLength(0);
        expect((await requestRow(r.observer, r.requestId)).status).toBe('OPEN');
        expect(await agencyNoticesFor(r.observer, r.requestId)).toHaveLength(0);
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );

  it(
    'send first, while the screen showed the value it pins: the send goes through and the edit after it does not move it',
    async () => {
      const r = await race();
      const lock = await r.holdAuditLock();
      try {
        const sending = r.send({ factVersionId: r.v1 });
        await r.waitForWaiters(['audit']);
        const editing = r.edit(V2);
        await r.waitForWaiters(['audit', 'row']);
        await lock.release();

        const sent = await sending;
        expect(isOk(sent)).toBe(true);
        expect(isOk(await editing)).toBe(true);
        const rows = await r.sends();
        expect(rows.map((row) => row.factVersionId)).toEqual([r.v1]);
      } finally {
        await lock.release();
      }
    },
    TIMEOUT,
  );
});
