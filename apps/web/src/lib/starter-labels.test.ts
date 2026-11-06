import { describe, expect, it } from 'vitest';
import { requirementLabel } from '../app/app/mission/[id]/case-model';
import { STARTER_BADGE, packBadge, packNoticeLine } from './pack-labels';

describe('how a starter list is named on a case', () => {
  it('is never badged as official, and says what it is in plain words', () => {
    expect(
      packBadge({ authoritative: false, ownerOrganizationId: null, key: 'starter.gb.tourist' }),
    ).toEqual({
      label: STARTER_BADGE,
      reviewed: false,
    });
    expect(STARTER_BADGE).toBe('Starter List, Not Official');
    expect(STARTER_BADGE.toLowerCase()).not.toContain('official requirement');
    // Official and an unreviewed non-starter pack keep the words they had.
    expect(
      packBadge({ authoritative: true, ownerOrganizationId: null, key: 'uk.tourist' }).label,
    ).toBe('Official Requirement Pack');
    expect(
      packBadge({ authoritative: false, ownerOrganizationId: null, key: 'test.pack' }).label,
    ).toBe('Not Reviewed');
    // An agency that happens to use the prefix is still the agency's own checklist.
    expect(
      packBadge({ authoritative: false, ownerOrganizationId: 'org', key: 'starter.gb.tourist' })
        .label,
    ).toBe('Agency Custom Checklist');
  });

  it('carries a notice that says it is not official and sends the person to the official guidance', () => {
    const line = packNoticeLine({ kind: 'STARTER' });
    expect(line).toContain('not official');
    expect(line).toContain('official guidance');
    expect(line).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("a starter item keeps the agency's own sentence", () => {
  it('shows the wording as written, and the document type name for any other item', () => {
    expect(
      requirementLabel({
        kind: 'DOCUMENT',
        key: 'BANK_STATEMENT',
        wording: 'Six months bank statement and solvency letter.',
      }),
    ).toBe('Six months bank statement and solvency letter.');
    expect(requirementLabel({ kind: 'DOCUMENT', key: 'BANK_STATEMENT' })).toBe('Bank Statement');
  });
});
