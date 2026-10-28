import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
}
