import type { TripCheck } from '@visastack/core';
import type { Mission } from '@visastack/services';
import { JSDOM } from 'jsdom';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { stub } from '../../../../lib/next-mocks.test-support';

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
vi.mock('./attach-pack-form', () => ({ AttachPackForm: stub('AttachPackForm') }));
vi.mock('./mission-buttons', () => ({
  CaseDetailsForm: stub('CaseDetailsForm'),
  ItineraryForm: stub('ItineraryForm'),
  TransitionButtons: stub('TransitionButtons'),
}));

const { CaseRail, CaseTripChecks } = await import('./case-rail');
type RailProps = ComponentProps<typeof CaseRail>;

/**
 * The case rail on its own (WP-LIFT-B): the order of its cards, the ids and depth levels the page's
 * links rely on, the Trip Date Checks and Sources that live inside it, the one-row fold each card
 * becomes on a phone, and the empty and filled states of each card.
 */

const mission = (extra: Record<string, unknown> = {}): Mission =>
  ({
    id: 'case-1',
    title: 'Japan visitor visa',
    jurisdiction: 'Japan Visa Application Centre, Dhaka',
    serviceCategory: 'Tourist visa',
    travelStartDate: new Date('2027-03-14T00:00:00Z'),
    travelEndDate: new Date('2027-03-28T00:00:00Z'),
    targetDeadline: null,
    packVersionId: 'pv-1',
    itineraryRef: null,
    manualMode: false,
    ...extra,
  }) as unknown as Mission;

const CHECKS: readonly TripCheck[] = [
  { key: 'passport_validity', level: 'ok', title: 'Passport validity', detail: 'Fine.' },
  { key: 'insurance_cover', level: 'check', title: 'Travel insurance cover', detail: 'None.' },
];

const props = (extra: Record<string, unknown> = {}): RailProps =>
  ({
    mission: mission(),
    applicantId: 'person-1',
    packInfo: {
      name: 'Japan Temporary Visitor Visa (Tourism)',
      badge: 'Official Requirement Pack',
      reviewed: true,
      coverage: 'For travel to Japan · Tourism',
      notice: null,
      effectiveDate: '2026-07-01',
    },
    packOptions: [],
    noChecklistLines: [],
    primaryAttach: false,
    nextStates: ['READY_FOR_REVIEW', 'CANCELLED'] as never,
    stageStates: ['READY_FOR_REVIEW'] as never,
    snapshots: [{ id: 'snap-1', version: 1, checksum: 'a1b2c3d4e5f60718', content: {} }],
    moreSnapshots: false,
    linkedMissions: [],
    tripChecks: {
      view: 'checks' as const,
      checks: CHECKS,
    },
    sources: [
      {
        href: 'https://example.test/rules',
        name: 'Embassy of Japan',
        checkedAt: '2026-11-01',
        inEffectSince: '2026-07-01',
      },
    ],
    ...extra,
  }) as unknown as RailProps;

const dom = (element: React.ReactElement) =>
  new JSDOM(`<body>${renderToStaticMarkup(element)}</body>`).window.document;

const rail = (extra: Record<string, unknown> = {}) => dom(<CaseRail {...props(extra)} />);

/** The fold (the one-row details) that holds the element with this id. */
const foldOf = (doc: Document, id: string) => doc.getElementById(id)?.closest('details') ?? null;

const words = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the case rail', () => {
  it('lists its cards in order: details, date checks, pack, advance, snapshots, itinerary', () => {
    const doc = rail();
    const headings = [...doc.querySelectorAll('aside h2')].map((h) => words(h));
    expect(headings).toEqual([
      'Case Details',
      'Trip Date Checks',
      'Requirement Pack',
      'Advance the Case',
      'Snapshots',
      'Itinerary Reference',
    ]);
  });

  it('keeps the ids and depth levels the page links to', () => {
    const doc = rail();
    const level = (id: string) => foldOf(doc, id)?.getAttribute('data-level');
    expect(level('trip-checks')).toBe('browse');
    expect(level('pack')).toBe('browse');
    expect(level('snapshots')).toBe('everything');
    expect(doc.querySelector('aside')?.getAttribute('data-level')).toBe('browse');
    expect(doc.querySelectorAll('#pack, #trip-checks, #snapshots')).toHaveLength(3);
  });

  it('puts each anchor on the card inside its row, never on the row, so a link to it opens the row', () => {
    const doc = rail();
    for (const id of ['trip-checks', 'pack', 'snapshots']) {
      const target = doc.getElementById(id);
      const fold = target?.closest('details');
      expect(fold, id).not.toBeNull();
      expect(fold?.id, id).toBe('');
      // Inside the closed row, after the summary the browser leaves showing.
      expect(target?.parentElement, id).toBe(fold);
      expect(target?.previousElementSibling?.tagName, id).toBe('SUMMARY');
    }
  });

  it('starts the date checks open on a phone when a check needs a look or a fix, closed when all is fine', () => {
    const open = (checks: unknown) =>
      foldOf(rail({ tripChecks: { view: 'checks', checks } }), 'trip-checks')?.hasAttribute('open');
    const fine = { key: 'passport_validity', level: 'ok', title: 'Passport', detail: 'x' };
    expect(open([fine])).toBe(false);
    expect(open([fine, { ...fine, key: 'insurance_cover', level: 'check' }])).toBe(true);
    expect(open([{ ...fine, level: 'problem' }])).toBe(true);
    expect(open([{ ...fine, level: 'unknown' }])).toBe(false);
    expect(open(null)).toBe(false);
  });

  it('makes every card one native fold whose first child is its summary row', () => {
    const doc = rail();
    const folds = [...doc.querySelectorAll('aside > details.lift-fold')];
    expect(folds).toHaveLength(6);
    for (const fold of folds) {
      expect(fold.firstElementChild?.tagName).toBe('SUMMARY');
      expect(fold.querySelector(':scope > .lift-fold-body h2')).not.toBeNull();
    }
    // The summary row names the card the same way the card names itself.
    const names = folds.map((f) => words(f.querySelector('.lift-action-title')));
    expect(names).toEqual([
      'Case Details',
      'Trip Date Checks',
      'Requirement Pack',
      'Advance the Case',
      'Snapshots',
      'Itinerary Reference',
    ]);
  });

  it('says in the row what is inside, so a phone shows the state without opening anything', () => {
    const doc = rail();
    const meta = (id: string) => words(foldOf(doc, id)?.querySelector('.lift-action-meta'));
    expect(meta('trip-checks')).toBe('2 checks on your trip dates');
    expect(words(foldOf(doc, 'trip-checks')?.querySelector('.lift-action-pill'))).toBe(
      'Take a Look',
    );
    expect(meta('pack')).toBe('Japan Temporary Visitor Visa (Tourism)');
    expect(words(foldOf(doc, 'pack')?.querySelector('.lift-action-pill'))).toBe('Reviewed');
    expect(meta('snapshots')).toBe('1 saved');
    const advance = [...doc.querySelectorAll('aside > details')].find((d) =>
      words(d.querySelector('summary')).startsWith('Advance the Case'),
    );
    expect(words(advance?.querySelector('.lift-action-meta'))).toBe('Next: Ready for Review');
  });

  it('shows the dates as a row, the deadline only when one is set, and the place first', () => {
    let doc = rail();
    const facts = [...doc.querySelectorAll('.lift-fact')].map((p) => words(p));
    expect(facts).toEqual([
      'Japan Visa Application Centre, Dhaka · Tourist visa',
      'Mar 14, 2027 to Mar 28, 2027',
    ]);
    doc = rail({ mission: mission({ targetDeadline: new Date('2027-01-20T00:00:00Z') }) });
    expect(words(doc.querySelectorAll('.lift-fact')[2])).toBe('Target deadline: Jan 20, 2027');
  });

  it('puts the add-your-dates hint under Case Details when the case has no dates', () => {
    const doc = rail({
      mission: mission({ travelStartDate: null, travelEndDate: null }),
      tripChecks: { view: 'add-dates', checks: null },
    });
    const details = doc.querySelector('aside > details');
    expect(words(details)).toContain('Travel dates not set');
    expect(words(details?.querySelector('.lift-rail-note'))).toBe(
      'Add your travel dates under Edit Case Details to see passport and insurance date checks.',
    );
    expect(doc.querySelector('#trip-checks')).toBeNull();
  });

  it('shows no date card and no hint when the stage has no date checks', () => {
    const doc = rail({ tripChecks: { view: 'none', checks: null } });
    expect(doc.querySelector('#trip-checks')).toBeNull();
    expect(words(doc.body)).not.toContain('Add your travel dates');
  });

  it('shows the sources under the pack, once, with their dates', () => {
    const doc = rail();
    const pack = foldOf(doc, 'pack');
    expect(pack?.querySelectorAll('h3')).toHaveLength(1);
    expect(words(pack?.querySelector('h3'))).toBe('Sources for This Checklist');
    expect(doc.querySelectorAll('#case-sources-heading')).toHaveLength(1);
    const link = pack?.querySelector('li a');
    expect(link?.getAttribute('href')).toBe('https://example.test/rules');
    expect(link?.getAttribute('rel')).toBe('noreferrer');
    expect(words(pack?.querySelector('li'))).toContain('Checked: Nov 1, 2026');
    expect(words(pack?.querySelector('li'))).toContain('In Effect Since: Jul 1, 2026');
    expect(words(pack)).toContain('Always confirm the final requirements');
  });

  it('leaves the date checks and sources to the page when they are not passed in', () => {
    const doc = rail({ tripChecks: undefined, sources: undefined });
    expect(doc.querySelector('#trip-checks')).toBeNull();
    expect(doc.querySelector('.case-sources')).toBeNull();
    // The page's own copy of the card still has the same look and ids.
    const standalone = dom(<CaseTripChecks view="checks" checks={CHECKS} />);
    expect(standalone.querySelector('#trip-checks h2')?.textContent).toBe('Trip Date Checks');
  });

  it('opens the pack row for a case with no checklist, and offers the picker', () => {
    const doc = rail({
      mission: mission({ packVersionId: null }),
      packInfo: null,
      packOptions: [{ packVersionId: 'pv-9', label: 'Japan Visitor' }],
    });
    const pack = foldOf(doc, 'pack');
    expect(pack?.hasAttribute('open')).toBe(true);
    expect(words(pack)).toContain('Pick a checklist: attach a published requirement pack');
    expect(pack?.querySelector('[data-stub="AttachPackForm"]')).not.toBeNull();
    expect(words(pack?.querySelector('.lift-action-meta'))).toBe('No checklist yet. Pick one.');
  });

  it('says why no checklist can be picked, and promises nothing, when there are none to pick', () => {
    const doc = rail({
      mission: mission({ packVersionId: null }),
      packInfo: null,
      noChecklistLines: ['VisaStack has no reviewed checklist for travel to Japan yet.'],
    });
    expect(words(foldOf(doc, 'pack'))).toContain('no reviewed checklist for travel to Japan');
    expect(words(foldOf(doc, 'pack'))).not.toContain('Pick a checklist: attach');
  });

  it('shows the official page beside the reason, as a link that says VisaStack has not checked it', () => {
    const doc = rail({
      mission: mission({ packVersionId: null, destination: 'Japan' }),
      packInfo: null,
      noChecklistLines: ['VisaStack has no reviewed checklist for travel to Japan yet.'],
    });
    const line = foldOf(doc, 'pack')?.querySelector('.case-official-page');
    expect(line).not.toBeNull();
    const link = line?.querySelector('a');
    expect(link?.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('aria-label')).toBe('Official page for Japan, opens in a new tab');
    expect(words(line)).toBe('Official Page. VisaStack has not checked it.');
  });

  it('shows no official page where there is a checklist, or where we hold none for the place', () => {
    expect(foldOf(rail(), 'pack')?.querySelector('.case-official-page')).toBeNull();
    const unknown = rail({
      mission: mission({ packVersionId: null, destination: 'Nowhere Land' }),
      packInfo: null,
      noChecklistLines: ['VisaStack has no reviewed checklist for travel to Nowhere Land yet.'],
    });
    expect(foldOf(unknown, 'pack')?.querySelector('.case-official-page')).toBeNull();
  });

  it('leaves a pack that is attached closed on a phone', () => {
    expect(foldOf(rail(), 'pack')?.hasAttribute('open')).toBe(false);
  });

  it('lists snapshots as rows that link to each one, marks packets and offers the rest', () => {
    const doc = rail({
      snapshots: [
        { id: 'snap-2', version: 2, checksum: 'ffffffffffff0000', content: {} },
        { id: 'snap-1', version: 1, checksum: 'a1b2c3d4e5f60718', content: {} },
      ],
      moreSnapshots: true,
    });
    const rows = [...(foldOf(doc, 'snapshots')?.querySelectorAll('a.row') ?? [])];
    expect(rows.map((a) => a.getAttribute('href'))).toEqual([
      '/app/mission/case-1/snapshots/snap-2',
      '/app/mission/case-1/snapshots/snap-1',
    ]);
    expect(words(rows[0])).toContain('Version 2');
    const all = [...(foldOf(doc, 'snapshots')?.querySelectorAll('a') ?? [])].find(
      (a) => a.textContent === 'See All Snapshots',
    );
    expect(all?.getAttribute('href')).toBe('/app/mission/case-1/snapshots');
    expect(words(foldOf(doc, 'snapshots')?.querySelector('.lift-action-meta'))).toBe('2+ saved');
  });

  it('says plainly that there are no snapshots yet', () => {
    const doc = rail({ snapshots: [] });
    expect(words(foldOf(doc, 'snapshots'))).toContain('No snapshots yet.');
    expect(words(foldOf(doc, 'snapshots')?.querySelector('.lift-action-meta'))).toBe('None yet');
  });

  it('tucks the family-trip form under a named fold, open once a label is set, and lists linked cases', () => {
    let doc = rail();
    const fold = [...doc.querySelectorAll('details.lift-help')].find(
      (d) => words(d.querySelector('summary')) === 'Link to a Family Trip',
    );
    expect(fold).toBeDefined();
    expect(fold?.hasAttribute('open')).toBe(false);
    expect(fold?.querySelector('[data-stub="ItineraryForm"]')).not.toBeNull();
    doc = rail({
      mission: mission({ itineraryRef: 'Rahman Family Japan 2027' }),
      linkedMissions: [{ id: 'case-2', title: 'Japan visa', applicantName: 'Amina Rahman' }],
    });
    const open = [...doc.querySelectorAll('details.lift-help')].find((d) =>
      d.querySelector('[data-stub="ItineraryForm"]'),
    );
    expect(open?.hasAttribute('open')).toBe(true);
    const linked = doc.querySelector('a[href="/app/mission/case-2"]');
    expect(words(linked)).toContain('Amina Rahman');
    expect(words(doc.querySelector('aside > details:last-of-type .lift-action-meta'))).toBe(
      'Linked: Rahman Family Japan 2027',
    );
  });

  it('says so when there is no stage to move to, and why', () => {
    expect(words(rail({ stageStates: [], nextStates: [] }).body)).toContain(
      'This case is in a terminal state.',
    );
    const doc = rail({ stageStates: [], nextStates: ['CANCELLED'] as never });
    expect(words(doc.body)).toContain('There is no further stage from here.');
    expect(doc.querySelector('[data-stub="TransitionButtons"]')).toBeNull();
  });

  it('has no inline style and no filled button (the page holds the one filled button)', () => {
    const html = renderToStaticMarkup(<CaseRail {...props()} />);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('btn-primary');
  });

  it('passes the automated accessibility rules in each state it can be in', async () => {
    const states = [
      props(),
      props({ mission: mission({ packVersionId: null }), packInfo: null, snapshots: [] }),
      props({ tripChecks: { view: 'add-dates', checks: null }, sources: [] }),
      props({ tripChecks: { view: 'checks', checks: null }, stageStates: [], nextStates: [] }),
    ];
    for (const state of states) {
      const html = `<h1>Case</h1>${renderToStaticMarkup(<CaseRail {...state} />)}`;
      expect(await axeViolations(html)).toEqual([]);
    }
  });
});

describe('the case rail under Bengali (wording signed off 2026-11-12)', () => {
  it('says the itinerary reference is an optional label, in Bengali', async () => {
    const { appMissionCatalog } = await import('../../../../i18n/app-mission');
    const { primeLocale } = await import('../../../../lib/i18n-server');
    loc.holder = null;
    loc.locale = 'bn';
    await primeLocale();
    const html = renderToStaticMarkup(<CaseRail {...props()} />);
    loc.locale = 'en';
    const key = 'appMission.appMissionIdCaseRail.anOptionalLabelLinkingThisCase';
    expect(html).toContain((appMissionCatalog.bn as Record<string, string>)[key]);
    expect(html).not.toContain((appMissionCatalog.en as Record<string, string>)[key]);
  });
});
