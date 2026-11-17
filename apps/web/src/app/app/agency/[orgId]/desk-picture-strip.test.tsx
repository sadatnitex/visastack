import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DeskPicture, DoNextItem } from './do-next';

/**
 * WP-PIC14: the agency desk row picture strip. It draws only what the row already carries (flag,
 * readiness counts, documents count), draws nothing where there is nothing (so a hidden case and an
 * empty one look the same), is never a control, and never words a count as a decision.
 */

const mocks = vi.hoisted(() => ({
  loadOrgAccess: vi.fn(),
  loadMembers: vi.fn(),
  loadEvidenceRequests: vi.fn(),
  loadCases: vi.fn(),
  loadApplicants: vi.fn(),
  loadUnassignedQueue: vi.fn(),
  loadClientsJoined: vi.fn(),
}));

vi.mock('../../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'member@example.com' }),
}));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./console-data', () => mocks);
vi.mock('./follow-up-copy', async () => {
  const { stub } = await import('../../../../lib/next-mocks.test-support');
  return { FollowUpCopy: stub('FollowUpCopy') };
});

import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import { DeskPictureStrip, DocumentsMissing, documentsMissingWords } from './desk-picture-strip';
import { DoNextList } from './do-next-list';

const full: DeskPicture = {
  destination: 'Japan',
  readiness: { done: 2, total: 5 },
  documentsMissing: 3,
};

const item = (key: string, picture?: DeskPicture): DoNextItem => ({
  key,
  tier: 4,
  heading: 'Work Visa',
  traveller: 'Test Traveller',
  caseTitle: 'Work Visa',
  owner: 'Nobody assigned',
  reason: 'Nobody is looking after this case yet.',
  action: { kind: 'link', label: 'Assign Someone', href: '/app/agency/o1/cases#case-m1' },
  ...(picture ? { picture } : {}),
});

/** Words that would turn a completeness count into a decision. */
const DECISION_WORDS = /\b(approved|accepted|reviewed|verified|cleared|guaranteed)\b/i;

describe('the desk picture strip', () => {
  it('draws the destination flag, the readiness ring in counts and the documents missing', () => {
    const html = renderToStaticMarkup(<DeskPictureStrip picture={full} />);
    const text = textOf(html);
    expect(html).toContain('class="desk-strip"');
    expect(html).toContain('country-flag');
    expect(text).toContain('Japan');
    expect(html).toContain('progress-ring-sm');
    expect(html).toContain('aria-label="2 of 5 items ready"');
    expect(text).toContain('3 Documents Missing');
    expect(text).not.toMatch(DECISION_WORDS);
  });

  it('is never a control: no link, button or form inside it', () => {
    const html = renderToStaticMarkup(<DeskPictureStrip picture={full} />);
    expect(html).not.toMatch(/<(a|button|input|select|form)\b/);
  });

  it('draws each part only when it is known, and nothing at all for no picture', () => {
    expect(renderToStaticMarkup(<DeskPictureStrip picture={undefined} />)).toBe('');
    const placeOnly = renderToStaticMarkup(
      <DeskPictureStrip
        picture={{ destination: 'Japan', readiness: null, documentsMissing: null }}
      />,
    );
    expect(placeOnly).toContain('Japan');
    expect(placeOnly).not.toContain('progress-ring');
    expect(placeOnly).not.toContain('desk-docs');
  });

  it('says the documents count in plain words, with the drawing hidden from screen readers', () => {
    expect(documentsMissingWords(0)).toBe('No Documents Missing');
    expect(documentsMissingWords(1)).toBe('1 Document Missing');
    expect(documentsMissingWords(4)).toBe('4 Documents Missing');
    const html = renderToStaticMarkup(<DocumentsMissing count={1} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe('Do Next rows with the strip', () => {
  it('draws the strip on a row tied to a case in view and none on a row without one', () => {
    const html = renderToStaticMarkup(
      <DoNextList
        items={[item('case:m1', full), item('case:m2')]}
        admin
        filtered={false}
        base="/app/agency/o1"
      />,
    );
    const rows = html.split('<li ').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('desk-strip');
    expect(rows[1]).not.toContain('desk-strip');
  });

  it('keeps one action per row: the strip adds no link', () => {
    const html = renderToStaticMarkup(
      <DoNextList items={[item('case:m1', full)]} admin filtered={false} base="/app/agency/o1" />,
    );
    const row = html.split('<li ')[1] ?? '';
    expect(row.match(/<a\b/g)).toHaveLength(1);
  });
});

describe('the agency Dashboard with desk pictures', () => {
  const missing = [
    { kind: 'DOCUMENT', key: 'passport', optional: false, reason: 'not_provided' },
    { kind: 'DOCUMENT', key: 'bank_statement', optional: false, reason: 'not_provided' },
    { kind: 'FIELD', key: 'passport.number', optional: false, reason: 'not_provided' },
  ];
  const caseRow = (missionId: string, extra: Record<string, unknown>) => ({
    missionId,
    applicantId: `ap-${missionId}`,
    applicantName: `Traveller ${missionId}`,
    title: `Case ${missionId}`,
    state: 'DRAFT',
    destination: 'Japan',
    manualMode: false,
    packVersionId: 'pv1',
    targetDeadline: null,
    travelStartDate: null,
    assignments: [],
    tasks: [],
    readiness: { ready: false, requiredCount: 3, satisfiedRequired: 0, missing },
    liveAcknowledgementAt: null,
    ...extra,
  });

  async function dashboard(cases: readonly unknown[]) {
    mocks.loadOrgAccess.mockResolvedValue({ org: { id: 'o1' }, admin: true, member: true });
    mocks.loadMembers.mockResolvedValue([]);
    mocks.loadEvidenceRequests.mockResolvedValue([]);
    mocks.loadApplicants.mockResolvedValue([]);
    mocks.loadCases.mockResolvedValue({ admin: true, cases });
    mocks.loadUnassignedQueue.mockResolvedValue([]);
    mocks.loadClientsJoined.mockResolvedValue({ total: 0, last30Days: 0 });
    const { default: Page } = await import('./page');
    return renderServer(
      Page({ params: Promise.resolve({ orgId: 'o1' }), searchParams: Promise.resolve({}) }),
    );
  }

  it('draws the strip on the Do Next row, and leaves the case table as it was', async () => {
    const html = await dashboard([caseRow('m1', {})]);
    const doNext = html.slice(html.indexOf('id="do-next-heading"'));
    const doNextList = doNext.slice(0, doNext.indexOf('</section>'));
    expect(doNextList).toContain('desk-strip');
    expect(textOf(doNextList)).toContain('2 Documents Missing');
    const table = html.slice(html.indexOf('id="agency-case-table-rows"'));
    // The table already shows the flag, the ring and "N missing"; a second missing count there
    // would read as a different number for the same case.
    expect(table.slice(0, table.indexOf('</tbody>'))).not.toContain('desk-');
  });

  it('draws no documents count for a manual case or one whose readiness is unknown', async () => {
    const html = await dashboard([
      caseRow('m1', { manualMode: true, readiness: null }),
      caseRow('m2', { readiness: null }),
    ]);
    expect(html).not.toContain('Documents Missing');
    expect(html).not.toContain('desk-docs');
  });
});

describe('the strip on the agency Cases list (WP-PIC18)', () => {
  it('draws as a span with the ring counted as Ready, and the desk default stays a div', () => {
    const picture: DeskPicture = {
      destination: null,
      readiness: { done: 3, total: 5 },
      documentsMissing: 2,
    };
    const listed = renderToStaticMarkup(
      <DeskPictureStrip picture={picture} as="span" countLabel="Ready" />,
    );
    expect(listed.startsWith('<span class="desk-strip">')).toBe(true);
    expect(listed).not.toMatch(/<div\b/);
    expect(listed).toContain('aria-label="3 of 5 Ready"');
    expect(listed).toContain('2 Documents Missing');
    expect(listed).not.toMatch(DECISION_WORDS);
    const desk = renderToStaticMarkup(<DeskPictureStrip picture={picture} />);
    expect(desk.startsWith('<div class="desk-strip">')).toBe(true);
    expect(desk).toContain('aria-label="3 of 5 items ready"');
  });
});
