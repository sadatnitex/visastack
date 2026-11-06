import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROSE_WORD_BUDGET, countProse } from '../prose-budget.test-support';
import { APPROVED_CHANGES, APPROVED_RULES } from './approved-changes';
import {
  type InventoryEntry,
  badLevelWords,
  entryKey,
  headingProblems,
  inventory,
} from './inventory';

/**
 * Nothing is lost (ADR 0023). A screen is rendered in every state a person can meet, at the
 * deepest level, and compared with the inventory captured from the screen as it was before the
 * change (baseline/<screen>.json). Every old element must still be there with the same name,
 * unless the owner approved the change (approved-changes.ts). Run with CCD_CAPTURE=1 on the old
 * screen to write a baseline; never to make a failing comparison pass.
 */

export interface ParityState {
  readonly name: string;
  readonly setup: () => void;
}

const CAPTURE_FLAG = 'CCD_CAPTURE';
const BASELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'baseline');

/**
 * The 30-word rule (Owner, 5 Nov 2026) for every converted screen in every state it can be in.
 * A state is held to 30 words of explanation at a phone's default depth. A state that is still
 * over has a recorded ceiling in prose-limits.json: it may not grow, and the ceiling must come
 * down when the words do. Every screen is held to 30 on a desktop as well (Owner, 6 Nov 2026), so
 * a ceiling is only a place to record a state that is still over; none remain.
 */
const LIMITS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'prose-limits.json');
const MEASURE_VARIABLE = 'PROSE_MEASURE';
/** Every screen is held to 30 words at every width (Owner, 6 Nov 2026): no recorded ceilings remain. */
const HELD_AT_DESKTOP: ReadonlySet<string> | 'all' = 'all';
type Ceilings = Record<string, Record<string, { phone?: number; desktop?: number }>>;

export function registerParity(screen: {
  readonly name: string;
  readonly states: readonly ParityState[];
  readonly reset: () => void;
  readonly render: () => Promise<string>;
}): void {
  const html = async (state: ParityState) => {
    screen.reset();
    state.setup();
    return `<main>${await screen.render()}</main>`;
  };

  if (process.env[CAPTURE_FLAG]) {
    describe(`capture the ${screen.name} baseline`, () => {
      it('writes the inventory of every state', async () => {
        const captured: Record<string, InventoryEntry[]> = {};
        for (const state of screen.states) captured[state.name] = inventory(await html(state));
        mkdirSync(BASELINE_DIR, { recursive: true });
        writeFileSync(
          join(BASELINE_DIR, `${screen.name}.json`),
          `${JSON.stringify(captured, null, 2)}\n`,
        );
      });
    });
    return;
  }

  describe(`${screen.name}: every element that existed before is still on the screen`, () => {
    const baseline = JSON.parse(
      readFileSync(join(BASELINE_DIR, `${screen.name}.json`), 'utf8'),
    ) as Record<string, InventoryEntry[]>;
    const approved = APPROVED_CHANGES.filter((change) => change.screen === screen.name);
    const rules = APPROVED_RULES.filter((rule) => rule.screens.includes(screen.name));
    it.each(screen.states.map((s) => [s.name, s] as const))('%s', async (_name, state) => {
      // Counted, not just present: two identical buttons before must still be two after.
      const now = new Map<string, number>();
      for (const key of inventory(await html(state)).map(entryKey)) {
        now.set(key, (now.get(key) ?? 0) + 1);
      }
      const before = baseline[state.name] ?? [];
      const missing = before
        .filter((entry) => {
          const change = approved.find((c) => entryKey(c.from) === entryKey(entry));
          const replacement = change?.to;
          const wanted =
            change === undefined
              ? entry
              : typeof replacement === 'function'
                ? replacement(state.name)
                : (replacement ?? null);
          if (wanted === null) return false;
          const forms = [wanted, ...rules.flatMap((rule) => rule.alternatives(wanted))].map(
            entryKey,
          );
          const found = forms.find((key) => (now.get(key) ?? 0) > 0);
          if (found === undefined) return true;
          now.set(found, (now.get(found) ?? 0) - 1);
          return false;
        })
        .map(entryKey);
      expect(missing).toEqual([]);
      expect(before.length).toBeGreaterThan(0);
    });
  });

  describe(`${screen.name}: the rules every converted screen follows`, () => {
    it.each(screen.states.map((s) => [s.name, s] as const))(
      '%s has one h1, no skipped levels and only real level words',
      async (_name, state) => {
        const page = await html(state);
        expect(headingProblems(page)).toEqual([]);
        expect(badLevelWords(page)).toEqual([]);
      },
    );
  });

  describe(`${screen.name}: the 30-word rule`, () => {
    const ceilings = (JSON.parse(readFileSync(LIMITS_PATH, 'utf8')) as Ceilings)[screen.name] ?? {};
    it('has no recorded ceiling for a state that no longer exists', () => {
      const known = new Set(screen.states.map((s) => s.name));
      expect(Object.keys(ceilings).filter((name) => !known.has(name))).toEqual([]);
    });
    it.each(screen.states.map((s) => [s.name, s] as const))(
      '%s shows at most 30 words of explanation (and no recorded ceiling goes up)',
      async (_name, state) => {
        const page = await html(state);
        // Both views are measured before anything is asserted, so a measurement run sees every one.
        const reports = (['phone', 'desktop'] as const).map((viewport) => {
          const report = countProse(page, { viewport });
          const measureFile = process.env[MEASURE_VARIABLE];
          if (measureFile) {
            appendFileSync(
              measureFile,
              `${JSON.stringify({ screen: screen.name, state: state.name, viewport, words: report.words, passages: report.passages })}\n`,
            );
          }
          return { viewport, report };
        });
        const failures: string[] = [];
        for (const { viewport, report } of reports) {
          const held =
            viewport === 'phone' || HELD_AT_DESKTOP === 'all' || HELD_AT_DESKTOP.has(screen.name);
          const ceiling = ceilings[state.name]?.[viewport];
          const where = `${screen.name} / ${state.name} / ${viewport}`;
          if (report.problems.length > 0) failures.push(`${where}: ${report.problems.join('; ')}`);
          if (held) {
            // Held to 30: no recorded ceiling is allowed to stand in for the rule.
            if (ceiling !== undefined) failures.push(`${where}: a held screen has no ceiling`);
            if (report.words > PROSE_WORD_BUDGET) {
              failures.push(`${where} shows ${report.words} words (limit ${PROSE_WORD_BUDGET})`);
            }
          } else if (ceiling === undefined) {
            if (report.words > PROSE_WORD_BUDGET) {
              failures.push(
                `${where}: ${report.words} words needs a recorded ceiling in prose-limits.json`,
              );
            }
          } else if (report.words > ceiling) {
            failures.push(
              `${where}: ${report.words} words is over its recorded ceiling ${ceiling}`,
            );
          } else if (ceiling <= PROSE_WORD_BUDGET) {
            failures.push(
              `${where}: a ceiling of ${ceiling} is at or under 30, remove it from prose-limits.json`,
            );
          } else if (report.words !== ceiling) {
            failures.push(
              `${where}: lower its ceiling from ${ceiling} to ${report.words} in prose-limits.json (remove it when 30 or fewer)`,
            );
          }
        }
        expect(failures).toEqual([]);
      },
    );
  });
}
