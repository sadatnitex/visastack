// Lane Z (resource lifecycle, PROGRAMME 5.3): a document the case picker lists that is archived,
// replaced or removed carries its lifecycle label next to its name; a current one carries none.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const standIn = vi.hoisted(
  () => () =>
    new Proxy(
      {},
      {
        has: () => true,
        get: (_target, key) =>
          key === 'then' ? undefined : async () => ({ ok: true, message: '' }),
      },
    ),
);
vi.mock('./actions', standIn);

const { EvidenceSelectionPanel } = await import('./collaboration-panels');

describe('Select Evidence: lifecycle labels', () => {
  it('shows the label beside a chosen archived document only', () => {
    const html = renderToStaticMarkup(
      <EvidenceSelectionPanel
        missionId="m1"
        candidates={[
          {
            packRequirementId: 'q1',
            kind: 'DOCUMENT',
            label: 'Bank statement',
            citation: 'rule',
            factCandidates: [],
            documentCandidates: [
              {
                documentId: 'd1',
                displayName: 'October statement',
                eligible: true,
                staleness: 'fresh',
                lifecycleLabel: 'Archived',
              },
              {
                documentId: 'd2',
                displayName: 'September statement',
                eligible: true,
                staleness: 'fresh',
                lifecycleLabel: null,
              },
            ],
            selectedFactIds: [],
            selectedDocumentIds: ['d1'],
            selectionIdsByCandidate: {},
          },
        ]}
      />,
    );
    expect(html).toContain('October statement<span class="badge badge-neutral"');
    expect(html.match(/>Archived</g)).toHaveLength(1);
    expect(html).not.toContain('September statement<span');
  });
});
