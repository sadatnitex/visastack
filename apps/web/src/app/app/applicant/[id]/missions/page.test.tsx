import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelContaining } from '../../../../../lib/ccd/reveal';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';

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
  [...(element?.querySelectorAll('.row-link .row-key') ?? [])].map((node) =>
    (node.firstChild?.textContent ?? '').trim(),
  );

describe('Active Cases and Past Cases (LC-G2)', () => {
  it('with no case at all, shows Active Cases with the empty state and no Past Cases', async () => {
    const doc = parse(await render());
    expect(section(doc, 'active')?.textContent).toContain('Active Cases');
    expect(section(doc, 'active')?.textContent).toContain('No Cases Yet');
    expect(section(doc, 'past')).toBeNull();
    expect(doc.body.textContent).not.toContain('All Cases');
  });

  it('with one open case and none finished, lists it under Active Cases only', async () => {
    withCases([open('a', 3)]);
    const doc = parse(await render());
    expect(titlesIn(section(doc, 'active'))).toEqual(['Open a']);
    expect(section(doc, 'past')).toBeNull();
  });

  it('puts many open cases first, newest first, and many finished ones under a closed Past Cases', async () => {
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
    // Active Cases comes before Past Cases in reading order.
    expect(
      (active as HTMLElement).compareDocumentPosition(past as HTMLElement) &
        4 /* DOCUMENT_POSITION_FOLLOWING */,
    ).toBeTruthy();
    expect(past?.querySelector('h2')?.textContent).toBe('Past Cases');
    const fold = past?.querySelector('details');
    expect(fold).not.toBeNull();
    expect(fold?.hasAttribute('open')).toBe(false);
    expect(fold?.querySelector('.collapsible-group-title')?.textContent).toBe('All Past Cases');
    expect(fold?.querySelector('summary')?.textContent).toContain('4 cases');
    // Each past row keeps its stage badge.
    const badges = [...(past?.querySelectorAll('.row-end') ?? [])].map((n) => n.textContent ?? '');
    expect(badges[0]).toContain('Cancelled');
    expect(badges[1]).toContain('Closed');
  });

  it('shows up to three finished cases without folding them away', async () => {
    withCases([open('a', 7), finished('p1', 1), finished('p2', 2), finished('p3', 3)]);
    const past = section(parse(await render()), 'past');
    expect(titlesIn(past)).toEqual(['Past p3', 'Past p2', 'Past p1']);
    expect(past?.querySelector('details')).toBeNull();
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
});
