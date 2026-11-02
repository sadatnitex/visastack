import { describe, expect, it } from 'vitest';
import type { CollectionItem } from './umpe-collection-request-items';
import {
  type DocumentLike,
  MAX_CHOICES_PER_ITEM,
  RESPONSE_CONSENT_TEXT,
  type ServableVersionLike,
  documentKey,
  factKey,
  linesFromSelections,
  proposeEvidence,
  responseContentSha256,
} from './umpe-collection-response-evidence';

/** Synthetic data only. The plain rules of a traveller's answer (UMPE P7). */

const NOW = new Date('2027-01-10T00:00:00Z');

function item(overrides: Partial<CollectionItem>): CollectionItem {
  return {
    id: 'item-1',
    label: 'Passport',
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'passport',
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
    groupKey: null,
    note: null,
    order: 0,
    source: 'req-1',
    citation: 'Synthetic rule',
    ...overrides,
  };
}

function doc(id: string, overrides: Partial<DocumentLike> = {}): DocumentLike {
  return {
    id,
    docType: 'passport',
    title: `Document ${id}`,
    expiresAt: null,
    supersededByDocumentId: null,
    ...overrides,
  };
}

function version(id: string, documentId: string, versionNumber = 1): ServableVersionLike {
  return { id, documentId, versionNumber, createdAt: new Date(NOW.getTime() - versionNumber) };
}

describe('proposing evidence', () => {
  it('proposes only a current copy of the right type, newest version only, never an expired or replaced one', () => {
    const [proposal] = proposeEvidence(
      [item({})],
      [
        doc('old', { supersededByDocumentId: 'new' }),
        doc('expired', { expiresAt: new Date('2026-12-31T00:00:00Z') }),
        doc('new'),
        doc('letter', { docType: 'bank_statement' }),
      ],
      [
        version('old-v1', 'old'),
        version('expired-v1', 'expired'),
        version('new-v1', 'new', 1),
        version('new-v2', 'new', 2),
        version('letter-v1', 'letter'),
      ],
      [],
      NOW,
    );
    expect(proposal?.proposedKey).toBe(documentKey('new-v2'));
    const keys = proposal?.candidates.map((c) => c.key);
    expect(keys).not.toContain(documentKey('new-v1'));
    expect(proposal?.candidates.map((c) => c.label)).toEqual([
      'Current Copy',
      'Expired Copy',
      'Replaced Copy',
      'Current Copy',
    ]);
    // Another type is offered after the matches, never proposed.
    expect(proposal?.candidates.at(-1)).toMatchObject({
      key: documentKey('letter-v1'),
      matches: false,
    });
  });

  it('proposes nothing when no current copy matches, and nothing at all for a document with no servable version', () => {
    const [proposal] = proposeEvidence(
      [item({})],
      [doc('expired', { expiresAt: NOW }), doc('scanning')],
      [version('expired-v1', 'expired')],
      [],
      NOW,
    );
    expect(proposal?.proposedKey).toBeNull();
    expect(proposal?.candidates.map((c) => c.key)).toEqual([documentKey('expired-v1')]);
  });

  it("an agency's own item with no type offers every document and proposes none", () => {
    const [proposal] = proposeEvidence(
      [item({ docType: null, provenance: 'AGENCY_ADDED', source: 'agency' })],
      [doc('a'), doc('b', { docType: 'bank_statement' })],
      [version('a-v1', 'a'), version('b-v1', 'b')],
      [],
      NOW,
    );
    expect(proposal?.proposedKey).toBeNull();
    expect(proposal?.candidates).toHaveLength(2);
  });

  it('a detail item offers that field only, newest first', () => {
    const [proposal] = proposeEvidence(
      [item({ kind: 'FIELD', docType: null, fieldKey: 'passport.number' })],
      [],
      [],
      [
        {
          factId: 'f1',
          factVersionId: 'f1-v1',
          fieldKey: 'passport.number',
          repeatingRecordKey: null,
          display: 'A1',
          savedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          factId: 'f2',
          factVersionId: 'f2-v3',
          fieldKey: 'passport.number',
          repeatingRecordKey: 'second',
          display: 'B2',
          savedAt: new Date('2026-06-01T00:00:00Z'),
        },
        {
          factId: 'f3',
          factVersionId: 'f3-v1',
          fieldKey: 'full_name',
          repeatingRecordKey: null,
          display: 'Name',
          savedAt: NOW,
        },
      ],
      NOW,
    );
    expect(proposal?.candidates.map((c) => c.key)).toEqual([factKey('f2-v3'), factKey('f1-v1')]);
    expect(proposal?.proposedKey).toBe(factKey('f2-v3'));
  });
});

describe('turning choices into lines', () => {
  const proposals = proposeEvidence(
    [item({ id: 'p' }), item({ id: 's', docType: 'bank_statement', label: 'Statement' })],
    [doc('a'), doc('b', { docType: 'bank_statement' })],
    [version('a-v1', 'a'), version('b-v1', 'b')],
    [],
    NOW,
  );

  it('makes exact lines and a Still Missing line for every empty item', () => {
    const made = linesFromSelections(proposals, { p: [documentKey('a-v1')] });
    expect(made).toEqual({
      ok: true,
      lines: [
        { itemId: 'p', kind: 'DOCUMENT', documentId: 'a', documentVersionId: 'a-v1' },
        { itemId: 's', kind: 'MISSING' },
      ],
    });
  });

  it('refuses a key that was not offered, an unknown item and too many choices', () => {
    expect(linesFromSelections(proposals, { p: [documentKey('elsewhere')] })).toEqual({
      ok: false,
      problem: 'not_offered',
    });
    expect(linesFromSelections(proposals, { nope: [] })).toEqual({
      ok: false,
      problem: 'unknown_item',
    });
    const many = Array.from({ length: MAX_CHOICES_PER_ITEM + 1 }, (_, i) => documentKey(`x${i}`));
    expect(linesFromSelections(proposals, { p: many })).toEqual({ ok: false, problem: 'too_many' });
  });

  it('the content fingerprint ignores line order and changes with any line', () => {
    const base = {
      requestId: 'r',
      revisionId: 'v',
      applicantId: 'a',
      consentVersion: 'c',
    };
    const one = { itemId: 'p', kind: 'MISSING' } as const;
    const two = { itemId: 's', kind: 'MISSING' } as const;
    expect(responseContentSha256({ ...base, lines: [one, two] })).toBe(
      responseContentSha256({ ...base, lines: [two, one] }),
    );
    expect(responseContentSha256({ ...base, lines: [one] })).not.toBe(
      responseContentSha256({ ...base, lines: [one, two] }),
    );
  });

  it('the consent wording is plain and has no long dash', () => {
    expect(RESPONSE_CONSENT_TEXT).not.toContain(String.fromCodePoint(0x2014));
    expect(RESPONSE_CONSENT_TEXT).toMatch(/withdraw/);
  });
});
