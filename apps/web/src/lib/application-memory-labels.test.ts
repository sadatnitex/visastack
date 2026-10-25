import { CONSISTENCY_RESULTS } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import {
  CASE_FIELD_LABELS,
  FACT_STATUS_LABELS,
  RESULT_NEXT_STEPS,
  RESULT_TONES,
  changeLine,
  comparableVersionId,
  compareHref,
  eventLine,
  reviewSentence,
} from './application-memory-labels';

const SNAP = '11111111-1111-4111-8111-111111111111';
const PRIOR = '22222222-2222-4222-8222-222222222222';
const CURRENT = '33333333-3333-4333-8333-333333333333';

describe('Application Memory wording (WP-V3 part 3)', () => {
  it('names a change without a value and links only a detail with both versions', () => {
    const changed = {
      kind: 'detail' as const,
      change: 'changed' as const,
      fieldKey: 'employer_name',
      repeatingRecordKey: null,
      factId: 'f1',
      priorFactVersionId: PRIOR,
      currentFactVersionId: CURRENT,
    };
    expect(changeLine(changed).what).toBe('changed');
    expect(comparableVersionId(changed)).toBe(PRIOR);
    expect(
      comparableVersionId({ ...changed, change: 'added', priorFactVersionId: null }),
    ).toBeNull();
    expect(
      comparableVersionId({ ...changed, change: 'removed', currentFactVersionId: null }),
    ).toBeNull();
    expect(
      changeLine({ kind: 'document', change: 'new_version', documentId: 'd', docType: null }),
    ).toEqual({ name: 'Document without a kind', what: 'new version added' });
    expect(changeLine({ kind: 'case', change: 'changed', caseField: 'travelStartDate' })).toEqual({
      name: 'Travel start date',
      what: 'changed',
    });
  });

  it('keeps prepared, confirmed and reported as submitted distinct, and never claims a submission', () => {
    const prepared = eventLine({
      kind: 'prepared',
      at: '2026-10-01T10:00:00.000Z',
      snapshotId: SNAP,
      snapshotVersion: 2,
    });
    const confirmed = eventLine({
      kind: 'confirmed',
      at: '2026-10-02T10:00:00.000Z',
      snapshotId: SNAP,
      snapshotVersion: 2,
      setAsideAt: '2026-10-05T10:00:00.000Z',
    });
    const reported = eventLine({
      kind: 'reported_submitted',
      at: '2026-10-03T00:00:00.000Z',
      recordedAt: '2026-10-04T10:00:00.000Z',
      snapshotId: SNAP,
      snapshotVersion: 2,
      channel: 'EMAIL',
    });
    expect(prepared.title).toBe('Snapshot 2 prepared');
    expect(confirmed.title).toBe('Confirmed snapshot 2');
    expect(confirmed.note).toContain('Set aside on');
    expect(confirmed.note).toContain('The snapshot itself is unchanged.');
    expect(reported.title).toBe('Reported as submitted by email, using snapshot 2');
    expect(reported.note).toContain('VisaStack does not submit applications.');
    const titles = new Set([prepared.title, confirmed.title, reported.title]);
    expect(titles.size).toBe(3);
  });

  it('says where the review stands without letting a confirmation settle a result', () => {
    expect(
      reviewSentence(1, { confirmedAt: null, setAsideAt: null, laterConfirmation: null }),
    ).toBe('Snapshot 1 was not confirmed.');
    const setAside = reviewSentence(1, {
      confirmedAt: '2026-10-01T10:00:00.000Z',
      setAsideAt: '2026-10-03T10:00:00.000Z',
      laterConfirmation: { at: '2026-10-04T10:00:00.000Z', snapshotVersion: 2 },
    });
    expect(setAside).toContain('set aside');
    expect(setAside).toContain('You later confirmed snapshot 2');
  });

  it('has a tone and a next step for each of the five results, with the fix only where action is needed', () => {
    expect(Object.keys(RESULT_TONES).sort()).toEqual([...CONSISTENCY_RESULTS].sort());
    expect(Object.keys(RESULT_NEXT_STEPS).sort()).toEqual([...CONSISTENCY_RESULTS].sort());
    expect(RESULT_NEXT_STEPS.NEEDS_CLARIFICATION.updateDetail).toBe(true);
    expect(RESULT_NEXT_STEPS.NEEDS_CLARIFICATION.text).toContain('does not settle the difference');
    expect(RESULT_NEXT_STEPS.CONSISTENT.updateDetail).toBe(false);
  });

  it('uses no forbidden claim and no long dash in any label', () => {
    const all = JSON.stringify([
      CASE_FIELD_LABELS,
      FACT_STATUS_LABELS,
      RESULT_NEXT_STEPS,
      eventLine({
        kind: 'outcome',
        at: '2026-10-03T00:00:00.000Z',
        recordedAt: '2026-10-04T00:00:00.000Z',
        decision: 'APPROVED',
      }),
    ]);
    expect(all).not.toMatch(/verified|certified|guarantee/i);
    expect(all).not.toContain(String.fromCodePoint(0x2014));
  });

  it('builds the compare link with the snapshot and, when given, the exact version', () => {
    expect(compareHref('a1', SNAP)).toBe(`/app/applicant/a1/memory/compare?snapshot=${SNAP}`);
    expect(compareHref('a1', SNAP, PRIOR)).toBe(
      `/app/applicant/a1/memory/compare?snapshot=${SNAP}&version=${PRIOR}`,
    );
  });
});
