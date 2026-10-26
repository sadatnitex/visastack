import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ prepareCaseAgainAction: vi.fn() }));

const { PrepareAgainForm } = await import('./prepare-again-form');

const html = renderToStaticMarkup(
  <PrepareAgainForm
    applicantId="a-1"
    fromMissionId="m-1"
    defaultTitle="Japan trip 2025"
    expectedPackVersionId="pv-2"
    checklistNote="Checklist: Japan (version 2)."
    groups={[
      {
        key: 'REUSABLE',
        title: 'Reusable',
        hint: 'Use as they are.',
        tone: 'success',
        items: [
          {
            id: 'r1',
            label: 'Passport Number',
            reason: 'Used in your last case and still current.',
            optional: false,
            records: [{ value: 'r1|f|f1', label: 'A1234567', carriable: true, preselected: true }],
          },
        ],
      },
      {
        key: 'NEEDS_REVIEW',
        title: 'Needs Refreshing or Review',
        hint: 'Check first.',
        tone: 'warning',
        items: [
          {
            id: 'r2',
            label: 'Bank Statement',
            reason: 'Older than this route allows.',
            optional: false,
            records: [
              { value: 'r2|d|d1', label: 'bank.pdf', carriable: false, preselected: false },
            ],
          },
          {
            id: 'r3',
            label: 'Employer',
            reason: 'More than one record fits.',
            optional: true,
            records: [
              { value: 'r3|f|e1', label: 'Acme', carriable: true, preselected: false },
              { value: 'r3|f|e2', label: 'Beta', carriable: true, preselected: false },
            ],
          },
        ],
      },
      { key: 'MISSING', title: 'Missing', hint: 'Still needed.', tone: 'neutral', items: [] },
    ]}
    sharingQuestions={[
      { kind: 'grant', id: 'g1', recipient: 'Agency A', purpose: 'collaboration', pending: false },
      { kind: 'invitation', id: 'i1', recipient: 'p@example.test', purpose: 'help', pending: true },
    ]}
  />,
);

function checkbox(value: string): string {
  const at = html.indexOf(`value="${value}"`);
  if (at < 0) return '';
  return html.slice(html.lastIndexOf('<input', at), html.indexOf('/>', at));
}

describe('PrepareAgainForm', () => {
  it('shows the three groups and carries the plan it was given', () => {
    for (const title of ['Reusable', 'Needs Refreshing or Review', 'Missing']) {
      expect(html).toContain(title);
    }
    expect(html).toContain('name="from" value="m-1"');
    expect(html).toContain('name="expectedPackVersionId" value="pv-2"');
    expect(html).toContain('value="Japan trip 2025"');
  });

  it('ticks only what was used before or is the only match, never a choice among several', () => {
    expect(checkbox('r1|f|f1')).toContain('checked');
    expect(checkbox('r3|f|e1')).not.toContain('checked');
    expect(checkbox('r3|f|e2')).not.toContain('checked');
  });

  it('offers no tick box for a record that needs review', () => {
    expect(checkbox('r2|d|d1')).toBe('');
    expect(html).toContain('bank.pdf');
  });

  it('asks about everyone with all-cases access, with nobody ticked', () => {
    expect(checkbox('g1')).toContain('name="allowGrant"');
    expect(checkbox('g1')).not.toContain('checked');
    expect(checkbox('i1')).toContain('name="allowInvitation"');
    expect(checkbox('i1')).not.toContain('checked');
    expect(html).toContain('Anyone you leave unticked will not see it.');
    expect(html).toContain('(Not Accepted Yet)');
  });
});
