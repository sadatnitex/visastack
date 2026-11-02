import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { textOf } from '../../../../../lib/next-mocks.test-support';

/** The agency's Answers panel (UMPE P7), from stand-in data. Synthetic values only. */

vi.mock('./collection-response-actions', () => ({
  downloadResponseFileAction: async () => undefined,
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
    expect(text).not.toMatch(/Reviewed|Accepted/);
  });

  it('never shows an answer that no longer matches what was sent', () => {
    const text = render(false);
    expect(text).toContain('This answer has changed since it was sent');
    expect(text).not.toContain('Download');
  });
});
