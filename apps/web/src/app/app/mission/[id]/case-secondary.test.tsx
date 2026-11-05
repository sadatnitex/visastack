import { JSDOM } from 'jsdom';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { stub } from '../../../../lib/next-mocks.test-support';

vi.mock('./attempt-panel', () => ({ AttemptPanel: stub('AttemptPanel') }));
vi.mock('./collaboration-panels', () => ({
  AppointmentsPanel: stub('AppointmentsPanel'),
  EvidenceSelectionPanel: stub('EvidenceSelectionPanel'),
  LettersPanel: stub('LettersPanel'),
  TasksPanel: stub('TasksPanel'),
}));
vi.mock('./complaint-feedback-panel', () => ({
  ComplaintPanel: stub('ComplaintPanel'),
  FeedbackPanel: stub('FeedbackPanel'),
}));
vi.mock('./contributor-requests-panel', () => ({
  ContributorRequestsPanel: stub('ContributorRequestsPanel'),
}));
vi.mock('./outcome-panel', () => ({ OutcomePanel: stub('OutcomePanel') }));
vi.mock('./submission-report-panel', () => ({
  SubmissionReportPanel: stub('SubmissionReportPanel'),
}));

const { CaseSecondary } = await import('./case-secondary');
type SecondaryProps = ComponentProps<typeof CaseSecondary>;
const withProps = (extra: Record<string, unknown> = {}) =>
  ({ ...base, ...extra }) as unknown as SecondaryProps;

/**
 * More for This Case on its own (WP-LIFT-B): the five sections as rows of one card, each at its own
 * depth level with its own id, a count where the hint was, and every panel still in the markup.
 */

const none = { tasks: false, notes: false, outcomes: false, complaints: false, feedback: false };
const noMore = { tasks: null, notes: null, outcomes: null, complaints: null, feedback: null };

const base = {
  missionId: 'case-1',
  missionState: 'IN_PROGRESS',
  candidates: [],
  evidenceLifecycle: { byDocument: {} },
  selectionIdsByCandidate: {},
  tasks: [],
  finishedTaskTotal: 0,
  appointments: [],
  letters: [],
  contributorRequests: [],
  notes: [],
  submissions: [],
  outcomes: [],
  evidenceOptions: [],
  outcomeAttempts: null,
  attemptToday: '2026-11-04',
  complaints: [],
  feedback: [],
  canSubmitFeedback: true,
  expanded: none,
  more: noMore,
};

const render = (extra: Record<string, unknown> = {}) =>
  new JSDOM(`<body>${renderToStaticMarkup(<CaseSecondary {...withProps(extra)} />)}</body>`).window
    .document;

const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rowOf = (doc: Document, title: string) =>
  [...doc.querySelectorAll('.lift-more-item')].find(
    (item) => words(item.querySelector('.lift-action-title')) === title,
  );
const pillOf = (doc: Document, title: string) => words(rowOf(doc, title)?.querySelector('.badge'));

describe('More for This Case', () => {
  it('is one card with a real heading and five closed rows, in order', () => {
    const doc = render();
    expect(words(doc.querySelector('h2.lift-card-title'))).toBe('More for This Case');
    expect(doc.querySelectorAll('.lift-card')).toHaveLength(1);
    const titles = [...doc.querySelectorAll('.lift-more-item .lift-action-title')].map((t) =>
      words(t),
    );
    expect(titles).toEqual([
      'Select or Update Evidence',
      'Tasks, Appointments and Letters',
      'Contributors and Notes from Your Agency',
      'Submission and Outcome',
      'Problems and Feedback',
    ]);
    for (const item of doc.querySelectorAll('.lift-more-item')) {
      const details = item.querySelector(':scope > details');
      expect(details?.hasAttribute('open')).toBe(false);
      expect(details?.firstElementChild?.tagName).toBe('SUMMARY');
    }
  });

  it('keeps each section at the depth level it had, so the level switch hides the same rows', () => {
    const doc = render();
    const level = (title: string) => rowOf(doc, title)?.getAttribute('data-level');
    expect(level('Select or Update Evidence')).toBe('everything');
    expect(level('Tasks, Appointments and Letters')).toBe('browse');
    expect(level('Contributors and Notes from Your Agency')).toBe('browse');
    expect(level('Submission and Outcome')).toBe('everything');
    expect(level('Problems and Feedback')).toBe('everything');
    // The card itself shows at the shallowest level of its rows.
    expect(doc.querySelector('.lift-more-slot')?.getAttribute('data-level')).toBe('browse');
  });

  it('keeps the anchors the page links to inside the section they open', () => {
    const doc = render();
    expect(rowOf(doc, 'Select or Update Evidence')?.querySelector('#evidence')).not.toBeNull();
    expect(rowOf(doc, 'Tasks, Appointments and Letters')?.querySelector('#work')).not.toBeNull();
    expect(rowOf(doc, 'Submission and Outcome')?.querySelector('#outcome')).not.toBeNull();
    // #notes is the row itself, so a link to it lands on the row, with its details inside.
    const notes = doc.querySelector('#notes');
    expect(notes?.classList.contains('lift-more-item')).toBe(true);
    expect(notes?.querySelector('details')).not.toBeNull();
  });

  it('keeps every panel in the markup, so nothing is lost behind a closed row', () => {
    const doc = render();
    const stubs = [...doc.querySelectorAll('[data-stub]')].map((s) => s.getAttribute('data-stub'));
    expect(stubs).toEqual([
      'EvidenceSelectionPanel',
      'TasksPanel',
      'AppointmentsPanel',
      'LettersPanel',
      'ContributorRequestsPanel',
      'SubmissionReportPanel',
      'OutcomePanel',
      'ComplaintPanel',
      'FeedbackPanel',
    ]);
    expect([...doc.querySelectorAll('h2.card-title')].map((h) => words(h))).toEqual([
      'Ask a Contributor',
      'Notes from Your Agency',
    ]);
  });

  it('shows a quiet "none yet" for each empty section and a count when there is something', () => {
    let doc = render();
    expect(pillOf(doc, 'Select or Update Evidence')).toBe('No Items Yet');
    expect(pillOf(doc, 'Tasks, Appointments and Letters')).toBe('No Open Tasks');
    expect(pillOf(doc, 'Contributors and Notes from Your Agency')).toBe('No Notes Yet');
    expect(pillOf(doc, 'Submission and Outcome')).toBe('No Outcome Yet');
    expect(pillOf(doc, 'Problems and Feedback')).toBe('None Raised');
    doc = render({
      candidates: [
        {
          packRequirementId: 'r1',
          kind: 'DOCUMENT',
          key: 'bank_statement',
          citation: 'rule',
          factCandidates: [],
          documentCandidates: [],
          selectedFactIds: [],
          selectedDocumentIds: [],
        },
      ],
      tasks: [
        {
          id: 't1',
          description: 'One',
          status: 'OPEN',
          priority: 'NORMAL',
          dueDate: null,
          dueTimezone: null,
        },
        {
          id: 't2',
          description: 'Two',
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
          dueDate: null,
          dueTimezone: null,
        },
        {
          id: 't3',
          description: 'Three',
          status: 'DONE',
          priority: 'NORMAL',
          dueDate: null,
          dueTimezone: null,
        },
      ],
      notes: [{ id: 'n1', body: 'Hello', authorEmail: null, createdAt: '2026-11-01T00:00:00Z' }],
      complaints: [{ id: 'c1' }],
      feedback: [{ id: 'f1' }, { id: 'f2' }],
    });
    expect(pillOf(doc, 'Select or Update Evidence')).toBe('1 Checklist Item');
    expect(pillOf(doc, 'Tasks, Appointments and Letters')).toBe('2 Open Tasks');
    expect(pillOf(doc, 'Contributors and Notes from Your Agency')).toBe('1 Note');
    expect(pillOf(doc, 'Problems and Feedback')).toBe('3 Raised');
  });

  it('prefers the full totals over the rows it was handed, because a long list is cut short', () => {
    const doc = render({ totals: { openTasks: 25, notes: 34, outcomes: 3, problems: 7 } });
    expect(pillOf(doc, 'Tasks, Appointments and Letters')).toBe('25 Open Tasks');
    expect(pillOf(doc, 'Contributors and Notes from Your Agency')).toBe('34 Notes');
    expect(pillOf(doc, 'Submission and Outcome')).toBe('3 Outcomes');
    expect(pillOf(doc, 'Problems and Feedback')).toBe('7 Raised');
  });

  it('opens a row when its list was asked to show more, and only that row', () => {
    const doc = render({ expanded: { ...none, notes: true } });
    const open = [...doc.querySelectorAll('.lift-more-item')]
      .filter((item) => item.querySelector(':scope > details')?.hasAttribute('open'))
      .map((item) => words(item.querySelector('.lift-action-title')));
    expect(open).toEqual(['Contributors and Notes from Your Agency']);
  });

  it('keeps shared notes as rows with the ids that Show More lands on', () => {
    const doc = render({
      notes: [
        {
          id: 'n1',
          body: 'Bring the original',
          authorEmail: 'agent@example.test',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
    });
    const row = doc.querySelector('#case-note-0.row');
    expect(words(row)).toContain('Bring the original');
    expect(words(row)).toContain('agent@example.test');
  });

  it('has no inline style and no filled button', () => {
    const html = renderToStaticMarkup(<CaseSecondary {...withProps()} />);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('btn-primary');
  });

  it('passes the automated accessibility rules, closed and with a row opened', async () => {
    for (const expanded of [none, { ...none, tasks: true, notes: true }]) {
      const html = `<h1>Case</h1>${renderToStaticMarkup(<CaseSecondary {...withProps({ expanded })} />)}`;
      expect(await axeViolations(html)).toEqual([]);
    }
  });
});
