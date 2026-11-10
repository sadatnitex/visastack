import { describe, expect, it } from 'vitest';
import { type GrantRowLineInput, grantRowLine } from './grant-row-line';

const base: GrantRowLineInput = {
  status: 'ACTIVE',
  actions: ['VIEW_METADATA', 'PREVIEW'],
  missionId: null,
  categories: null,
  documentIds: null,
  expiryAt: '2026-12-12T10:00:00.000Z',
  totalDocuments: 12,
  ended: false,
};

describe('the one line under a grant: what they receive and until when (friction F1)', () => {
  it('names the documents chosen out of all of them, then the end day', () => {
    expect(grantRowLine({ ...base, documentIds: ['a', 'b', 'c'] })).toBe(
      'Documents: 3 of 12. Ends 12 Dec 2026',
    );
  });

  it('says the whole profile and every document when nothing was narrowed', () => {
    expect(grantRowLine(base)).toBe('Profile: all. Documents: all 12. Ends 12 Dec 2026');
  });

  it('names one part of the profile and counts more than one', () => {
    expect(grantRowLine({ ...base, categories: ['medical'] })).toContain(
      'Profile: Medical treatment',
    );
    expect(grantRowLine({ ...base, categories: ['medical', 'business'] })).toContain(
      'Profile: 2 parts',
    );
    expect(grantRowLine({ ...base, categories: ['identity'] })).toContain(
      'Documents: in those parts',
    );
  });

  it('follows the access rules: without Preview no document is received, and a case grant shows no details yet', () => {
    expect(grantRowLine({ ...base, actions: ['VIEW_METADATA'] })).toBe(
      'Profile: all. Ends 12 Dec 2026',
    );
    expect(grantRowLine({ ...base, missionId: 'case-1' })).toBe('One case. Ends 12 Dec 2026');
    expect(grantRowLine({ ...base, actions: ['COMMENT'], documentIds: null })).toBe(
      'No profile details or documents. Ends 12 Dec 2026',
    );
  });

  it('does not count AI tools as something received', () => {
    expect(grantRowLine({ ...base, actions: ['VIEW_METADATA', 'AI_ASSIST'] })).toBe(
      'Profile: all. Ends 12 Dec 2026',
    );
  });

  it('says Ended for access that has run out or was revoked, never an end that is still ahead', () => {
    expect(grantRowLine({ ...base, ended: true, status: 'EXPIRED' })).toBe(
      'Profile: all. Documents: all 12. Ended 12 Dec 2026',
    );
    expect(grantRowLine({ ...base, status: 'REVOKED', ended: true })).toBe(
      'Profile: all. Documents: all 12. Ended',
    );
  });

  it('copes with an unreadable document list and with no end date', () => {
    expect(grantRowLine({ ...base, totalDocuments: null, expiryAt: null })).toBe(
      'Profile: all. Documents: all. No end date',
    );
    expect(grantRowLine({ ...base, totalDocuments: null, documentIds: ['a'] })).toContain(
      'Documents: 1.',
    );
  });
});
