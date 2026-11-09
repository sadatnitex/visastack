// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CHIP_WORDS } from '../status-words';
import { isTitleCase } from '../title-case';
import baseline from './pattern-baseline.json';
import { PATTERN_SCREENS } from './pattern-registry';

/**
 * One list pattern across the product (case page plan, section 10). Three parts: the registry is
 * honest about which screens use the kit (static); the rows and panels the kit draws obey the
 * pattern (rendered); and the look is held by `lib/list-pattern-css.test.ts`.
 */

const SRC = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(SRC, file), 'utf8');

vi.mock('../../app/app/mission/[id]/package-actions', () => ({
  recordPackageChoiceAction: vi.fn(),
  markPackageChangeReviewedAction: vi.fn(),
  confirmPackageHandoffAction: vi.fn(),
}));
vi.mock('../../app/app/mission/[id]/wording-editor', async () => {
  const { stub } = await import('../next-mocks.test-support');
  return { WordingEditor: stub('WordingEditor') };
});
vi.mock('../../app/app/mission/[id]/readiness-gap-explain', async () => {
  const { stub } = await import('../next-mocks.test-support');
  return { ExplainGapButton: stub('ExplainGapButton') };
});
vi.mock('../../app/app/mission/[id]/suggest-correction', async () => {
  const { stub } = await import('../next-mocks.test-support');
  return { SuggestCorrection: stub('SuggestCorrection') };
});

describe('the pattern registry (static)', () => {
  it('names real files, and each screen once', () => {
    const names = PATTERN_SCREENS.map((s) => s.screen);
    expect(new Set(names).size).toBe(names.length);
    for (const screen of PATTERN_SCREENS) {
      for (const file of screen.files) {
        expect(existsSync(resolve(SRC, file)), `${screen.screen}: ${file}`).toBe(true);
      }
    }
  });

  it('holds a converted screen to the kit: it imports it and hand-builds no table or row list', () => {
    const converted = PATTERN_SCREENS.filter((s) => s.converted);
    expect(converted.length).toBeGreaterThan(0);
    for (const screen of converted) {
      const sources = screen.files.map(read);
      expect(
        sources.some((source) => /from ['"][^'"]*list-pattern['"]/.test(source)),
        `${screen.screen} imports the list kit`,
      ).toBe(true);
      for (const [index, source] of sources.entries()) {
        expect(source, `${screen.files[index]} has a <table`).not.toMatch(/<table[\s>]/);
        expect(source, `${screen.files[index]} hand-builds a row`).not.toMatch(
          /className=["']row["']/,
        );
      }
    }
  });

  it('holds a partly converted screen to the part it claims: it imports the kit', () => {
    for (const screen of PATTERN_SCREENS.filter((s) => s.partial)) {
      expect(
        screen.files
          .map(read)
          .some((source) => /from ['"][^'"]*list-pattern(?:\/[\w-]+)?['"]/.test(source)),
        `${screen.screen} imports the list kit`,
      ).toBe(true);
    }
  });

  it('lets the number of screens still waiting go down, never up', () => {
    const waiting = PATTERN_SCREENS.filter((s) => !s.converted && s.pattern !== 'exempt').length;
    // Lower pattern-baseline.json when a screen is converted; a new screen must join the kit.
    expect(waiting).toBe(baseline.waiting);
  });

  it('gives every exemption a reason', () => {
    for (const screen of PATTERN_SCREENS.filter((s) => s.pattern === 'exempt')) {
      expect(screen.reason?.length ?? 0, screen.screen).toBeGreaterThan(10);
    }
  });
});

describe('the rows and panels the kit draws (rendered)', () => {
  const ID = (n: number) => `30000000-0000-4000-8000-00000000000${n}`;
  const states = [
    'CRITICAL_GAP',
    'CONFLICTING',
    'EXPIRING_STALE',
    'UNVERIFIED',
    'ATTENTION',
    'SATISFIED',
    'NOT_APPLICABLE',
  ] as const;

  async function draw() {
    const { CaseChecklist, caseItemPanes } = await import(
      '../../app/app/mission/[id]/case-checklist'
    );
    const { ListWithPane } = await import('../../components/list-pattern');
    const rows = states.map((state, i) => ({
      packRequirementId: ID(i + 1),
      kind: 'DOCUMENT' as const,
      key: i % 2 === 0 ? 'PASSPORT' : 'BANK_STATEMENT',
      optional: state === 'ATTENTION',
      state,
      citation: 'Synthetic rule',
      sourceTitle: null,
      sourceUrl: null,
      publisher: null,
      observedDate: null,
      sourceInaccessible: false,
      category: null,
      // One long starter sentence, to prove a row cuts its name.
      ...(i === 0
        ? {
            wording:
              'A passport that is valid for at least six months after the day you plan to arrive, with at least two blank pages in it for stamps.',
          }
        : {}),
    }));
    const given = {
      missionId: '20000000-0000-4000-8000-000000000001',
      applicantId: '10000000-0000-4000-8000-000000000001',
      rows,
      chosenByRequirement: {},
      explanations: { configured: false, off: undefined, byRequirement: new Map() },
      packName: 'Synthetic Checklist',
    };
    return renderToStaticMarkup(
      <ListWithPane
        panes={caseItemPanes({
          ...given,
          packageItems: new Map(),
          packageEditable: false,
          formatLines: {},
        })}
        paneLabel="Item Details"
        backLabel="Back to the Checklist"
        backHref="/app/mission/x#readiness"
      >
        <CaseChecklist
          applicantId={given.applicantId}
          rows={given.rows}
          packName={given.packName}
          itemHref={(id) => `?item=${id}`}
        />
      </ListWithPane>,
    );
  }

  const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

  it('gives every row one status mark, a name of twelve words or fewer, a chip from the one vocabulary and at most one action', async () => {
    const doc = parse(await draw());
    const rows = [...doc.querySelectorAll('[data-pattern="list-row"]')];
    expect(rows).toHaveLength(states.length);
    for (const row of rows) {
      expect(row.querySelectorAll('.lift-check-icon'), 'one status mark').toHaveLength(1);
      expect(
        row.querySelectorAll('.lift-check-action').length,
        'at most one action',
      ).toBeLessThanOrEqual(1);
      const chip = row.querySelector('.lift-pill')?.textContent ?? '';
      expect(CHIP_WORDS.has(chip), `chip word "${chip}"`).toBe(true);
      const name = row.querySelector('[data-value="name"]')?.textContent ?? '';
      expect(name.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
    }
    // The long sentence is cut and marked, and read in full in its panel.
    const long = doc.querySelector('[data-row="30000000-0000-4000-8000-000000000001"]');
    expect(long?.querySelector('[data-value="name"]')?.textContent).toMatch(/…$/);
    expect(long?.querySelector('a[data-pane-open]')?.getAttribute('aria-label')).toContain(
      'two blank pages',
    );
  });

  it('names every folder in Title Case with its count, and draws a folder only when it has rows', async () => {
    const doc = parse(await draw());
    const headings = [...doc.querySelectorAll('[data-pattern="group-heading"]')].map(
      (h) => h.firstChild?.textContent?.trim() ?? '',
    );
    expect(headings).toEqual([
      'Needs You',
      'Needs a Check',
      'Optional',
      'On File',
      'Does Not Apply',
    ]);
    for (const heading of headings) expect(isTitleCase(heading), heading).toBe(true);
  });

  it('gives every panel a heading, and the list one way back from the panel', async () => {
    const doc = parse(await draw());
    const panes = [...doc.querySelectorAll('[data-pattern="detail-pane"]')];
    expect(panes).toHaveLength(states.length);
    for (const pane of panes) {
      expect(pane.querySelector('h3')?.textContent?.length ?? 0, 'panel heading').toBeGreaterThan(
        0,
      );
      expect(pane.hasAttribute('hidden'), 'closed until a row opens it').toBe(true);
    }
    const back = doc.querySelectorAll('.lp-pane-bar a');
    expect(back).toHaveLength(1);
    expect(back[0]?.textContent).toBe('Back to the Checklist');
  });
});
