import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  type ScanRecordForEvidence,
  TRUSTED_VIRUS_SCANNER_NAMES,
  deriveVersionScanEvidence,
  loadVersionScanEvidence,
} from './document-scan-evidence';
import { addDocumentVersion, isDocumentVersionUsable, registerDocument } from './documents';
import type { DocumentConverterPort, ExtractionOutcome } from './extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from './intake';

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

// The same names the real scanners record (guarded against the adapters in apps/web).
const STRUCTURAL = 'basic-structural-scanner';
const ANTIVIRUS = 'clamav';

const extractor: DocumentConverterPort = {
  async extract(): Promise<ExtractionOutcome> {
    return { ok: false, code: 'unsupported_format', message: 'test fixture: not exercised here' };
  },
};
const limits: ContentLimitsPort = {
  name: 'builtin-content-limits',
  version: '1.0.0',
  async check() {
    return { withinLimits: true };
  },
};
const scanner = (name: string, safe = true): MalwareScannerPort => ({
  name,
  version: '1.0.0',
  async scan() {
    return { safe };
  },
});

const record = (over: Partial<ScanRecordForEvidence> = {}): ScanRecordForEvidence => ({
  scannerName: ANTIVIRUS,
  scanErrored: false,
  safe: true,
  scannedAt: new Date('2026-11-01T10:00:00Z'),
  ...over,
});

describe('which scanner names count as a virus scan', () => {
  it('counts the antivirus engine and never the structural checker or the content limits', () => {
    expect(TRUSTED_VIRUS_SCANNER_NAMES.has('clamav')).toBe(true);
    expect(TRUSTED_VIRUS_SCANNER_NAMES.has(STRUCTURAL)).toBe(false);
    expect(TRUSTED_VIRUS_SCANNER_NAMES.has('builtin-content-limits')).toBe(false);
  });
});

describe('deriveVersionScanEvidence', () => {
  it('says virus scanned only for a clean file with a real antivirus pass', () => {
    expect(deriveVersionScanEvidence({ safetyStatus: 'CLEAN', records: [record()] })).toEqual({
      kind: 'VIRUS_SCANNED',
      scannedAt: '2026-11-01T10:00:00.000Z',
    });
  });

  it('says format checked for a clean file whose only passes are structural', () => {
    const records = [record({ scannerName: STRUCTURAL }), record({ scannerName: limits.name })];
    expect(deriveVersionScanEvidence({ safetyStatus: 'CLEAN', records }).kind).toBe(
      'FORMAT_CHECKED',
    );
    expect(deriveVersionScanEvidence({ safetyStatus: 'CLEAN', records: [] }).kind).toBe(
      'FORMAT_CHECKED',
    );
  });

  it('does not count an errored antivirus attempt or an unsafe verdict as a pass', () => {
    for (const bad of [record({ scanErrored: true, safe: false }), record({ safe: false })]) {
      expect(deriveVersionScanEvidence({ safetyStatus: 'CLEAN', records: [bad] }).kind).toBe(
        'FORMAT_CHECKED',
      );
    }
  });

  it('lets the newest antivirus record decide, so a later failure cancels an earlier pass', () => {
    const earlierPass = record({ scannedAt: new Date('2026-11-01T10:00:00Z') });
    const laterError = record({
      scanErrored: true,
      safe: false,
      scannedAt: new Date('2026-11-02T10:00:00Z'),
    });
    expect(
      deriveVersionScanEvidence({ safetyStatus: 'CLEAN', records: [earlierPass, laterError] }).kind,
    ).toBe('FORMAT_CHECKED');
    const laterPass = record({ scannedAt: new Date('2026-11-03T10:00:00Z') });
    expect(
      deriveVersionScanEvidence({
        safetyStatus: 'CLEAN',
        records: [earlierPass, laterError, laterPass],
      }).kind,
    ).toBe('VIRUS_SCANNED');
  });

  it('never resolves a tie in favour of scanned', () => {
    const at = new Date('2026-11-01T10:00:00Z');
    const records = [record({ scannedAt: at }), record({ scannedAt: at, safe: false })];
    expect(deriveVersionScanEvidence({ safetyStatus: 'CLEAN', records }).kind).toBe(
      'FORMAT_CHECKED',
    );
  });

  it('never shows a held or failed file as scanned, whatever its records say', () => {
    expect(
      deriveVersionScanEvidence({ safetyStatus: 'QUARANTINED', records: [record()] }).kind,
    ).toBe('HELD');
    expect(deriveVersionScanEvidence({ safetyStatus: 'FAILED', records: [record()] }).kind).toBe(
      'FAILED',
    );
  });

  it('reads a file still in the pipeline as waiting, checking or delayed', () => {
    expect(deriveVersionScanEvidence({ safetyStatus: 'PENDING', records: [] }).kind).toBe(
      'WAITING',
    );
    expect(deriveVersionScanEvidence({ safetyStatus: 'SCANNING', records: [] }).kind).toBe(
      'CHECKING',
    );
    expect(deriveVersionScanEvidence({ safetyStatus: null, records: [] }).kind).toBe('WAITING');
    const errored = record({ scanErrored: true, safe: false });
    expect(deriveVersionScanEvidence({ safetyStatus: 'SCANNING', records: [errored] }).kind).toBe(
      'DELAYED',
    );
  });
});

describe('loadVersionScanEvidence, from the real intake pipeline', () => {
  let db: Db;
  let seq = 0;
  let owner = { accountId: '', applicantId: '' };
  beforeEach(async () => {
    db = await freshDb();
  });

  async function seed() {
    seq += 1;
    const provisioned = await provisionAccount(db, { email: `scan${seq}@example.com` });
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
    owner = { accountId: account.id, applicantId: applicant.value.id };
    return { account, documentId: doc.value.id, applicantId: applicant.value.id };
  }

  // The traveller's own access proof, as the Documents page holds it.
  async function proofOf(who: { accountId: string; applicantId: string } = owner) {
    const gate = await requireAccess(
      db,
      accountPrincipal(who.accountId),
      'VIEW_METADATA',
      { applicantId: who.applicantId },
      { purpose: 'self' },
    );
    if (!gate.ok) throw new Error('proof');
    return gate.value;
  }

  async function version(documentId: string, accountId: string, key: string) {
    const added = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId,
      bucket: 'QUARANTINE',
      objectKey: key,
    });
    if (!isOk(added)) throw new Error('version');
    return added.value.version.id;
  }

  async function evidenceOf(versionId: string) {
    const rows = await db.select().from(schema.documentVersions);
    const row = rows.find((candidate) => candidate.id === versionId);
    if (!row) throw new Error('missing version');
    const result = await loadVersionScanEvidence(await proofOf(), [
      { id: row.id, safetyStatus: row.safetyStatus },
    ]);
    return { evidence: result.get(versionId), row };
  }

  it('structural checks only: the file is usable and reads as format checked, never scanned', async () => {
    const { account, documentId } = await seed();
    const id = await version(documentId, account.id, 'k-structural');
    await processIntake(db, scanner(STRUCTURAL), extractor, limits, { documentVersionId: id });
    const { evidence, row } = await evidenceOf(id);
    expect(row.safetyStatus).toBe('CLEAN');
    expect(evidence).toEqual({ kind: 'FORMAT_CHECKED', scannedAt: null });
    // The access gate is untouched by the reading: CLEAN and servable still means usable.
    expect(
      isDocumentVersionUsable({
        safetyStatus: row.safetyStatus,
        processingStatus: row.processingStatus,
        erased: false,
      }),
    ).toBe(true);
  });

  it('a real successful antivirus scan reads as virus scanned, with when and nothing internal', async () => {
    const { account, documentId } = await seed();
    const id = await version(documentId, account.id, 'k-av');
    await processIntake(db, scanner(ANTIVIRUS), extractor, limits, { documentVersionId: id });
    const { evidence } = await evidenceOf(id);
    expect(evidence?.kind).toBe('VIRUS_SCANNED');
    expect(Object.keys(evidence ?? {}).sort()).toEqual(['kind', 'scannedAt']);
    expect(Number.isNaN(Date.parse(evidence?.scannedAt ?? ''))).toBe(false);
  });

  it('a scan that errored reads as delayed, then as scanned once a retry really passes', async () => {
    const { account, documentId } = await seed();
    const id = await version(documentId, account.id, 'k-retry');
    let calls = 0;
    const flaky: MalwareScannerPort = {
      name: ANTIVIRUS,
      version: '1.0.0',
      async scan() {
        calls += 1;
        if (calls === 1) throw new Error('scanner down');
        return { safe: true };
      },
    };
    await expect(
      processIntake(db, flaky, extractor, limits, { documentVersionId: id }),
    ).rejects.toThrow();
    expect((await evidenceOf(id)).evidence?.kind).toBe('DELAYED');
    await processIntake(db, flaky, extractor, limits, { documentVersionId: id });
    expect((await evidenceOf(id)).evidence?.kind).toBe('VIRUS_SCANNED');
  });

  it('an unsafe verdict holds the file and is never shown as scanned', async () => {
    const { account, documentId } = await seed();
    const id = await version(documentId, account.id, 'k-unsafe');
    await processIntake(db, scanner(ANTIVIRUS, false), extractor, limits, {
      documentVersionId: id,
    });
    const { evidence, row } = await evidenceOf(id);
    expect(row.safetyStatus).toBe('QUARANTINED');
    expect(evidence?.kind).toBe('HELD');
  });

  it('judges each version on its own records: an old scan does not carry to a newer file, nor the reverse', async () => {
    const { account, documentId } = await seed();
    // Version 1 was scanned while the antivirus was on. Version 2 arrived after it was off.
    const first = await version(documentId, account.id, 'k-v1');
    await processIntake(db, scanner(ANTIVIRUS), extractor, limits, { documentVersionId: first });
    const second = await version(documentId, account.id, 'k-v2');
    await processIntake(db, scanner(STRUCTURAL), extractor, limits, { documentVersionId: second });
    const a = await evidenceOf(first);
    const b = await evidenceOf(second);
    expect(a.evidence?.kind).toBe('VIRUS_SCANNED');
    expect(b.evidence?.kind).toBe('FORMAT_CHECKED');
    // And a list read gives each its own answer in one call.
    const both = await loadVersionScanEvidence(await proofOf(), [
      { id: first, safetyStatus: a.row.safetyStatus },
      { id: second, safetyStatus: b.row.safetyStatus },
    ]);
    expect(both.get(first)?.kind).toBe('VIRUS_SCANNED');
    expect(both.get(second)?.kind).toBe('FORMAT_CHECKED');
  });

  it('falls back to the cautious reading, never to scanned, when the records cannot be read', async () => {
    await seed();
    const proof = await proofOf();
    vi.spyOn(proof.tx, 'transaction').mockRejectedValue(new Error('database unavailable'));
    const result = await loadVersionScanEvidence(proof, [{ id: 'v1', safetyStatus: 'CLEAN' }]);
    expect(result.get('v1')?.kind).toBe('FORMAT_CHECKED');
  });

  it("reads only the proof's own traveller: another traveller's scanned version gives no evidence", async () => {
    const { account, documentId } = await seed();
    const scanned = await version(documentId, account.id, 'k-own');
    await processIntake(db, scanner(ANTIVIRUS), extractor, limits, { documentVersionId: scanned });
    const mine = await evidenceOf(scanned);
    expect(mine.evidence?.kind).toBe('VIRUS_SCANNED');
    const stranger = await seed();
    const theirProof = await proofOf({
      accountId: stranger.account.id,
      applicantId: stranger.applicantId,
    });
    const theirs = await loadVersionScanEvidence(theirProof, [
      { id: scanned, safetyStatus: mine.row.safetyStatus },
    ]);
    expect(theirs.get(scanned)?.kind).toBe('FORMAT_CHECKED');
  });
});
