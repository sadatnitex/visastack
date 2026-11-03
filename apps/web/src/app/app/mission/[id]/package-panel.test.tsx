import type { CasePackage, PackageItem } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./package-actions', () => ({
  recordPackageChoiceAction: vi.fn(),
  markPackageChangeReviewedAction: vi.fn(),
  confirmPackageHandoffAction: vi.fn(),
}));

const { PackagePanel } = await import('./package-panel');

const passport: PackageItem = {
  packRequirementId: '00000000-0000-4000-8000-000000000001',
  kind: 'DOCUMENT',
  key: 'passport',
  citation: 'Synthetic rule 1',
  necessity: 'MANDATORY',
  provenance: 'OFFICIAL',
  groupKey: null,
  state: 'SATISFIED',
  blocking: true,
  proposed: {
    kind: 'DOCUMENT',
    documentId: 'd1',
    documentVersionId: '00000000-0000-4000-8000-0000000000a1',
    factId: null,
    factVersionId: null,
    displayName: 'Passport Scan',
    documentDate: '2026-10-01',
    usable: true,
    tooOld: false,
    conflicting: false,
  },
  chosen: null,
  alternatives: [],
  newerCopy: null,
  canExclude: false,
};

function pkg(overrides: Partial<CasePackage> = {}): CasePackage {
  return {
    missionId: '00000000-0000-4000-8000-000000000101',
    phrase: 'READY_FOR_FINAL_REVIEW',
    reasons: [],
    overallState: 'READY_FOR_APPLICANT_REVIEW',
    requiredCount: 1,
    satisfiedRequired: 1,
    items: [passport],
    questions: [],
    freshness: null,
    outsideSteps: [
      {
        kind: 'APPLICATION_FORM',
        label: 'Fill in and send the official application form yourself.',
        namedByChecklist: false,
      },
    ],
    latestHandoff: null,
    change: null,
    available: true,
    active: true,
    ...overrides,
  };
}

describe('PackagePanel', () => {
  it('offers the handoff confirmation only when the package is ready for final review', () => {
    expect(renderToStaticMarkup(<PackagePanel pkg={pkg()} />)).toContain(
      'Mark as Prepared for Handoff',
    );
    const attention = renderToStaticMarkup(
      <PackagePanel pkg={pkg({ phrase: 'NEEDS_ATTENTION', reasons: ['NEEDS_ANSWER'] })} />,
    );
    expect(attention).not.toContain('Mark as Prepared for Handoff');
    expect(attention).toContain('Needs Attention');
    expect(attention).toContain('We need an answer from you');
  });

  it('never claims a submission or an approval', () => {
    const html = renderToStaticMarkup(
      <PackagePanel
        pkg={pkg({
          phrase: 'PREPARED_FOR_HANDOFF',
          latestHandoff: {
            id: 'h1',
            confirmedAt: '2026-11-02T10:00:00.000Z',
            packVersionId: 'v1',
            current: true,
            caveatCount: 0,
          },
        })}
      />,
    );
    expect(html).toContain('Prepared for Handoff');
    expect(html).toContain('It is not a submission');
    expect(html).not.toMatch(/\b(approved|submitted to authority|guaranteed)\b/i);
  });

  it('shows a newer copy as a proposal and keeps the chosen one', () => {
    const html = renderToStaticMarkup(
      <PackagePanel
        pkg={pkg({
          items: [
            {
              ...passport,
              chosen: {
                choice: 'USE_COPY',
                copy: passport.proposed,
                reason: null,
                chosenAt: '2026-11-01T00:00:00.000Z',
              },
              newerCopy: {
                ...(passport.proposed as NonNullable<PackageItem['proposed']>),
                documentVersionId: '00000000-0000-4000-8000-0000000000a2',
                documentDate: '2026-10-20',
              },
            },
          ],
          change: {
            kind: 'NEWER_DOCUMENT',
            firstSeenAt: '2026-11-02T00:00:00.000Z',
            lastSeenAt: '2026-11-02T00:00:00.000Z',
            changeCount: 1,
          },
        })}
      />,
    );
    expect(html).toContain('Using: Passport Scan (2026-10-01), chosen by you.');
    expect(html).toContain('A newer copy is available: Passport Scan (2026-10-20)');
    expect(html).toContain('I Have Reviewed This');
  });

  it('shows how each document must be provided when the checklist says (UMPE G2, R12)', () => {
    const html = renderToStaticMarkup(
      <PackagePanel
        pkg={pkg()}
        formatLines={{
          [passport.packRequirementId]: ['Accepted As: Certified Copy', 'Translation Needed'],
        }}
      />,
    );
    expect(html).toContain('How to Provide It: Accepted As: Certified Copy · Translation Needed');
    expect(renderToStaticMarkup(<PackagePanel pkg={pkg()} />)).not.toContain('How to Provide It');
  });

  it('shows a finished case as it is, with no forms', () => {
    const html = renderToStaticMarkup(<PackagePanel pkg={pkg({ active: false })} />);
    expect(html).not.toContain('<form');
  });
});
