import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendAuditEvent } from './audit';
import type { Db } from './db';
import {
  SCANNER_EVIDENCE_MAX_AGE_MS,
  SCANNER_VERIFIED_EVENT,
  loadScannerEvidence,
  recordScannerEngineVerified,
} from './scanner-evidence';

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

describe('scanner evidence (S4)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('has no evidence until a worker run records one', async () => {
    expect(await loadScannerEvidence(db)).toBeNull();
  });

  it('reports a recorded verification with the engine text, and nothing else', async () => {
    await recordScannerEngineVerified(db, { engine: 'ClamAV 1.0.5/27000/Mon Oct 26' });
    const evidence = await loadScannerEvidence(db);
    expect(evidence?.engine).toBe('ClamAV 1.0.5/27000/Mon Oct 26');
    expect(evidence?.verifiedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const rows = await db.select().from(schema.auditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.applicantId).toBeNull();
    expect(rows[0]?.actorAccountId).toBeNull();
    expect(rows[0]?.method).toBe('SYSTEM');
  });

  it('strips anything unprintable and bounds the engine text', async () => {
    await recordScannerEngineVerified(db, { engine: `ClamAV\n\u0000${'x'.repeat(500)}` });
    const evidence = await loadScannerEvidence(db);
    expect(evidence?.engine).toMatch(/^ClamAVx+$/);
    expect(evidence?.engine.length).toBeLessThanOrEqual(120);
  });

  it('stops counting once the newest verification is older than three days', async () => {
    await recordScannerEngineVerified(db, { engine: 'ClamAV 1.0.5' });
    const later = new Date(Date.now() + SCANNER_EVIDENCE_MAX_AGE_MS + 60_000);
    expect(await loadScannerEvidence(db, later)).toBeNull();
    const nearly = new Date(Date.now() + SCANNER_EVIDENCE_MAX_AGE_MS - 60_000);
    expect(await loadScannerEvidence(db, nearly)).not.toBeNull();
  });

  it('ignores other audit events, even ones with a similar name', async () => {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: `${SCANNER_VERIFIED_EVENT}_FAKE`,
        method: 'SYSTEM',
        result: 'ALLOWED',
      });
    });
    expect(await loadScannerEvidence(db)).toBeNull();
  });

  it('answers "no evidence" rather than failing when the trail cannot be read', async () => {
    const broken = {
      select: () => {
        throw new Error('connection lost');
      },
    } as unknown as Db;
    expect(await loadScannerEvidence(broken)).toBeNull();
  });
});
