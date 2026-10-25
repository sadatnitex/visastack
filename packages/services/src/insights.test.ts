import { describe, expect, it } from 'vitest';
import {
  type InsightCaseInput,
  type InsightDocumentInput,
  type InsightFactInput,
  type InsightsInput,
  buildTravellerInsights,
} from './insights';

const NOW = new Date('2026-10-25T12:00:00Z');
const LADDER = [90, 60, 30, 7, 0];

function doc(id: string, docType: string | null, extra: Partial<InsightDocumentInput> = {}) {
  return {
    id,
    docType,
    expiresAt: null,
    lifecycle: 'UNKNOWN',
    safetyStatus: 'CLEAN',
    createdAt: `2026-01-0${id.length % 9}T00:00:00Z`,
    reminderThresholds: LADDER,
    ...extra,
  } satisfies InsightDocumentInput;
}

function fact(fieldKey: string, value: string, extra: Partial<InsightFactInput> = {}) {
  return {
    fieldKey,
    repeatingRecordKey: null,
    status: 'APPLICANT_CONFIRMED',
    isProtected: false,
    value,
    comparable: true,
    sourceDocumentId: null,
    ...extra,
  } satisfies InsightFactInput;
}

function input(overrides: Partial<InsightsInput> = {}): InsightsInput {
  return {
    documents: [],
    facts: [],
    pendingReadings: [],
    pendingCheckDocumentIds: [],
    sections: { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
    cases: [],
    now: NOW,
    ...overrides,
  };
}

describe('traveller insights: naming documents', () => {
  it('names each document by its catalogue kind, numbered within the kind, never by free text', () => {
    const result = buildTravellerInsights(
      input({
        documents: [
          doc('p1', 'PASSPORT', { createdAt: '2026-01-01T00:00:00Z' }),
          doc('p2', 'passport bio page', { createdAt: '2026-02-01T00:00:00Z' }),
          doc('x1', 'Ayesha Rahman private papers'),
          doc('e1', 'EMPLOYMENT_LETTER'),
        ],
      }),
    );
    const refs = new Map(result.evidence.map((entry) => [entry.document.id, entry.document]));
    expect(refs.get('p1')).toMatchObject({ kind: 'PASSPORT', ordinal: 1, ofKind: 2 });
    expect(refs.get('p2')).toMatchObject({ kind: 'PASSPORT', ordinal: 2, ofKind: 2 });
    // A kind the catalogue does not know is not passed on, and counts as restricted.
    expect(refs.get('x1')).toMatchObject({ kind: null, restricted: true });
    expect(refs.get('e1')).toMatchObject({ kind: 'EMPLOYMENT_CERTIFICATE', restricted: false });
    expect(JSON.stringify(result)).not.toContain('Ayesha');
  });
});

describe('traveller insights: evidence map', () => {
  it('lists the saved details each document backs, and only sections for a restricted one', () => {
    const result = buildTravellerInsights(
      input({
        documents: [doc('pass', 'PASSPORT'), doc('job', 'EMPLOYMENT_CERTIFICATE')],
        facts: [
          fact('given_name', 'Ayesha', { status: 'DOCUMENT_SUPPORTED', sourceDocumentId: 'pass' }),
          fact('date_of_birth', '1990-01-05', {
            status: 'DOCUMENT_SUPPORTED',
            sourceDocumentId: 'pass',
          }),
          fact('job_title', 'Engineer', { status: 'DOCUMENT_SUPPORTED', sourceDocumentId: 'job' }),
          // Not confirmed, so it is not counted as backed.
          fact('current_employer', 'Acme', { status: 'CONFLICTED', sourceDocumentId: 'job' }),
        ],
      }),
    );
    const passport = result.evidence.find((entry) => entry.document.id === 'pass');
    const job = result.evidence.find((entry) => entry.document.id === 'job');
    expect(passport).toMatchObject({ backedCount: 2, backedFieldKeys: [] });
    expect(passport?.backedSections.map((s) => s.key)).toEqual(['identity_basics']);
    expect(passport?.document.restricted).toBe(true);
    expect(job).toMatchObject({ backedCount: 1, backedFieldKeys: ['job_title'] });
    expect(job?.canBackSections.map((s) => s.key)).toContain('employment');
  });

  it('only offers sections that are open on the profile', () => {
    const closed = buildTravellerInsights(input({ documents: [doc('ins', 'TRAVEL_INSURANCE')] }));
    expect(closed.evidence[0]?.canBackSections).toEqual([]);
    const opened = buildTravellerInsights(
      input({
        documents: [doc('ins', 'TRAVEL_INSURANCE')],
        sections: {
          activated: new Set(['travel_insurance']),
          notApplicable: new Set(),
          noneDeclared: new Set(),
        },
      }),
    );
    expect(opened.evidence[0]?.canBackSections.map((s) => s.key)).toEqual(['travel_insurance']);
  });
});

describe('traveller insights: mismatches', () => {
  it('reports a saved conflict and a differing reading, and nothing for an equal one', () => {
    const result = buildTravellerInsights(
      input({
        documents: [doc('pass', 'PASSPORT'), doc('job', 'EMPLOYMENT_CERTIFICATE')],
        facts: [
          fact('given_name', 'Ayesha'),
          fact('family_name', 'Rahman'),
          fact('current_employer', 'Acme', { status: 'CONFLICTED', sourceDocumentId: 'job' }),
        ],
        pendingReadings: [
          { documentId: 'pass', fieldKey: 'given_name', value: 'Aysha' },
          { documentId: 'pass', fieldKey: 'family_name', value: 'Rahman' },
          // Nothing confirmed to compare with.
          { documentId: 'pass', fieldKey: 'nationality', value: 'Bangladeshi' },
        ],
      }),
    );
    expect(
      result.mismatches.map(({ source, fieldKey, document, section }) => ({
        source,
        fieldKey,
        documentId: document?.id ?? null,
        section: section?.key ?? null,
      })),
    ).toEqual([
      {
        source: 'saved_conflict',
        fieldKey: 'current_employer',
        documentId: 'job',
        section: 'employment',
      },
      // The passport is restricted: its detail is named by section only.
      {
        source: 'pending_reading',
        fieldKey: null,
        documentId: 'pass',
        section: 'identity_basics',
      },
    ]);
    expect(result.summary).toMatchObject({ mismatches: 2, toCheck: 2 });
    // List keys name nothing.
    expect(result.mismatches.map((m) => m.key)).toEqual(['m1', 'm2']);
  });

  it('names a saved conflict by section only when its passport was replaced or its source is unknown', () => {
    const result = buildTravellerInsights(
      input({
        documents: [
          doc('old-pass', 'PASSPORT', { lifecycle: 'SUPERSEDED' }),
          doc('job', 'EMPLOYMENT_CERTIFICATE'),
        ],
        facts: [
          // Read from a passport that has since been replaced.
          fact('passport_number', 'BX7319046', {
            status: 'CONFLICTED',
            sourceDocumentId: 'old-pass',
          }),
          // Read from a document not among the traveller's own (hidden from the wallet).
          fact('date_of_birth', '1987-03-14', { status: 'CONFLICTED', sourceDocumentId: 'hidden' }),
          // No source recorded at all.
          fact('family_name', 'Rahman', { status: 'CONFLICTED' }),
          // An everyday document still names its detail.
          fact('job_title', 'Engineer', { status: 'CONFLICTED', sourceDocumentId: 'job' }),
        ],
      }),
    );
    expect(
      result.mismatches.map((m) => [m.fieldKey, m.section?.key, m.document?.id ?? null]),
    ).toEqual([
      [null, 'passport', null],
      [null, 'identity_basics', null],
      [null, 'identity_basics', null],
      ['job_title', 'employment', 'job'],
    ]);
  });

  it('names the detail for an everyday document', () => {
    const result = buildTravellerInsights(
      input({
        documents: [doc('job', 'EMPLOYMENT_CERTIFICATE')],
        facts: [fact('job_title', 'Engineer')],
        pendingReadings: [{ documentId: 'job', fieldKey: 'job_title', value: 'Manager' }],
      }),
    );
    expect(result.mismatches).toEqual([
      expect.objectContaining({ fieldKey: 'job_title', source: 'pending_reading' }),
    ]);
  });

  it('leaves out readings and check notes waiting on a replaced document', () => {
    const result = buildTravellerInsights(
      input({
        documents: [
          doc('old', 'PASSPORT', { lifecycle: 'SUPERSEDED', createdAt: '2025-01-01T00:00:00Z' }),
          doc('new', 'PASSPORT', { createdAt: '2026-01-01T00:00:00Z' }),
        ],
        facts: [fact('given_name', 'Ayesha')],
        pendingReadings: [{ documentId: 'old', fieldKey: 'given_name', value: 'Aysha' }],
        pendingCheckDocumentIds: ['old'],
      }),
    );
    expect(result.mismatches).toEqual([]);
    expect(result.checksToReview).toEqual([]);
    expect(result.summary.toCheck).toBe(0);
    // Numbering counts current documents only: never "2 of 2" without "1 of 2".
    expect(result.evidence.map((e) => e.document)).toEqual([
      expect.objectContaining({ id: 'new', ordinal: 1, ofKind: 1 }),
    ]);
  });

  it('never claims a difference it could not check, and ignores one record among several', () => {
    const result = buildTravellerInsights(
      input({
        documents: [doc('pass', 'PASSPORT')],
        facts: [
          fact('passport_number', '[protected]', { isProtected: true, comparable: false }),
          fact('address_city', 'Dhaka', { repeatingRecordKey: 'home' }),
        ],
        pendingReadings: [
          { documentId: 'pass', fieldKey: 'passport_number', value: 'A1234567' },
          { documentId: 'pass', fieldKey: 'address_city', value: 'Sylhet' },
        ],
      }),
    );
    expect(result.mismatches).toEqual([]);
    expect(result.notCompared).toBe(1);
  });

  it('counts the document check notes per document', () => {
    const result = buildTravellerInsights(
      input({
        documents: [doc('pass', 'PASSPORT')],
        pendingCheckDocumentIds: ['pass', 'pass', 'gone'],
      }),
    );
    expect(result.checksToReview).toEqual([
      { document: expect.objectContaining({ id: 'pass' }), count: 2 },
    ]);
    // The tile counts the rows the card lists.
    expect(result.summary.toCheck).toBe(1);
  });
});

describe('traveller insights: coverage', () => {
  it('marks an open section covered only by a usable document of a kind that backs it', () => {
    const usable = buildTravellerInsights(
      input({ documents: [doc('job', 'EMPLOYMENT_CERTIFICATE', { lifecycle: 'CURRENT' })] }),
    );
    const employment = usable.coverage.sections.find((s) => s.key === 'employment');
    expect(employment?.covered).toBe(true);
    expect(employment?.kinds.find((k) => k.kind === 'EMPLOYMENT_CERTIFICATE')).toEqual({
      kind: 'EMPLOYMENT_CERTIFICATE',
      onFile: 1,
      original: true,
    });
    expect(usable.coverage.covered + usable.coverage.missing).toBe(usable.coverage.sections.length);

    for (const unusable of [
      doc('job', 'EMPLOYMENT_CERTIFICATE', { lifecycle: 'EXPIRED' }),
      doc('job', 'EMPLOYMENT_CERTIFICATE', { lifecycle: 'SUPERSEDED' }),
      doc('job', 'EMPLOYMENT_CERTIFICATE', { safetyStatus: 'QUARANTINED' }),
      doc('job', 'EMPLOYMENT_CERTIFICATE', { safetyStatus: null }),
    ]) {
      const result = buildTravellerInsights(input({ documents: [unusable] }));
      expect(result.coverage.sections.find((s) => s.key === 'employment')?.covered).toBe(false);
    }
  });

  it('leaves closed sections out', () => {
    const result = buildTravellerInsights(input());
    expect(result.coverage.sections.some((s) => s.key === 'travel_insurance')).toBe(false);
    expect(result.summary.sectionsWithoutDocument).toBe(result.coverage.missing);
  });
});

describe('traveller insights: expiry timeline', () => {
  it('orders by time left, expired first, and leaves out replaced documents', () => {
    const result = buildTravellerInsights(
      input({
        documents: [
          doc('later', 'PASSPORT', { expiresAt: '2028-01-01T00:00:00.000Z' }),
          doc('soon', 'TRAVEL_INSURANCE', { expiresAt: '2026-11-04T12:00:00.000Z' }),
          doc('gone', 'PASSPORT', { expiresAt: '2026-10-01T12:00:00.000Z' }),
          doc('old', 'PASSPORT', {
            expiresAt: '2026-10-30T12:00:00.000Z',
            lifecycle: 'SUPERSEDED',
          }),
          doc('none', 'EMPLOYMENT_CERTIFICATE'),
        ],
      }),
    );
    expect(result.expiry.map((e) => [e.document.id, e.daysRemaining, e.urgency])).toEqual([
      ['gone', -24, 'expired'],
      ['soon', 10, 'reminder'],
      ['later', 433, 'ok'],
    ]);
    expect(result.summary).toMatchObject({ expired: 1, expiringSoon: 1 });
  });

  it('shows a document the wallet already counts expired as expired, never "today" and never -0', () => {
    const result = buildTravellerInsights(
      input({
        documents: [
          // Ran out three hours ago: still "0 days" by the reminder ladder's rounding.
          doc('gone', 'PASSPORT', { expiresAt: '2026-10-25T09:00:00.000Z', lifecycle: 'EXPIRED' }),
        ],
      }),
    );
    const [entry] = result.expiry;
    expect(entry).toMatchObject({ urgency: 'expired', daysRemaining: 0 });
    expect(Object.is(entry?.daysRemaining, -0)).toBe(false);
    expect(result.summary).toMatchObject({ expired: 1, expiringSoon: 0 });
  });
});

describe('traveller insights: originals and readiness', () => {
  const cases: InsightCaseInput[] = [
    {
      id: 'c1',
      title: 'UK Visit',
      hasChecklist: true,
      readiness: {
        overallState: 'NEEDS_ACTION',
        requiredCount: 4,
        satisfiedRequired: 1,
        requirementResults: [
          { kind: 'DOCUMENT', key: 'passport', optional: false, state: 'SATISFIED' },
          // On file, but too old for this route: the case says so, and so does this list.
          { kind: 'DOCUMENT', key: 'EMPLOYMENT_LETTER', optional: false, state: 'EXPIRING_STALE' },
          { kind: 'DOCUMENT', key: 'BANK_STATEMENT', optional: true, state: 'ATTENTION' },
          { kind: 'DOCUMENT', key: 'BANK_STATEMENT', optional: false, state: 'CRITICAL_GAP' },
          { kind: 'DOCUMENT', key: 'BIRTH_CERTIFICATE', optional: false, state: 'NOT_APPLICABLE' },
          { kind: 'DOCUMENT', key: 'TRAVEL_INSURANCE', optional: false, state: 'CRITICAL_GAP' },
          { kind: 'FIELD', key: 'given_name', optional: false, state: 'SATISFIED' },
        ],
      },
    },
    { id: 'c2', title: 'Schengen Trip', hasChecklist: false, readiness: null },
    { id: 'c3', title: 'Study Visa', hasChecklist: true, readiness: null },
  ];

  it('lists the kinds a case needs as originals, with whether one is on file', () => {
    const result = buildTravellerInsights(
      input({
        documents: [
          doc('pass', 'PASSPORT', { lifecycle: 'CURRENT' }),
          doc('job', 'EMPLOYMENT_CERTIFICATE', { lifecycle: 'CURRENT' }),
        ],
        cases,
      }),
    );
    expect(result.originals.cases).toEqual([
      {
        caseId: 'c1',
        title: 'UK Visit',
        unavailable: false,
        items: [
          { kind: 'PASSPORT', optional: false, state: 'SATISFIED' },
          { kind: 'EMPLOYMENT_CERTIFICATE', optional: false, state: 'EXPIRING_STALE' },
          { kind: 'BANK_STATEMENT', optional: false, state: 'CRITICAL_GAP' },
        ],
      },
      // A checklist that could not be read says so, rather than listing nothing.
      { caseId: 'c3', title: 'Study Visa', unavailable: true, items: [] },
    ]);
    expect(result.originals.onFile.map((ref) => ref.id)).toEqual(['job', 'pass']);
  });

  it('passes each case readiness through unchanged, and says when there is no checklist', () => {
    const result = buildTravellerInsights(input({ cases }));
    expect(result.cases).toEqual([
      {
        caseId: 'c1',
        title: 'UK Visit',
        state: 'NEEDS_ACTION',
        requiredCount: 4,
        satisfiedRequired: 1,
      },
      {
        caseId: 'c2',
        title: 'Schengen Trip',
        state: 'NO_CHECKLIST',
        requiredCount: 0,
        satisfiedRequired: 0,
      },
      // A checklist exists but its readiness could not be read: never "no checklist".
      {
        caseId: 'c3',
        title: 'Study Visa',
        state: 'UNAVAILABLE',
        requiredCount: 0,
        satisfiedRequired: 0,
      },
    ]);
  });
});

describe('traveller insights: privacy', () => {
  it('never carries a saved or read value, however the details are arranged', () => {
    const PASSPORT_NUMBER = 'BX7319046';
    const DATE_OF_BIRTH = '1987-03-14';
    const result = buildTravellerInsights(
      input({
        documents: [
          doc('pass', 'PASSPORT', { expiresAt: '2030-05-01T00:00:00.000Z' }),
          doc('job', 'EMPLOYMENT_CERTIFICATE'),
        ],
        facts: [
          fact('passport_number', PASSPORT_NUMBER, {
            status: 'DOCUMENT_SUPPORTED',
            sourceDocumentId: 'pass',
            isProtected: true,
          }),
          fact('date_of_birth', DATE_OF_BIRTH, { status: 'CONFLICTED', sourceDocumentId: 'pass' }),
          fact('given_name', 'Nusrat'),
        ],
        pendingReadings: [
          { documentId: 'pass', fieldKey: 'passport_number', value: 'BX7319047' },
          { documentId: 'pass', fieldKey: 'date_of_birth', value: '1987-03-15' },
          { documentId: 'pass', fieldKey: 'given_name', value: 'Nusrath' },
        ],
      }),
    );
    expect(result.mismatches.length).toBeGreaterThan(0);
    const text = JSON.stringify(result);
    for (const secret of [
      PASSPORT_NUMBER,
      'BX7319047',
      DATE_OF_BIRTH,
      '1987-03-15',
      '1987',
      'Nusrat',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
