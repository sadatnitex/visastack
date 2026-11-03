import type { AttemptView, OutcomeAttemptsView } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./attempt-actions', () => ({
  trackReportAsAttemptAction: vi.fn(),
  recordAttemptAction: vi.fn(),
  recordAttemptEventAction: vi.fn(),
}));

const { AttemptPanel } = await import('./attempt-panel');

const base: AttemptView = {
  id: '00000000-0000-4000-8000-0000000000a1',
  attemptNo: 1,
  binding: 'PACKAGE_HANDOFF',
  packName: 'Synthetic Visitor',
  packVersion: 3,
  packChecksum: 'c'.repeat(64),
  selectedDocuments: 4,
  selectedDetails: 9,
  channel: 'VISA_APPLICATION_CENTER',
  submittedOn: '2026-10-02',
  fromSubmissionReport: true,
  documentSupplied: false,
  receipt: 'NONE',
  standing: { kind: 'UNKNOWN' },
  events: [],
};

function render(view: Partial<OutcomeAttemptsView>) {
  return renderToStaticMarkup(
    <AttemptPanel
      missionId="00000000-0000-4000-8000-000000000001"
      today="2026-11-03"
      documentKinds={[{ value: 'BANK_STATEMENT', label: 'Bank Statement' }]}
      view={{ available: true, attempts: [], evidenceChoices: [], untrackedReports: [], ...view }}
    />,
  );
}

describe('Application Attempts card', () => {
  it('keeps each attempt apart and calls an unrecorded decision Unknown, never confirmed', () => {
    const html = render({
      attempts: [
        {
          ...base,
          standing: {
            kind: 'DECIDED',
            decision: 'REFUSED',
            occurredOn: '2026-10-20',
            documentSupplied: true,
          },
          receipt: 'DOCUMENT_SUPPLIED',
        },
        {
          ...base,
          id: '00000000-0000-4000-8000-0000000000a2',
          attemptNo: 2,
          binding: 'NONE',
          fromSubmissionReport: false,
          events: [
            {
              id: 'e1',
              kind: 'AUTHORITY_REQUEST',
              decision: null,
              requestSource: 'EMBASSY_OR_CONSULATE',
              requestedDocTypes: ['BANK_STATEMENT'],
              occurredOn: '2026-10-25',
              documentSupplied: false,
            },
          ],
        },
      ],
    });
    expect(html).toContain('Attempt 1');
    expect(html).toContain('Attempt 2');
    expect(html).toContain('Refused');
    expect(html).toContain('No Decision Recorded');
    expect(html).toContain('The Embassy Asked for More');
    expect(html).toContain('Bank Statement');
    expect(html).toContain('Prepared Package: Synthetic Visitor, Version 3');
    expect(html).toContain('No Prepared Package on Record');
    expect(html).toContain('Reported by You');
    expect(html).toContain('Document Attached');
    const visible = html.replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/verified|confirmed|chance|likely|probability|\bmissions?\b/i);
  });

  it('offers Track as Attempt for a report, and waits plainly before the migration', () => {
    const tracked = render({
      untrackedReports: [{ id: 's1', submittedOn: '2026-10-02', channel: 'EMAIL' }],
    });
    expect(tracked).toContain('Track as Attempt');
    expect(tracked).toContain('Record Another Attempt');
    const waiting = render({ available: false });
    expect(waiting).toContain('Attempts can be recorded here soon.');
    expect(waiting).not.toContain('Record Another Attempt');
  });
});
