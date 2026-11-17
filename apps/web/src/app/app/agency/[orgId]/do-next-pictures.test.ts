import { describe, expect, it } from 'vitest';
import {
  type DoNextCase,
  type DoNextInput,
  type DoNextRequest,
  buildDoNextList,
  deskPictureOf,
} from './do-next';

/**
 * WP-PIC14: a Do Next item carries a picture only when it is tied to a case already in view, and
 * the picture holds only what that case row already carries. A request with no case, or one whose
 * case is not in view, gets no picture: exactly like a case with nothing to draw.
 */

const NOW = new Date('2026-10-25T09:00:00.000Z');

const readiness = {
  requiredCount: 4,
  satisfiedRequired: 1,
  missing: [
    { kind: 'DOCUMENT', optional: false },
    { kind: 'DOCUMENT', optional: false },
    { kind: 'DOCUMENT', optional: true },
    { kind: 'FIELD', optional: false },
  ],
};

const caseRow = (overrides: Partial<DoNextCase> & Pick<DoNextCase, 'missionId'>): DoNextCase => ({
  applicantId: `ap-${overrides.missionId}`,
  applicantName: `Traveller ${overrides.missionId}`,
  title: `Case ${overrides.missionId}`,
  state: 'INTAKE',
  createdAt: '2026-09-01T00:00:00.000Z',
  assignments: [],
  tasks: [],
  ...overrides,
});

const requestRow = (
  overrides: Partial<DoNextRequest> & Pick<DoNextRequest, 'id'>,
): DoNextRequest => ({
  applicantId: 'ap-m1',
  applicantName: 'Traveller m1',
  missionId: 'm1',
  kind: 'DOCUMENT',
  docType: 'BANK_STATEMENT',
  status: 'RECEIVED',
  createdAt: '2026-10-01T00:00:00.000Z',
  respondedAt: '2026-10-20T00:00:00.000Z',
  ...overrides,
});

const input = (overrides: Partial<DoNextInput>): DoNextInput => ({
  admin: true,
  viewerAccountId: 'acct-1',
  cases: [],
  requests: [],
  applicantWide: 'all',
  members: [],
  organizationName: 'Harbor Travel Partners',
  base: '/app/agency/o1',
  now: NOW,
  ...overrides,
});

describe('deskPictureOf', () => {
  it('takes the destination and the readiness counts, and counts required documents missing', () => {
    expect(deskPictureOf({ destination: ' Japan ', readiness })).toEqual({
      destination: 'Japan',
      readiness: { done: 1, total: 4 },
      documentsMissing: 2,
    });
  });

  it('has nothing to draw without a destination or a counted readiness', () => {
    expect(deskPictureOf({})).toBeUndefined();
    expect(deskPictureOf({ destination: '  ', readiness: null })).toBeUndefined();
    // A checklist with nothing required has nothing to count.
    expect(
      deskPictureOf({ readiness: { requiredCount: 0, satisfiedRequired: 0, missing: [] } }),
    ).toBeUndefined();
  });

  it('leaves the documents count out where the missing list was not read', () => {
    expect(
      deskPictureOf({
        destination: 'France',
        readiness: { requiredCount: 3, satisfiedRequired: 3 },
      }),
    ).toEqual({ destination: 'France', readiness: { done: 3, total: 3 }, documentsMissing: null });
  });
});

describe('Do Next items and their pictures', () => {
  it('gives a case row and a request on a case in view the picture of that case', () => {
    const { items } = buildDoNextList(
      input({
        cases: [caseRow({ missionId: 'm1', destination: 'Japan', readiness })],
        requests: [requestRow({ id: 'r1' })],
      }),
    );
    const review = items.find((i) => i.key === 'request:r1');
    const assign = items.find((i) => i.key === 'case:m1');
    const expected = {
      destination: 'Japan',
      readiness: { done: 1, total: 4 },
      documentsMissing: 2,
    };
    expect(review?.picture).toEqual(expected);
    expect(assign?.picture).toEqual(expected);
  });

  it('gives no picture to a request with no case, and none for a case with nothing to draw', () => {
    const { items } = buildDoNextList(
      input({
        cases: [
          caseRow({ missionId: 'm1', applicantId: 'ap-m1', destination: 'Japan', readiness }),
          caseRow({ missionId: 'm2' }),
        ],
        requests: [requestRow({ id: 'r-general', missionId: null })],
      }),
    );
    expect(items.find((i) => i.key === 'request:r-general')).toBeDefined();
    expect(items.find((i) => i.key === 'request:r-general')?.picture).toBeUndefined();
    expect(items.find((i) => i.key === 'case:m2')).toBeDefined();
    expect(items.find((i) => i.key === 'case:m2')?.picture).toBeUndefined();
    expect(items.find((i) => i.key === 'case:m1')?.picture).toBeDefined();
  });

  it('never draws the picture of a case that is not in view', () => {
    const { items } = buildDoNextList(
      input({
        cases: [caseRow({ missionId: 'm1', destination: 'Japan', readiness })],
        // A request on another case: left off entirely, so no picture of it can appear.
        requests: [requestRow({ id: 'r-hidden', missionId: 'm-hidden', applicantId: 'ap-hidden' })],
      }),
    );
    expect(items.map((i) => i.key)).toEqual(['case:m1']);
    expect(JSON.stringify(items)).not.toContain('m-hidden');
  });
});
