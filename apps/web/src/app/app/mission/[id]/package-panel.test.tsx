import type { CasePackage, PackageItem } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('server-only', () => ({}));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    loc.holder ??= build();
    return loc.holder;
  },
}));
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

  it('keeps the change note and its review button, and no longer lists each item again', () => {
    const html = renderToStaticMarkup(
      <PackagePanel
        pkg={pkg({
          change: {
            kind: 'NEWER_DOCUMENT',
            firstSeenAt: '2026-11-02T00:00:00.000Z',
            lastSeenAt: '2026-11-02T00:00:00.000Z',
            changeCount: 1,
          },
        })}
        listedIds={new Set([passport.packRequirementId])}
      />,
    );
    expect(html).toContain('I Have Reviewed This');
    expect(html).not.toContain('package-item');
    expect(html).not.toContain('package-choice-form');
    expect(html).toContain('open the item in the Evidence Checklist');
  });

  it('draws an item that has no checklist row, so no choice is ever out of reach', () => {
    const html = renderToStaticMarkup(<PackagePanel pkg={pkg()} />);
    expect(html).toContain('Other Items in This Package');
    expect(html).toContain('package-choice-form');
    // It reads by its document kind, in plain words.
    expect(html).toContain('<strong>Passport</strong>');
  });

  it('shows a finished case as it is, with no forms', () => {
    const html = renderToStaticMarkup(<PackagePanel pkg={pkg({ active: false })} />);
    expect(html).not.toContain('<form');
  });
});

describe('the trip package under Bengali (wording signed off 2026-11-12)', () => {
  it('says what the package shows in Bengali', async () => {
    const { appMissionCatalog } = await import('../../../../i18n/app-mission');
    const { primeLocale } = await import('../../../../lib/i18n-server');
    loc.holder = null;
    loc.locale = 'bn';
    await primeLocale();
    const html = renderToStaticMarkup(<PackagePanel pkg={pkg()} />);
    loc.locale = 'en';
    const key = 'appMission.appMissionIdPackagePanel.thisShowsWhatYouHaveReady';
    expect(html).toContain((appMissionCatalog.bn as Record<string, string>)[key]);
    expect(html).not.toContain((appMissionCatalog.en as Record<string, string>)[key]);
  });
});
