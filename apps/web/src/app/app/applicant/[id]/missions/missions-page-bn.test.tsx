import { JSDOM } from 'jsdom';
import { afterAll, beforeEach, describe, it, expect as realExpect, vi } from 'vitest';
import { levelContaining } from '../../../../../lib/ccd/reveal';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';

// Renders every state of the sibling page test under Bengali. That test asserts the English wording;
// here the point is that each released Bengali message resolves and renders, with no raw key or
// placeholder left behind. The sibling's checks are not repeated, so \`expect\` is a no-op below.
const bnState = vi.hoisted(() => ({ holder: null as unknown, rendered: [] as string[] }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => 'bn' }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    bnState.holder ??= build();
    return bnState.holder;
  },
}));
vi.mock('../../../../../lib/next-mocks.test-support', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../../lib/next-mocks.test-support')>();
  return {
    ...real,
    renderServer: async (...args: Parameters<typeof real.renderServer>) => {
      const html = await real.renderServer(...args);
      bnState.rendered.push(html);
      return html;
    },
  };
});
type Noop = { (...args: unknown[]): Noop; [key: string]: Noop };
const noop: Noop = new Proxy((() => noop) as Noop, {
  get: () => noop,
  apply: () => noop,
});
// A rejected render (not found, redirect) is awaited and ignored; every other check is a no-op.
const settle = (value: unknown) =>
  new Proxy(
    {},
    {
      get: () => async () => {
        try {
          await value;
        } catch {
          /* the sibling test asserts the refusal */
        }
      },
    },
  );
// biome-ignore lint/suspicious/noExplicitAny: a stand-in that accepts every matcher
const expect: any = new Proxy(
  (value: unknown) =>
    new Proxy(
      {},
      {
        get: (_target, key) => (key === 'rejects' || key === 'resolves' ? settle(value) : noop),
      },
    ),
  { get: () => noop },
);

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listMissions: vi.fn(),
  hasConsent: vi.fn(),
  computeReadiness: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./create-mission-form', () => ({ CreateMissionForm: stub('CreateMissionForm') }));

const { default: CasesPage } = await import('./page');

const render = async () => renderServer(CasesPage({ params: Promise.resolve({ id: 'person' }) }));
const levelOfForm = (html: string) => {
  const doc = new JSDOM(html).window.document;
  const form = doc.querySelector<HTMLElement>('#start-case');
  const scope = doc.querySelector<HTMLElement>('[data-depth-scope]');
  expect(form).not.toBeNull();
  return levelContaining(form as HTMLElement, scope as HTMLElement);
};

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    ownerAccountId: 'owner',
  });
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.hasConsent.mockResolvedValue(true);
});

describe('the Cases page on three levels (CCD-4)', () => {
  it('shows the Start a Case form at Browse while there are no cases', async () => {
    expect(levelOfForm(await render())).toBe('browse');
  });

  it('keeps the form at Everything once there is a case, and names the case being worked on', async () => {
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'c1',
          title: 'Japan Visit',
          state: 'IN_PROGRESS',
          packVersionId: null,
          updatedAt: new Date(),
        },
      ],
    });
    const html = await render();
    expect(levelOfForm(html)).toBe('everything');
    expect(textOf(html)).toContain('Your case: Japan Visit');
  });

  it('says the cases could not be loaded instead of claiming there is none', async () => {
    service.listMissions.mockResolvedValue({ ok: false, error: { code: 'upstream_error' } });
    const text = textOf(await render());
    expect(text).toContain('Your cases could not be loaded. Refresh to try again.');
    expect(text).not.toContain('No active case yet.');
    expect(text).not.toContain('No Cases Yet');
    expect(levelOfForm(await render())).toBe('everything');
  });
});

type CaseRow = {
  id: string;
  title: string;
  state: string;
  packVersionId: string | null;
  updatedAt: Date;
};
const day = (n: number) => new Date(Date.UTC(2026, 9, n));
const open = (id: string, n: number): CaseRow => ({
  id,
  title: `Open ${id}`,
  state: 'IN_PROGRESS',
  packVersionId: null,
  updatedAt: day(n),
});
const finished = (id: string, n: number, state = 'CLOSED'): CaseRow => ({
  id,
  title: `Past ${id}`,
  state,
  packVersionId: null,
  updatedAt: day(n),
});
const withCases = (rows: CaseRow[]) =>
  service.listMissions.mockResolvedValue({ ok: true, value: rows });
const parse = (html: string) => new JSDOM(html).window.document;
const section = (doc: Document, name: string) =>
  doc.querySelector<HTMLElement>(`[data-case-group="${name}"]`);
const titlesIn = (element: HTMLElement | null) =>
  [...(element?.querySelectorAll('.trip-card-title') ?? [])].map((node) =>
    (node.textContent ?? '').trim(),
  );

describe('Active and Past Trips (LC-G2, P12)', () => {
  it('with no case at all, shows Active (0) with the empty state and no Past Trips', async () => {
    const doc = parse(await render());
    expect(section(doc, 'active')?.textContent).toContain('Active (0)');
    expect(section(doc, 'active')?.textContent).toContain('No Cases Yet');
    expect(section(doc, 'past')).toBeNull();
    expect(doc.body.textContent).not.toContain('All Cases');
  });

  it('with one open case and none finished, lists it under Active (1) only', async () => {
    withCases([open('a', 3)]);
    const doc = parse(await render());
    expect(titlesIn(section(doc, 'active'))).toEqual(['Open a']);
    expect(section(doc, 'past')).toBeNull();
  });

  it('puts many open cases first, newest first, and many finished ones under a folded Past Trips', async () => {
    withCases([
      finished('p1', 1),
      open('a', 2),
      finished('p2', 9, 'CANCELLED'),
      open('b', 8),
      finished('p3', 4),
      open('c', 5),
      finished('p4', 6),
    ]);
    const doc = parse(await render());
    const active = section(doc, 'active');
    const past = section(doc, 'past');
    expect(titlesIn(active)).toEqual(['Open b', 'Open c', 'Open a']);
    expect(titlesIn(past)).toEqual(['Past p2', 'Past p4', 'Past p3', 'Past p1']);
    // Active comes before Past Trips in reading order.
    expect(
      (active as HTMLElement).compareDocumentPosition(past as HTMLElement) &
        4 /* DOCUMENT_POSITION_FOLLOWING */,
    ).toBeTruthy();
    expect(active?.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Active (3)',
    );
    expect(past?.tagName).toBe('DETAILS');
    expect(past?.hasAttribute('open')).toBe(false);
    expect(past?.querySelector('summary')?.textContent).toBe('Past Trips (4)');
    // Each past row keeps its stage chip.
    const chips = [...(past?.querySelectorAll('.case-chip') ?? [])].map((n) => n.textContent ?? '');
    expect(chips[0]).toBe('Cancelled');
    expect(chips[1]).toBe('Closed');
  });

  it('folds finished cases away whatever their number, and keeps them reachable', async () => {
    withCases([open('a', 7), finished('p1', 1), finished('p2', 2), finished('p3', 3)]);
    const past = section(parse(await render()), 'past');
    expect(titlesIn(past)).toEqual(['Past p3', 'Past p2', 'Past p1']);
    expect(past?.tagName).toBe('DETAILS');
    expect(past?.hasAttribute('open')).toBe(false);
    expect(past?.querySelector('summary')?.textContent).toBe('Past Trips (3)');
  });

  it('with one finished case and none open, says no case is being worked on and lists the past one', async () => {
    withCases([finished('p1', 1)]);
    const doc = parse(await render());
    const active = section(doc, 'active');
    expect(titlesIn(active)).toEqual([]);
    expect(active?.textContent).toContain('No case is being worked on right now.');
    expect(active?.textContent).not.toContain('No Cases Yet');
    expect(titlesIn(section(doc, 'past'))).toEqual(['Past p1']);
    expect(textOf(doc.body.outerHTML)).toContain('No active case yet.');
    // Nothing is being worked on, so the Start a Case form is not tucked away.
    expect(levelOfForm(doc.body.outerHTML)).toBe('browse');
  });

  it('keeps both groups at the Browse level and the Your case line at Glance', async () => {
    withCases([open('a', 2), finished('p1', 1)]);
    const doc = parse(await render());
    const scope = doc.querySelector<HTMLElement>('[data-depth-scope]') as HTMLElement;
    expect(levelContaining(section(doc, 'active') as HTMLElement, scope)).toBe('browse');
    expect(levelContaining(section(doc, 'past') as HTMLElement, scope)).toBe('browse');
    expect(textOf(doc.body.outerHTML)).toContain('Your case: Open a');
  });

  it('works out readiness for open cases first, so a long history never pushes them out', async () => {
    const past = Array.from({ length: 30 }, (_, i) => ({
      ...finished(`p${i}`, 1),
      packVersionId: 'pack',
    }));
    withCases([...past, { ...open('a', 2), packVersionId: 'pack' }]);
    service.computeReadiness.mockResolvedValue({ ok: false, error: { code: 'x' } });
    await render();
    const asked = service.computeReadiness.mock.calls.map((call) => call[1]);
    expect(asked).toContain('a');
    expect(asked).toHaveLength(25);
  });

  it('never shows the word mission', async () => {
    withCases([
      open('a', 2),
      finished('p1', 1),
      finished('p2', 1),
      finished('p3', 1),
      finished('p4', 1),
    ]);
    expect(textOf(await render()).toLowerCase()).not.toContain('mission');
  });

  it('draws every case as one card with its flag, country, stage, count and next step', async () => {
    service.computeReadiness.mockResolvedValue({
      ok: true,
      value: {
        requiredCount: 8,
        satisfiedRequired: 6,
        missing: [
          { kind: 'DOCUMENT', key: 'bank_statement', optional: false, reason: 'not_provided' },
        ],
      },
    });
    withCases([
      {
        ...open('jp', 5),
        title: 'Tokyo Trip',
        state: 'INTAKE',
        destination: 'Japan',
        purpose: 'Tourism',
        packVersionId: 'pack',
      } as CaseRow,
      { ...open('kr', 4), state: 'DRAFT', destination: 'Not sure yet' } as CaseRow,
      { ...finished('old', 1), destination: 'Japan' } as CaseRow,
    ]);
    const doc = parse(await render());
    const jp = doc.querySelector('[data-case-id="jp"]') as HTMLElement;
    expect(jp.getAttribute('href')).toBe('/app/mission/jp');
    expect(jp.getAttribute('aria-label')).toBe(
      'Tokyo Trip, Gathering Documents, 6 of 8 ready, Next: Add Bank Statement',
    );
    expect(jp.querySelector('.country-flag')?.getAttribute('data-size')).toBe('lg');
    expect(jp.querySelector('.trip-card-sub')?.textContent).toBe('Japan \u00b7 Tourism');
    // The purpose picture sits in front of the purpose word, and says nothing to a screen reader.
    const picture = jp.querySelector('.trip-card-purpose .mark-tile');
    expect(picture?.getAttribute('data-mark')).toBe('tripTourist');
    expect(picture?.getAttribute('aria-hidden')).toBe('true');
    expect(jp.querySelector('.trip-card-purpose')?.nextSibling?.textContent).toBe('Tourism');
    expect(jp.querySelector('.trip-card-count')?.textContent).toBe('6 of 8 ready');
    expect(jp.querySelector('.trip-card-next')?.textContent).toBe('Next: Add Bank Statement');
    // No checklist: no bar, picking one is the step; a destination that names no country has no flag.
    const kr = doc.querySelector('[data-case-id="kr"]') as HTMLElement;
    expect(kr.querySelector('progress')).toBeNull();
    expect(kr.querySelector('.trip-card-next')?.textContent).toBe('Next: Pick a Checklist');
    expect(kr.querySelector('.country-flag-unknown')).not.toBeNull();
    // No purpose saved: no picture, and no empty slot.
    expect(kr.querySelector('.trip-card-purpose')).toBeNull();
    // A finished case gets no advice.
    const old = doc.querySelector('[data-case-id="old"]') as HTMLElement;
    expect(old.querySelector('.trip-card-next')).toBeNull();
    expect(section(doc, 'past')?.textContent).not.toContain('Pick a Checklist');
  });

  it('leads the main button to Start a Trip with this traveller chosen, and keeps the by-name form', async () => {
    const doc = parse(await render());
    const hrefs = [...doc.querySelectorAll('a')]
      .filter((a) => a.textContent === 'Start a Trip')
      .map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hrefs)).toEqual(new Set(['/app/mission/start?traveller=person']));
    const card = doc.querySelector('#start-case') as HTMLElement;
    const fold = card.querySelector('details');
    expect(fold?.querySelector('summary')?.textContent).toBe(
      'Not Sure Where Yet? Add a Case by Name',
    );
    // The old form is still there, inside the fold, so no capability is lost.
    expect(fold?.querySelector('[data-stub="CreateMissionForm"]')).not.toBeNull();
    expect(fold?.hasAttribute('open')).toBe(false);
  });

  it('opens the by-name form when the person arrives from Start a Trip not knowing the country', async () => {
    const html = await renderServer(
      CasesPage({
        params: Promise.resolve({ id: 'person' }),
        searchParams: Promise.resolve({ manual: '1' }),
      }),
    );
    const card = new JSDOM(html).window.document.querySelector('#start-case') as HTMLElement;
    expect(card.querySelector('details')?.hasAttribute('open')).toBe(true);
  });

  it('with processing off, says what to turn on, links to the switch and offers no trip yet', async () => {
    service.hasConsent.mockResolvedValue(false);
    const doc = parse(await render());
    const card = doc.querySelector('#start-case') as HTMLElement;
    expect(card.textContent).toContain('Let VisaStack Process My Details');
    expect(card.querySelector('a[href="/app#permissions"]')?.textContent).toBe('Home');
    expect(card.querySelector('details')).toBeNull();
    expect([...doc.querySelectorAll('a')].some((a) => a.textContent === 'Start a Trip')).toBe(
      false,
    );
  });
});

afterAll(() => {
  const all = bnState.rendered.join(' ');
  realExpect(bnState.rendered.length).toBeGreaterThan(0);
  realExpect(all).toMatch(/[ঀ-৿]/);
  realExpect(all).not.toMatch(/\bapplicant[A-Z][A-Za-z]+\.app[A-Z]/);
});
