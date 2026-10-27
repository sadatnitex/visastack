import { TRIAGE_GROUPS } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { REQUEST_ITEM_STATUS_LABELS, TRIAGE_GROUP_LABELS } from '../../../../../lib/labels';
import { requestItemView, requestRuleText } from './request-item';

const usable = { processingStatus: 'AWAITING_REVIEW', safetyStatus: 'CLEAN' } as const;

describe('where a request stands for the traveller (spec B09)', () => {
  it('maps every status to the same group the agency sees', () => {
    const expected: Record<string, string | null> = {
      OPEN: 'MISSING',
      RECEIVED: 'RECEIVED',
      UNDER_REVIEW: 'RECEIVED',
      ACCEPTED: 'REVIEWED',
      NEEDS_REPLACEMENT: 'NEEDS_CORRECTION',
      CANCELLED: null,
      FULFILLED: null,
      DECLINED: null,
    };
    for (const [status, group] of Object.entries(expected)) {
      const view = requestItemView({
        request: { status: status as never, kind: 'FIELD' },
        document: usable,
      });
      expect(view.group, status).toBe(group);
    }
  });

  it('uses the five words of the request UX, and only Reviewed says the agency looked', () => {
    expect(TRIAGE_GROUPS.map((group) => REQUEST_ITEM_STATUS_LABELS[group])).toEqual([
      'Missing',
      'Processing',
      'Received',
      'Needs Correction',
      'Reviewed',
    ]);
    for (const group of TRIAGE_GROUPS) {
      // Same groups as the agency summary, shortened but never reworded to mean something else.
      expect(TRIAGE_GROUP_LABELS[group].startsWith(REQUEST_ITEM_STATUS_LABELS[group])).toBe(true);
    }
    const received = requestItemView({
      request: { status: 'RECEIVED', kind: 'FIELD' },
    });
    expect(received.statusLabel).toBe('Received');
    // It says the agency WILL review it; it never says a review has happened.
    expect(received.guidance).not.toMatch(
      /has reviewed|reviewed (it|what)|accepted it|approved|guarantee/i,
    );
  });

  it('shows Processing while the sent file is checked, and Needs Correction when it cannot be used', () => {
    const processing = requestItemView({
      request: { status: 'RECEIVED', kind: 'DOCUMENT' },
      document: { processingStatus: 'EXTRACTING', safetyStatus: 'CLEAN' },
    });
    expect(processing).toMatchObject({
      group: 'PROCESSING',
      statusLabel: 'Processing',
      tone: 'neutral',
    });

    for (const document of [
      { processingStatus: 'NEEDS_ATTENTION', safetyStatus: 'QUARANTINED' } as const,
      { processingStatus: 'FAILED', safetyStatus: 'CLEAN' } as const,
      null,
    ]) {
      const broken = requestItemView({
        request: { status: 'UNDER_REVIEW', kind: 'DOCUMENT' },
        document,
      });
      expect(broken).toMatchObject({ group: 'NEEDS_CORRECTION', tone: 'warning' });
      // The person cannot resubmit a received request, so the guidance points to the question box.
      expect(broken.guidance).toContain('Ask the agency below');
    }
    // Documents not read: the request status alone decides, as for the agency.
    expect(requestItemView({ request: { status: 'RECEIVED', kind: 'DOCUMENT' } }).group).toBe(
      'RECEIVED',
    );
  });

  it('ignores the document for a detail request', () => {
    expect(
      requestItemView({ request: { status: 'RECEIVED', kind: 'FIELD' }, document: null }).group,
    ).toBe('RECEIVED');
  });

  it('gives each group one colour family, with danger kept out of the groups', () => {
    const tones = (['OPEN', 'RECEIVED', 'ACCEPTED', 'NEEDS_REPLACEMENT'] as const).map(
      (status) => requestItemView({ request: { status, kind: 'FIELD' } }).tone,
    );
    expect(tones).toEqual(['warning', 'neutral', 'success', 'warning']);
    expect(tones).not.toContain('danger');
  });

  it('closes cancelled and older requests plainly, and never as reviewed', () => {
    expect(requestItemView({ request: { status: 'CANCELLED', kind: 'FIELD' } })).toMatchObject({
      group: null,
      statusLabel: 'Cancelled',
      tone: 'neutral',
      guidance: 'The agency cancelled this request. Nothing is needed.',
    });
    for (const status of ['FULFILLED', 'DECLINED'] as const) {
      const view = requestItemView({ request: { status, kind: 'FIELD' } });
      expect(view.group).toBeNull();
      expect(view.statusLabel).not.toMatch(/review|accept/i);
    }
    expect(requestItemView({ request: { status: 'FULFILLED', kind: 'FIELD' } }).statusLabel).toBe(
      'Closed',
    );
  });
});

describe('guidance states what to do without inventing a rule or a promise', () => {
  const statuses = [
    'OPEN',
    'RECEIVED',
    'UNDER_REVIEW',
    'ACCEPTED',
    'NEEDS_REPLACEMENT',
    'CANCELLED',
    'FULFILLED',
    'DECLINED',
  ] as const;

  it('is present for every status and kind, in plain words', () => {
    for (const status of statuses) {
      for (const kind of ['FIELD', 'DOCUMENT'] as const) {
        const { guidance } = requestItemView({ request: { status, kind } });
        expect(guidance.length, `${status} ${kind}`).toBeGreaterThan(20);
        expect(guidance).not.toMatch(/[A-Z]+_[A-Z]+/);
        expect(guidance).not.toMatch(/mission/i);
        expect(guidance).not.toContain(String.fromCharCode(0x2014));
        // Never a promise about the visa, and never an instruction to change a document.
        expect(guidance).not.toMatch(/guarantee|will be approved|edit your|alter|backdate|fake/i);
      }
    }
  });

  it('tells a person with an open request what to send and where it comes from', () => {
    expect(requestItemView({ request: { status: 'OPEN', kind: 'DOCUMENT' } }).guidance).toContain(
      'safety checks',
    );
    expect(requestItemView({ request: { status: 'OPEN', kind: 'FIELD' } }).guidance).toContain(
      'profile',
    );
    expect(
      requestItemView({ request: { status: 'NEEDS_REPLACEMENT', kind: 'DOCUMENT' } }).guidance,
    ).toContain('send a replacement');
  });
});

describe('what the checklist says about the evidence', () => {
  it('states only the age and optional flag the checklist item holds', () => {
    expect(requestRuleText(undefined)).toBeNull();
    expect(requestRuleText({ maxAgeDays: null, optional: false })).toBeNull();
    expect(requestRuleText({ maxAgeDays: 90, optional: false })).toBe(
      'The checklist asks for something dated within the last 90 days.',
    );
    expect(requestRuleText({ maxAgeDays: 1, optional: true })).toBe(
      'The checklist asks for something dated within the last 1 day. This item is optional on the checklist.',
    );
    expect(requestRuleText({ maxAgeDays: null, optional: true })).toBe(
      'This item is optional on the checklist.',
    );
  });
});
