import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { textOf } from '../../../../../lib/next-mocks.test-support';

/** The agency's Answers panel (UMPE P7), from stand-in data. Synthetic values only. */

vi.mock('./collection-response-actions', () => ({
  downloadResponseFileAction: async () => undefined,
}));
vi.mock('./collection-review-actions', () => ({
  reviewAnswerAction: async () => ({ ok: true, message: '' }),
  guestHoldAction: async () => ({ ok: true, message: '' }),
}));

const { CollectionResponsesPanel } = await import('./collection-response-panel');

const ITEM = {
  id: 'item-1',
  label: 'Passport',
  kind: 'DOCUMENT' as const,
  fieldKey: null,
  docType: 'passport',
  necessity: 'MANDATORY' as const,
  provenance: 'OFFICIAL' as const,
  groupKey: null,
  note: null,
  order: 0,
  source: 'r1',
  citation: 'Synthetic rule',
};

function render(intact: boolean) {
  return textOf(
    renderToStaticMarkup(
      <CollectionResponsesPanel
        organizationId="o1"
        requestId="q1"
        fileUnavailable={false}
        responses={[
          {
            id: 'resp-1',
            status: 'SUBMITTED_TO_AGENCY',
            personName: 'Synthetic Traveller',
            revisionNo: 1,
            submittedAt: new Date('2026-12-02T00:00:00Z'),
            consentVersion: 'umpe-p7-consent-1',
            intact,
            hasProtectedDetails: intact,
            lines: intact
              ? [
                  {
                    itemId: ITEM.id,
                    item: ITEM,
                    source: 'account' as const,
                    versions: [
                      {
                        kind: 'DOCUMENT' as const,
                        documentVersionId: 'v1',
                        title: 'Passport',
                        versionNumber: 2,
                      },
                      { kind: 'FIELD' as const, value: null, protected: true },
                    ],
                    missing: false,
                  },
                  {
                    itemId: 'item-2',
                    item: { ...ITEM, id: 'item-2', label: 'Bank Statement' },
                    source: 'account' as const,
                    versions: [],
                    missing: true,
                  },
                ]
              : [],
          },
        ]}
      />,
    ),
  );
}

describe('the agency Answers panel', () => {
  it('shows exactly the chosen version and what is Still Missing, as Submitted to Agency only', () => {
    const text = render(true);
    expect(text).toContain('Synthetic Traveller');
    expect(text).toContain('Submitted to Agency');
    expect(text).toContain('Passport, Version 2');
    expect(text).toContain('Download Passport');
    expect(text).toContain('Protected Detail');
    expect(text).toContain('Show Protected Details');
    expect(text).toContain('Still Missing');
    // No decision yet: arrival is never shown as Reviewed or Accepted (the form offers the choice).
    expect(text).not.toMatch(/Reviewed|Decided/);
    expect(text).toContain('Your Decision');
  });

  it('never shows an answer that no longer matches what was sent', () => {
    const text = render(false);
    expect(text).toContain('This answer has changed since it was sent');
    expect(text).not.toContain('Download');
  });

  it('lists guest submissions in the same queue, with their files, decisions and the hold', () => {
    const text = textOf(
      renderToStaticMarkup(
        <CollectionResponsesPanel
          organizationId="o1"
          requestId="q1"
          fileUnavailable={false}
          responses={[]}
          extras={{
            guest: [
              {
                id: 'gs-1',
                source: 'guest',
                status: 'SUBMITTED_TO_AGENCY',
                submissionNo: 2,
                revisionNo: 1,
                submittedAt: new Date('2026-12-03T00:00:00Z'),
                retentionDays: 30,
                consentVersion: 'guest-submit-2026-11-02',
                guestNo: 1,
                intact: true,
                lines: [
                  {
                    itemId: ITEM.id,
                    item: ITEM,
                    source: 'guest',
                    versions: [
                      {
                        kind: 'GUEST_FILE',
                        fileId: 'f1',
                        title: 'passport.pdf',
                        sizeBytes: 2048,
                        virusScanned: false,
                      },
                    ],
                    missing: false,
                  },
                ],
              },
            ],
            reviews: new Map([
              [
                'gs-1',
                [
                  {
                    decision: 'NEEDS_CORRECTION' as const,
                    note: null,
                    itemNotes: [],
                    decidedAt: new Date('2026-12-03T01:00:00Z'),
                  },
                ],
              ],
            ]),
            hold: null,
          }}
        />,
      ),
    );
    expect(text).toContain('Without an Account: Guest 1, Submission 2');
    expect(text).toContain('passport.pdf');
    expect(text).toContain('file checked, not scanned for viruses');
    expect(text).toContain('Download passport.pdf');
    expect(text).toContain('Needs Correction');
    expect(text).toContain('Kept 30 days after the request closes');
    expect(text).toContain('Place a Legal Hold');
  });
});
