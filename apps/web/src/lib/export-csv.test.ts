import type { AccountExport } from '@visastack/services';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildExportZip } from './export-csv';

function fixture(overrides: Partial<AccountExport> = {}): AccountExport {
  const base = {
    account: { id: 'acct_1', email: 'traveller@example.com' },
    consents: { CORE_PROCESSING: true },
    consentHistory: [{ id: 'cr_1', type: 'CORE_PROCESSING', granted: true }],
    memberships: [],
    assignments: [],
    grantsReceived: [],
    missionNotesAuthored: [],
    productEvents: [],
    applicants: [],
    auditEvents: [],
    exportedAt: '2026-01-01T00:00:00.000Z',
    manifest: {
      counts: {
        applicants: 0,
        facts: 0,
        factVersions: 0,
        documents: 0,
        documentVersions: 0,
        missions: 0,
        missionSnapshots: 0,
        grantsReceived: 0,
        grantsGranted: 0,
        evidenceRequests: 0,
        aiExtractionRuns: 0,
        auditEvents: 0,
        productEvents: 0,
        consentHistoryEntries: 1,
      },
      excludedByDesign: [{ item: 'x', reason: 'y' }],
      knownGaps: [{ item: 'original document bytes', reason: 'y' }],
    },
  };
  return { ...base, ...overrides } as unknown as AccountExport;
}

describe('buildExportZip (PRV-04, Part 7 §14: "readable JSON/CSV metadata")', () => {
  it('bundles the manifest and every non-empty CSV table into a ZIP', async () => {
    const bytes = await buildExportZip(fixture());
    const zip = await JSZip.loadAsync(bytes);

    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['account.csv', 'consent_history.csv', 'consents.csv', 'manifest.json']);

    const manifestJson = await zip.file('manifest.json')?.async('string');
    expect(JSON.parse(manifestJson ?? '{}')).toMatchObject({
      knownGaps: [{ item: 'original document bytes' }],
    });

    const accountCsv = await zip.file('account.csv')?.async('string');
    expect(accountCsv).toContain('acct_1');
  });

  it('omits a table entirely when it has zero rows, rather than writing an empty file', async () => {
    const bytes = await buildExportZip(fixture());
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('applicants.csv')).toBeNull();
    expect(zip.file('audit_events.csv')).toBeNull();
  });

  it('only ever writes fixed, literal entry names -- never a path derived from account data', async () => {
    const bytes = await buildExportZip(
      fixture({ account: { id: '../../etc/passwd' } as unknown as AccountExport['account'] }),
    );
    const zip = await JSZip.loadAsync(bytes);
    for (const name of Object.keys(zip.files)) {
      expect(name).not.toContain('..');
      expect(name).not.toContain('/');
    }
  });
});
