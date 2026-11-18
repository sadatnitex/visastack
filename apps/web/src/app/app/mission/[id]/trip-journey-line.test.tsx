import type { CasePackage, PackageItem } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('server-only', () => ({}));
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

const { TripJourneyLine, OutsideVisaStackRow, journeyStones } = await import('./trip-journey-line');
const { PackagePanel } = await import('./package-panel');

function item(n: number, key: string, state: PackageItem['state']): PackageItem {
  return {
    packRequirementId: `00000000-0000-4000-8000-00000000000${n}`,
    kind: 'DOCUMENT',
    key,
    citation: 'Example only',
    necessity: 'MANDATORY',
    provenance: 'OFFICIAL',
    groupKey: null,
    state,
    blocking: true,
    proposed: null,
    chosen: null,
    alternatives: [],
    newerCopy: null,
    canExclude: false,
  };
}

const OUTSIDE: CasePackage['outsideSteps'] = [
  {
    kind: 'APPLICATION_FORM',
    label: 'Fill in and send the official application form yourself.',
    namedByChecklist: false,
  },
  {
    kind: 'APPOINTMENT',
    label: 'Book any appointment the embassy or visa centre asks for.',
    namedByChecklist: false,
  },
  {
    kind: 'ORIGINALS',
    label: 'Bring the original documents if you are asked to show them.',
    namedByChecklist: false,
  },
  { kind: 'FEE', label: 'Pay the official fee where the authority says.', namedByChecklist: false },
  {
    kind: 'TRANSLATION',
    label: 'Get any translation the authority asks for.',
    namedByChecklist: true,
  },
];

function pkg(items: PackageItem[]): CasePackage {
  return {
    missionId: '00000000-0000-4000-8000-000000000101',
    phrase: 'NEEDS_ATTENTION',
    reasons: [],
    overallState: 'NEEDS_ACTION',
    requiredCount: items.length,
    satisfiedRequired: 0,
    items,
    questions: [],
    freshness: null,
    outsideSteps: OUTSIDE,
    latestHandoff: null,
    change: null,
    available: true,
    active: true,
  };
}

const MIXED = pkg([
  item(1, 'passport', 'SATISFIED'),
  item(2, 'bank_statement', 'CRITICAL_GAP'),
  item(3, 'travel_insurance', 'EXPIRING_STALE'),
  item(4, 'photo', 'CONFLICTING'),
  item(5, 'flight_booking', 'UNVERIFIED'),
  item(6, 'hotel_booking', 'NOT_APPLICABLE'),
  item(7, 'invitation_letter', 'ATTENTION'),
]);

describe('the journey line', () => {
  it('makes one stone for each item the trip needs, ready or gap, from the readiness states', () => {
    const stones = journeyStones(MIXED.items);
    expect(stones.map((s) => [s.state, s.kind])).toEqual([
      ['SATISFIED', 'ready'],
      ['CRITICAL_GAP', 'gap'],
      ['EXPIRING_STALE', 'gap'],
      ['CONFLICTING', 'gap'],
      ['UNVERIFIED', 'todo'],
    ]);
  });

  it('says every stone in a ring style, an icon and a word, never colour alone', () => {
    const html = renderToStaticMarkup(<TripJourneyLine pkg={MIXED} />);
    expect(html).toContain('trip-stone-ready');
    expect(html).toContain('trip-stone-gap');
    expect(html).toContain('On File');
    expect(html).toContain('Missing');
    expect(html).toContain('Out of Date');
    expect(html).toContain('Two Values');
    expect(html).toContain('1 of 5 ready');
    expect((html.match(/<svg/g) ?? []).length).toBe(5);
  });

  it('keeps a long line inside its own card: a focusable, named scroll area with five stones in view', () => {
    const many = pkg(Array.from({ length: 8 }, (_, i) => item(i + 1, `doc_${i}`, 'SATISFIED')));
    const html = renderToStaticMarkup(<TripJourneyLine pkg={many} />);
    expect(html).toContain(
      'class="trip-journey-list" aria-label="What This Trip Needs" tabindex="0"',
    );
    expect(html.match(/trip-stone trip-stone-ready/g)).toHaveLength(8);
  });

  it('draws nothing when the trip needs nothing', () => {
    expect(renderToStaticMarkup(<TripJourneyLine pkg={pkg([])} />)).toBe('');
  });

  it('gives each gap one line and one button, Add for a missing item and Fix for the rest', () => {
    const html = renderToStaticMarkup(
      <TripJourneyLine pkg={MIXED} itemHref={(id: string) => `?item=${id}#readiness`} />,
    );
    expect(html.match(/<li class="trip-gap"/g)).toHaveLength(3);
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html).toContain('Missing.');
    expect(html).toContain('Out of Date.');
    expect(html).toContain('>Add</a>');
    expect(html.match(/>Fix<\/a>/g)).toHaveLength(2);
    expect(html).toContain('href="?item=00000000-0000-4000-8000-000000000002#readiness"');
  });

  it('keeps every gap row inside one named scroll area in the card, so a long list never lengthens the page', () => {
    const many = pkg(Array.from({ length: 7 }, (_, i) => item(i + 1, `doc_${i}`, 'CRITICAL_GAP')));
    const html = renderToStaticMarkup(<TripJourneyLine pkg={many} />);
    expect(html.match(/<li class="trip-gap"/g)).toHaveLength(7);
    expect(html).toContain('class="trip-gaps" aria-label="What Is Missing" tabindex="0"');
    expect(html).not.toContain('More Gaps');
  });

  it('shows no gap rows when nothing is missing', () => {
    const html = renderToStaticMarkup(
      <TripJourneyLine pkg={pkg([item(1, 'passport', 'SATISFIED')])} />,
    );
    expect(html).not.toContain('trip-gaps');
  });

  it('shows Outside VisaStack as one row of four pictures, each with its full sentence in an Explain popup', () => {
    const html = renderToStaticMarkup(<OutsideVisaStackRow steps={OUTSIDE} />);
    expect(html.match(/trip-outside-tile/g)).toHaveLength(4);
    for (const name of ['Form', 'Book', 'Bring', 'Pay']) {
      expect(html).toContain(`<span class="sr-only">${name}</span>`);
    }
    for (const step of OUTSIDE.slice(0, 4)) expect(html).toContain(step.label);
    expect(html).toContain('role="tooltip"');
    // A step the checklist adds stays as a line, so nothing is lost.
    expect(html).toContain('Get any translation the authority asks for.');
  });

  it('keeps the Trip Package words: nothing is sent until the person shares it', () => {
    const html = renderToStaticMarkup(
      <PackagePanel pkg={MIXED} listedIds={new Set(MIXED.items.map((i) => i.packRequirementId))} />,
    );
    expect(html).toContain('nothing is sent until you share it yourself');
    expect(html).toContain('Outside VisaStack');
    expect(html).toContain(
      'VisaStack does not do these for you. Check the official source for this trip.',
    );
    expect(html).not.toContain('trip-gaps');
    expect(html).not.toContain('<li>Fill in and send');
  });

  it('passes the automated accessibility rules', async () => {
    const html = renderToStaticMarkup(
      <div>
        <h1>Case</h1>
        <div id="readiness" />
        <TripJourneyLine pkg={MIXED} />
        <h2>Trip Package</h2>
        <OutsideVisaStackRow steps={OUTSIDE} />
      </div>,
    );
    expect(await axeViolations(html)).toEqual([]);
  });
});
