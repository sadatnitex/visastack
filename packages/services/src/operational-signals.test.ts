import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  OPERATIONAL_SIGNAL_KEYS,
  type OperationalSignal,
  type OperationalSignalKey,
  collectOperationalSignals,
} from './operational-signals';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

const NOW = new Date('2026-10-05T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const hoursAgo = (n: number) => minutesAgo(n * 60);
const daysAgo = (n: number) => hoursAgo(n * 24);

function pick(signals: readonly OperationalSignal[], key: OperationalSignalKey): OperationalSignal {
  const found = signals.find((s) => s.key === key);
  if (!found) throw new Error(`no signal ${key}`);
  return found;
}

async function seedVersion(db: Db, email = 'ops03@example.com') {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'QUARANTINE',
    objectKey: `obj-${email}`,
  });
  if (!isOk(version)) throw new Error('version');
  return { account, applicantId: applicant.value.id, versionId: version.value.version.id };
}

describe('collectOperationalSignals (OPS-03)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function signals(input: Parameters<typeof collectOperationalSignals>[1] = {}) {
    return collectOperationalSignals(db, { now: NOW, ...input });
  }

  it('reports every named signal exactly once, in a fixed order, on an empty system', async () => {
    const result = await signals();
    expect(result.map((s) => s.key)).toEqual([...OPERATIONAL_SIGNAL_KEYS]);
    for (const key of [
      'job_queue_age',
      'job_failures',
      'scanner_availability',
      'object_storage_failures',
      'abandoned_uploads',
      'notification_backlog',
      'email_failure',
      'denied_access',
      'deletion_job_failures',
    ] as const) {
      expect(pick(result, key).status, key).toBe('ok');
    }
  });

  it('never claims to measure what the application cannot, and never invents a circuit breaker', async () => {
    const result = await signals();
    for (const key of [
      'core_availability',
      'request_latency',
      'error_rate',
      'database_errors',
      'connection_pressure',
      'render_failures',
    ] as const) {
      expect(pick(result, key).status, key).toBe('not_measured');
      expect(pick(result, key).source, key).not.toBe('database');
    }
    expect(pick(result, 'signature_age').status).toBe('not_measured');
    expect(pick(result, 'ai_circuit_breaker')).toMatchObject({
      status: 'not_built',
      source: 'not_built',
    });
    expect(pick(result, 'ai_circuit_breaker').detail).toContain('no circuit breaker');
  });

  it('says what it was not given rather than guessing: migrations and AI limits', async () => {
    const result = await signals();
    expect(pick(result, 'schema_migrations').status).toBe('not_measured');
    expect(pick(result, 'ai_spend').status).toBe('not_measured');
  });

  describe('database migrations', () => {
    it('is critical and names what is pending when the build ships migrations the database lacks', async () => {
      const result = await signals({
        migrations: { expected: 84, applied: 79, pending: ['0079_a', '0080_b'] },
      });
      const signal = pick(result, 'schema_migrations');
      expect(signal.status).toBe('critical');
      expect(signal.reading).toBe('2 pending');
      expect(signal.detail).toContain('0079_a, 0080_b');
    });

    it('is ok when nothing is pending', async () => {
      const result = await signals({ migrations: { expected: 84, applied: 84, pending: [] } });
      expect(pick(result, 'schema_migrations')).toMatchObject({
        status: 'ok',
        reading: '84 of 84 applied',
      });
    });
  });

  describe('intake queue and failures', () => {
    async function job(
      versionId: string,
      key: string,
      fields: Partial<typeof schema.processingJobs.$inferInsert>,
    ) {
      await db
        .insert(schema.processingJobs)
        .values({ documentVersionId: versionId, idempotencyKey: key, ...fields });
    }

    it('grades the age of the oldest due waiting job, ignoring work not yet due', async () => {
      const { versionId } = await seedVersion(db);
      await job(versionId, 'future', { availableAt: new Date(NOW.getTime() + 3_600_000) });
      expect(pick(await signals(), 'job_queue_age').reading).toBe('nothing waiting');

      await job(versionId, 'waiting', { availableAt: minutesAgo(20) });
      const warning = pick(await signals(), 'job_queue_age');
      expect(warning.status).toBe('warning');
      expect(warning.reading).toBe('oldest waiting job: 20 min');

      await job(versionId, 'stale', { availableAt: hoursAgo(3) });
      const critical = pick(await signals(), 'job_queue_age');
      expect(critical.status).toBe('critical');
      expect(critical.reading).toBe('oldest waiting job: 3.0 h');
    });

    it('does not count finished or in-flight jobs as waiting', async () => {
      const { versionId } = await seedVersion(db);
      await job(versionId, 'done', { status: 'DONE', availableAt: hoursAgo(5) });
      await job(versionId, 'claimed', { status: 'CLAIMED', availableAt: hoursAgo(5) });
      expect(pick(await signals(), 'job_queue_age').status).toBe('ok');
    });

    it('counts unresolved failures, with the last day broken out', async () => {
      const { versionId } = await seedVersion(db);
      await job(versionId, 'f1', { status: 'FAILED', updatedAt: minutesAgo(10) });
      await job(versionId, 'f2', { status: 'FAILED', updatedAt: daysAgo(3) });
      const one = pick(await signals(), 'job_failures');
      expect(one.status).toBe('warning');
      expect(one.reading).toBe('2 failed and unresolved (1 in the last 24 hours)');

      for (const i of [3, 4, 5]) {
        await job(versionId, `f${i}`, { status: 'FAILED', updatedAt: minutesAgo(5) });
      }
      expect(pick(await signals(), 'job_failures').status).toBe('critical');
    });
  });

  describe('scanner', () => {
    async function scan(versionId: string, scannedAt: Date, scanErrored: boolean) {
      await db.insert(schema.documentScanResults).values({
        documentVersionId: versionId,
        scannerName: 'test-scanner',
        scannerVersion: '1.2.3',
        scanErrored,
        safe: !scanErrored,
        scannedAt,
      });
    }

    it('is ok while every recent scan reached a verdict, warns on one error and is critical on a burst', async () => {
      const { versionId } = await seedVersion(db);
      await scan(versionId, minutesAgo(30), false);
      expect(pick(await signals(), 'scanner_availability').status).toBe('ok');

      await scan(versionId, hoursAgo(5), true);
      const warning = pick(await signals(), 'scanner_availability');
      expect(warning.status).toBe('warning');
      expect(warning.reading).toBe(
        '1 of 2 scans in 24 hours could not reach a verdict (0 in the last hour)',
      );

      for (const m of [5, 10, 15]) await scan(versionId, minutesAgo(m), true);
      expect(pick(await signals(), 'scanner_availability').status).toBe('critical');
    });

    it('names the scanner and version last used, without claiming to know its signature age', async () => {
      const { versionId } = await seedVersion(db);
      await scan(versionId, minutesAgo(30), false);
      const signal = pick(await signals(), 'signature_age');
      expect(signal.status).toBe('not_measured');
      expect(signal.reading).toBe('latest scan used test-scanner 1.2.3');
    });
  });

  describe('uploads and storage', () => {
    async function intake(
      accountId: string,
      applicantId: string,
      key: string,
      fields: Partial<typeof schema.uploadIntents.$inferInsert>,
    ) {
      await db.insert(schema.uploadIntents).values({
        accountId,
        applicantId,
        objectKey: key,
        reservedBytes: 1000,
        expiresAt: NOW,
        ...fields,
      });
    }

    it('flags a reservation the cleanup sweep should already have removed, not a normal expired one', async () => {
      const { account, applicantId } = await seedVersion(db);
      await intake(account.id, applicantId, 'k-recent', {
        status: 'RESERVED',
        expiresAt: hoursAgo(2),
      });
      const normal = pick(await signals(), 'abandoned_uploads');
      expect(normal.status).toBe('ok');
      expect(normal.reading).toBe('0 overdue for cleanup (1 expired in total)');

      await intake(account.id, applicantId, 'k-overdue', {
        status: 'RESERVED',
        expiresAt: hoursAgo(30),
      });
      const overdue = pick(await signals(), 'abandoned_uploads');
      expect(overdue.status).toBe('warning');
      expect(overdue.reading).toBe('1 overdue for cleanup (2 expired in total)');
    });

    it('warns on failed uploads in the last day and goes critical on a stuck deletion', async () => {
      const { account, applicantId } = await seedVersion(db);
      await intake(account.id, applicantId, 'k-failed', {
        status: 'FAILED',
        updatedAt: hoursAgo(2),
      });
      await intake(account.id, applicantId, 'k-old-failed', {
        status: 'FAILED',
        updatedAt: daysAgo(4),
      });
      const warning = pick(await signals(), 'object_storage_failures');
      expect(warning.status).toBe('warning');
      expect(warning.reading).toBe('1 failed uploads in 24 hours, 0 stuck deletions');

      await db.insert(schema.erasureJobs).values({
        reason: 'RETENTION_PURGE',
        status: 'FAILED',
        bucket: 'CLEAN',
        objectKey: 'gone',
        storageObjectId: '00000000-0000-4000-8000-000000000001',
      });
      expect(pick(await signals(), 'object_storage_failures').status).toBe('critical');
    });
  });

  describe('notifications and email', () => {
    async function notify(
      accountId: string,
      key: string,
      fields: Partial<typeof schema.notifications.$inferInsert>,
    ) {
      await db.insert(schema.notifications).values({
        eventType: 'TEST_EVENT',
        channel: 'EMAIL',
        idempotencyKey: key,
        recipientAccountId: accountId,
        payload: { subject: 's', summary: 'x', deepLinkPath: '/app' },
        createdAt: minutesAgo(1),
        ...fields,
      });
    }

    it('grades the oldest queued notification', async () => {
      const { account } = await seedVersion(db);
      await notify(account.id, 'sent', { status: 'SENT', createdAt: hoursAgo(5) });
      expect(pick(await signals(), 'notification_backlog').reading).toBe('nothing queued');

      await notify(account.id, 'queued', { status: 'QUEUED', createdAt: minutesAgo(30) });
      const warning = pick(await signals(), 'notification_backlog');
      expect(warning.status).toBe('warning');
      expect(warning.reading).toBe('1 queued, oldest 30 min');

      await notify(account.id, 'queued-old', { status: 'QUEUED', createdAt: hoursAgo(2) });
      expect(pick(await signals(), 'notification_backlog').status).toBe('critical');
    });

    it('is critical when a fifth of recent emails failed or bounced, and only warns on a handful among many', async () => {
      const { account } = await seedVersion(db);
      for (let i = 0; i < 10; i++) await notify(account.id, `s${i}`, { status: 'SENT' });
      await notify(account.id, 'f1', { status: 'FAILED' });
      await notify(account.id, 'f2', { status: 'BOUNCED' });
      const few = pick(await signals(), 'email_failure');
      expect(few.status).toBe('warning');
      expect(few.reading).toContain('2 of 12 emails');

      await notify(account.id, 'f3', { status: 'FAILED' });
      const many = pick(await signals(), 'email_failure');
      expect(many.status).toBe('critical');
      expect(many.reading).toBe('3 of 13 emails in 24 hours failed or bounced (23.1%)');
    });

    it('ignores in-app notifications and emails older than a day', async () => {
      const { account } = await seedVersion(db);
      await notify(account.id, 'in-app', { channel: 'IN_APP', status: 'FAILED' });
      await notify(account.id, 'old', { status: 'FAILED', createdAt: daysAgo(3) });
      expect(pick(await signals(), 'email_failure').status).toBe('ok');
    });
  });

  describe('denied access', () => {
    async function denied(count: number, occurredAt: Date) {
      await db.insert(schema.auditEvents).values(
        Array.from({ length: count }, (_, i) => ({
          eventType: 'ACCESS_DENIED',
          result: 'DENIED' as const,
          occurredAt,
          hash: `h-${occurredAt.getTime()}-${i}`,
        })),
      );
    }

    it('is quiet at the usual rate and loud when the last hour is far above it', async () => {
      // About 2 an hour for the previous 7 days.
      await denied(7 * 24 * 2, daysAgo(2));
      await denied(5, minutesAgo(10));
      expect(pick(await signals(), 'denied_access').status).toBe('ok');

      await denied(30, minutesAgo(20));
      expect(pick(await signals(), 'denied_access').status).toBe('warning');

      await denied(100, minutesAgo(30));
      const critical = pick(await signals(), 'denied_access');
      expect(critical.status).toBe('critical');
      expect(critical.reading).toBe(
        '135 in the last hour, against about 2 an hour over the previous 7 days',
      );
    });

    it('treats a first burst with no history as a spike', async () => {
      await denied(25, minutesAgo(5));
      expect(pick(await signals(), 'denied_access').status).toBe('warning');
    });

    it('does not count allowed events', async () => {
      await db.insert(schema.auditEvents).values(
        Array.from({ length: 150 }, (_, i) => ({
          eventType: 'ACCESS_ALLOWED',
          result: 'ALLOWED' as const,
          occurredAt: minutesAgo(5),
          hash: `allowed-${i}`,
        })),
      );
      expect(pick(await signals(), 'denied_access').status).toBe('ok');
    });
  });

  describe('audit log integrity', () => {
    it('is ok over events written by the real services', async () => {
      await seedVersion(db);
      const signal = pick(await signals(), 'audit_integrity');
      expect(signal.status).toBe('ok');
      expect(signal.reading).toMatch(/^newest \d+ events chain and recompute correctly$/);
    });

    it('is critical when an event is no longer linked to the one before it', async () => {
      await seedVersion(db);
      await db.execute(sql`alter table audit_events disable rule audit_events_no_update`);
      const rows = await db.select().from(schema.auditEvents).orderBy(schema.auditEvents.seq);
      const victim = rows[Math.floor(rows.length / 2)];
      if (!victim) throw new Error('no events');
      await db
        .update(schema.auditEvents)
        .set({ prevHash: 'not-the-previous-hash' })
        .where(eq(schema.auditEvents.seq, victim.seq));
      const signal = pick(await signals(), 'audit_integrity');
      expect(signal.status).toBe('critical');
      expect(signal.reading).toBe(`chain broken at event ${victim.seq}`);
    });

    it('is a warning, not an alarm, when links hold but an event no longer matches its hash', async () => {
      await seedVersion(db);
      await db.execute(sql`alter table audit_events disable rule audit_events_no_update`);
      const rows = await db.select().from(schema.auditEvents).orderBy(schema.auditEvents.seq);
      const victim = rows[Math.floor(rows.length / 2)];
      if (!victim) throw new Error('no events');
      await db
        .update(schema.auditEvents)
        .set({ eventType: 'EDITED_AFTERWARDS' })
        .where(eq(schema.auditEvents.seq, victim.seq));
      const signal = pick(await signals(), 'audit_integrity');
      expect(signal.status).toBe('warning');
      expect(signal.reading).toContain('1 of the newest');
    });
  });

  describe('AI', () => {
    it('grades spend against the warning point and the ceiling', async () => {
      const spend = (spentUnits: number) =>
        signals({ ai: { spentUnits, warningUnits: 80, limitUnits: 100 } }).then((r) =>
          pick(r, 'ai_spend'),
        );
      expect((await spend(10)).status).toBe('ok');
      expect((await spend(80)).status).toBe('warning');
      const over = await spend(100);
      expect(over.status).toBe('critical');
      expect(over.reading).toBe('100 of 100 cost units (warning at 80)');
    });

    it('reports the AI failure rate beside the breaker that does not exist, and flags a failing provider', async () => {
      const { applicantId, versionId } = await seedVersion(db);
      const run = (status: 'SUCCEEDED' | 'FAILED', createdAt: Date) =>
        db.insert(schema.aiClassificationRuns).values({
          documentVersionId: versionId,
          applicantId,
          status,
          modelVersion: 'm',
          promptVersion: 'p',
          createdAt,
        });
      for (let i = 0; i < 6; i++) await run('SUCCEEDED', minutesAgo(10));
      const healthy = pick(await signals(), 'ai_circuit_breaker');
      expect(healthy.status).toBe('not_built');
      expect(healthy.reading).toBe('0 of 6 AI runs in the last hour failed (0%)');

      for (let i = 0; i < 8; i++) await run('FAILED', minutesAgo(5));
      // An old failure must not count.
      await run('FAILED', hoursAgo(5));
      const failing = pick(await signals(), 'ai_circuit_breaker');
      expect(failing.status).toBe('warning');
      expect(failing.source).toBe('database');
      expect(failing.reading).toBe('8 of 14 AI runs in the last hour failed (57.1%)');
    });
  });

  describe('deletion jobs', () => {
    async function erasure(key: string, status: 'FAILED' | 'BLOCKED_BY_HOLD' | 'VERIFIED') {
      await db.insert(schema.erasureJobs).values({
        reason: 'ACCOUNT_DELETION',
        status,
        bucket: 'CLEAN',
        objectKey: key,
        storageObjectId: crypto.randomUUID(),
      });
    }

    it('is critical for an exhausted job and only a warning for one held by a legal hold', async () => {
      await erasure('verified', 'VERIFIED');
      expect(pick(await signals(), 'deletion_job_failures').status).toBe('ok');
      await erasure('held', 'BLOCKED_BY_HOLD');
      expect(pick(await signals(), 'deletion_job_failures').status).toBe('warning');
      await erasure('failed', 'FAILED');
      const critical = pick(await signals(), 'deletion_job_failures');
      expect(critical.status).toBe('critical');
      expect(critical.reading).toBe('1 failed, 1 blocked by a legal hold');
    });
  });

  describe('resilience and privacy', () => {
    it('reports one unreadable signal as unreadable without hiding the rest', async () => {
      await db.execute(sql`drop table notifications cascade`);
      const result = await signals();
      expect(result).toHaveLength(OPERATIONAL_SIGNAL_KEYS.length);
      for (const key of ['notification_backlog', 'email_failure'] as const) {
        const signal = pick(result, key);
        expect(signal.status, key).toBe('not_measured');
        expect(signal.reading).toBe('could not be read');
        expect(signal.detail).toContain('42P01');
      }
      expect(pick(result, 'job_queue_age').status).toBe('ok');
    });

    it('puts no identifier, address or content in anything it returns', async () => {
      const { account, applicantId, versionId } = await seedVersion(
        db,
        'private.person@example.com',
      );
      await db.insert(schema.processingJobs).values({
        documentVersionId: versionId,
        idempotencyKey: 'secret-key-123',
        status: 'FAILED',
        lastError: 'passport A1234567 could not be read',
        errorCode: 'EXTRACT_FAILED',
      });
      await db.insert(schema.notifications).values({
        eventType: 'TEST_EVENT',
        channel: 'EMAIL',
        idempotencyKey: 'n-1',
        recipientAccountId: account.id,
        recipientEmail: 'private.person@example.com',
        payload: { subject: 'Your visa for Jane Doe', summary: 'x', deepLinkPath: '/app' },
        status: 'FAILED',
        createdAt: minutesAgo(1),
      });
      await db.insert(schema.uploadIntents).values({
        accountId: account.id,
        applicantId,
        objectKey: 'private/jane-doe-passport.pdf',
        reservedBytes: 10,
        status: 'FAILED',
        failureReason: 'blob rejected jane-doe-passport.pdf',
        expiresAt: NOW,
        updatedAt: minutesAgo(1),
      });

      const result = await signals({
        ai: { spentUnits: 1, warningUnits: 8, limitUnits: 10 },
        migrations: { expected: 1, applied: 1, pending: [] },
      });
      const everything = JSON.stringify(result);
      for (const leaked of [
        account.id,
        applicantId,
        versionId,
        'private.person',
        'example.com',
        'A1234567',
        'Jane Doe',
        'jane-doe',
        'secret-key-123',
      ]) {
        expect(everything, leaked).not.toContain(leaked);
      }
      expect(everything).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    });
  });
});
