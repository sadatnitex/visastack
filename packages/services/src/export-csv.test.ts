import { describe, expect, it } from 'vitest';
import type { AccountExport } from './export';
import { buildExportCsvTables, rowsToCsv } from './export-csv';

describe('rowsToCsv (PRV-04, Part 7 §14: "readable JSON/CSV metadata")', () => {
  it('returns an empty string for no rows', () => {
    expect(rowsToCsv([])).toBe('');
  });

  it('renders a header row from the first row’s own keys, then one line per row', () => {
    const csv = rowsToCsv([
      { id: 'a1', name: 'Alice', age: 30 },
      { id: 'a2', name: 'Bob', age: 25 },
    ]);
    expect(csv).toBe('id,name,age\r\na1,Alice,30\r\na2,Bob,25');
  });

  it('quotes and escapes a field containing a comma', () => {
    expect(rowsToCsv([{ note: 'Dhaka, Bangladesh' }])).toBe('note\r\n"Dhaka, Bangladesh"');
  });

  it('quotes a field containing a newline and doubles embedded quotes', () => {
    const csv = rowsToCsv([{ note: 'line one\nline "two"' }]);
    expect(csv).toBe('note\r\n"line one\nline ""two"""');
  });

  it('renders null and undefined as empty fields, never the literal string', () => {
    const csv = rowsToCsv([{ a: null, b: undefined, c: 'x' }]);
    expect(csv).toBe('a,b,c\r\n,,x');
  });

  it('renders a Date as its ISO string', () => {
    const when = new Date('2026-01-15T10:00:00.000Z');
    expect(rowsToCsv([{ createdAt: when }])).toBe('createdAt\r\n2026-01-15T10:00:00.000Z');
  });

  it('renders a boolean and falls back to JSON for a nested object', () => {
    const csv = rowsToCsv([{ active: true, meta: { k: 'v' } }]);
    expect(csv).toBe('active,meta\r\ntrue,"{""k"":""v""}"');
  });
});

describe('reference codes in the account export tables (ADR 0018)', () => {
  const data = {
    account: { id: 'acct' },
    consents: {},
    consentHistory: [],
    memberships: [],
    assignments: [],
    grantsReceived: [],
    missionNotesAuthored: [],
    productEvents: [],
    auditEvents: [],
    applicants: [
      {
        applicant: { id: 'a1', displayName: 'R' },
        facts: [],
        documents: [
          { document: { id: 'd1' }, versions: [], nameVersions: [], scanResults: [] },
          { document: { id: 'd2' }, versions: [], nameVersions: [], scanResults: [] },
        ],
        missions: [{ mission: { id: 'm1' }, snapshots: [], tasks: [], aiTaskOrigins: [] }],
        grantsGranted: [],
        evidenceRequests: [{ id: 'r1' }],
        aiRuns: [],
        aiDrafts: [],
        aiConnections: [],
      },
    ],
  } as unknown as AccountExport;
  const csvOf = (tables: ReturnType<typeof buildExportCsvTables>, name: string) =>
    tables.find((t) => t.name === name)?.csv ?? '';

  it('adds a reference column to people, documents, cases and requests, empty where a record has no code', () => {
    const tables = buildExportCsvTables(data, {
      P: new Map([['a1', 'P-7K2Q9M']]),
      D: new Map([['d1', 'D-7K2Q9M']]),
      C: new Map([['m1', 'C-7K2Q9M']]),
      R: new Map([['r1', 'R-7K2Q9M']]),
    });
    expect(csvOf(tables, 'applicants.csv')).toContain('reference_code');
    expect(csvOf(tables, 'applicants.csv')).toContain('P-7K2Q9M');
    const documents = csvOf(tables, 'documents.csv').split(/\r?\n/);
    expect(documents[0]).toBe('id,reference_code');
    expect(documents[1]).toBe('d1,D-7K2Q9M');
    expect(documents[2]).toBe('d2,');
    expect(csvOf(tables, 'missions.csv')).toContain('C-7K2Q9M');
    expect(csvOf(tables, 'evidence_requests.csv')).toContain('R-7K2Q9M');
  });

  it('leaves the tables exactly as before without codes (before migration 0091)', () => {
    const tables = buildExportCsvTables(data);
    for (const name of [
      'applicants.csv',
      'documents.csv',
      'missions.csv',
      'evidence_requests.csv',
    ]) {
      expect(csvOf(tables, name)).not.toContain('reference_code');
    }
  });
});
