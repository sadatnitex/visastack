import type { MissingRequirement } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { caseListReadiness, caseRowProgress, caseRowProps } from './case-list-model';
import { nextStepFor } from './case-next-step';

const mission = {
  id: 'm1',
  title: 'Japan',
  state: 'INTAKE',
  destination: 'Japan',
  purpose: 'Tourism',
  packVersionId: 'p1',
};

describe('the next step on a row', () => {
  it('names the first required item still missing, with the verb that fits', () => {
    expect(
      nextStepFor([
        { kind: 'DOCUMENT', key: 'passport', optional: true, reason: 'not_provided' },
        { kind: 'DOCUMENT', key: 'bank_statement', optional: false, reason: 'not_provided' },
        { kind: 'FIELD', key: 'full_name', optional: false, reason: 'unresolved_conflict' },
      ]),
    ).toBe('Add Bank Statement');
    expect(
      nextStepFor([
        { kind: 'DOCUMENT', key: 'passport', optional: false, reason: 'stale_evidence' },
      ]),
    ).toMatch(/^Update /);
    expect(
      nextStepFor([
        { kind: 'FIELD', key: 'full_name', optional: false, reason: 'unresolved_conflict' },
      ]),
    ).toMatch(/^Fix /);
  });

  it('names every choice when any one of a group would do, never just the first', () => {
    const group = (keys: string[]): MissingRequirement => ({
      kind: 'DOCUMENT',
      key: keys[0] ?? '',
      optional: false,
      reason: 'not_provided',
      groupKey: 'identity',
      alternatives: keys.map((key) => ({ kind: 'DOCUMENT' as const, key })),
    });
    expect(nextStepFor([group(['passport', 'nid'])])).toBe('Add Passport or National ID');
    expect(nextStepFor([group(['passport', 'nid', 'cv', 'tin'])])).toBe(
      'Add Passport or National ID or Another',
    );
  });

  it('says nothing when nothing required is missing, or the list is not there', () => {
    expect(nextStepFor([])).toBeNull();
    expect(nextStepFor(undefined)).toBeNull();
    expect(
      nextStepFor([{ kind: 'DOCUMENT', key: 'passport', optional: true, reason: 'not_provided' }]),
    ).toBeNull();
  });
});

describe('what a row draws for a case', () => {
  const ready = { requiredCount: 8, satisfiedRequired: 6, nextStep: 'Add Passport' };

  it('counts required items ready of required items, as the progress ring does', () => {
    expect(caseRowProgress(mission, ready)).toEqual({ kind: 'counted', done: 6, total: 8 });
    expect(caseRowProgress(mission, { ...ready, requiredCount: 0 })).toEqual({
      kind: 'none-required',
    });
    expect(caseRowProgress(mission, undefined)).toEqual({ kind: 'unread' });
    expect(caseRowProgress({ packVersionId: null }, ready)).toEqual({ kind: 'no-checklist' });
  });

  it('carries the country code from the saved destination, and none for text that names no country', () => {
    expect(caseRowProps(mission, ready, false).iso2).toBe('JP');
    expect(caseRowProps({ ...mission, destination: 'Not sure yet' }, ready, false).iso2).toBeNull();
    expect(caseRowProps({ ...mission, destination: null }, ready, false).iso2).toBeNull();
  });

  it('gives the next step only with a count to go with it', () => {
    expect(caseRowProps(mission, ready, false).nextStep).toBe('Add Passport');
    expect(caseRowProps(mission, undefined, false).nextStep).toBeNull();
  });

  it('trims a full readiness to the counts and one step', () => {
    expect(
      caseListReadiness({
        requiredCount: 3,
        satisfiedRequired: 1,
        missing: [{ kind: 'DOCUMENT', key: 'passport', optional: false, reason: 'not_provided' }],
      }),
    ).toEqual({ requiredCount: 3, satisfiedRequired: 1, nextStep: 'Add Passport' });
    expect(caseListReadiness({ requiredCount: 3, satisfiedRequired: 1 }).nextStep).toBeNull();
  });

  it('links the whole row to the case', () => {
    expect(caseRowProps(mission, ready, false).href).toBe('/app/mission/m1');
  });
});
