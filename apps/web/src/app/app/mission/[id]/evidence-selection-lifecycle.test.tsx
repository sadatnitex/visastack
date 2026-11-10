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
    expect(html).toMatch(
      /October statement<span class="lp-choice-chip"><span class="badge badge-neutral[^"]*">Archived<\/span>/,
    );
    expect(html.match(/>Archived</g)).toHaveLength(1);
    expect(html).not.toContain('September statement<span');
  });

  it('says why a file cannot back an item in Title Case chips, with classes and not inline styles, and names each button for its file', () => {
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
                displayName: 'Old statement',
                eligible: false,
                staleness: 'stale',
              },
              {
                documentId: 'd2',
                displayName: 'New statement',
                eligible: true,
                staleness: 'unknown',
              },
            ],
            selectedFactIds: [],
            selectedDocumentIds: [],
            selectionIdsByCandidate: {},
          },
        ]}
      />,
    );
    expect(html).toContain('>Not Eligible<');
    expect(html).toContain('>Too Old for This Route<');
    expect(html).toContain('>Freshness Unknown<');
    expect(html).not.toMatch(/not eligible|too old for this route|freshness unknown/);
    expect(html).not.toContain('style=');
    // Each button says which file it is for, and is its own (the busy word is not the idle word).
    expect(html).toContain('aria-label="Select Old statement"');
    expect(html).toContain('aria-label="Select New statement"');
  });

  it('lists the files with the chosen one marked and no buttons when the case is not open', () => {
    const html = renderToStaticMarkup(
      <EvidenceSelectionPanel
        missionId="m1"
        editable={false}
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
              },
              {
                documentId: 'd2',
                displayName: 'September statement',
                eligible: true,
                staleness: 'fresh',
              },
            ],
            selectedFactIds: [],
            selectedDocumentIds: ['d1'],
            selectionIdsByCandidate: { d1: 'sel1' },
          },
        ]}
      />,
    );
    expect(html).toContain('October statement');
    expect(html.match(/>Chosen</g)).toHaveLength(1);
    expect(html).not.toContain('<form');
    expect(html).not.toContain('>Select<');
  });
});
