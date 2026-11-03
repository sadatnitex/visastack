/**
 * UMPE P12 (O06): small-cell and dominance suppression for Field Insights. Pure: no database.
 *
 * A count is shown only when it is large enough that nobody can be picked out of it:
 * - at least `minCell` records (default 10),
 * - from at least `minPeople` different people where people are known (default 5),
 * - and no single contributor (one agency, or one person managing their own cases) supplies more
 *   than `maxShare` of it (default 70 percent), so one agency's pipeline is never exposed.
 * A zero is shown: it says nothing about anyone. Inside a group whose total is published elsewhere,
 * a lone hidden count could be worked out by subtraction, so the next smallest shown count is hidden
 * too (complementary suppression). Aggregation alone never guarantees anonymity; these rules reduce
 * the risk, they do not remove it.
 */

export interface InsightThresholds {
  readonly minCell: number;
  readonly minPeople: number;
  readonly maxShare: number;
}

export const DEFAULT_INSIGHT_THRESHOLDS: InsightThresholds = {
  minCell: 10,
  minPeople: 5,
  maxShare: 0.7,
};

/** Thresholds can be raised, never loosened below these floors. */
export function clampThresholds(input: Partial<InsightThresholds> = {}): InsightThresholds {
  const num = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    minCell: Math.max(5, Math.floor(num(input.minCell, DEFAULT_INSIGHT_THRESHOLDS.minCell))),
    minPeople: Math.max(3, Math.floor(num(input.minPeople, DEFAULT_INSIGHT_THRESHOLDS.minPeople))),
    maxShare: Math.min(
      0.9,
      Math.max(0.3, num(input.maxShare, DEFAULT_INSIGHT_THRESHOLDS.maxShare)),
    ),
  };
}

/** One record counted in a cell: who supplied it, and whose it is when that is known. */
export interface CountedRecord {
  readonly cell: string;
  readonly contributor: string;
  readonly person: string | null;
}

export interface CellTally {
  readonly count: number;
  /** Distinct people, or null when the records carry no person (an invitation, say). */
  readonly people: number | null;
  /** Records from the largest single contributor. */
  readonly top: number;
}

export type Cell =
  | { readonly shown: true; readonly value: number }
  | { readonly shown: false; readonly reason: 'SMALL' | 'DOMINANT' | 'COMPLEMENTARY' };

export const EMPTY_TALLY: CellTally = { count: 0, people: 0, top: 0 };

/** Tallies records per cell. */
export function tally(records: Iterable<CountedRecord>): Map<string, CellTally> {
  const byCell = new Map<
    string,
    { count: number; people: Set<string>; anyPerson: boolean; byContributor: Map<string, number> }
  >();
  for (const r of records) {
    let entry = byCell.get(r.cell);
    if (!entry) {
      entry = { count: 0, people: new Set(), anyPerson: false, byContributor: new Map() };
      byCell.set(r.cell, entry);
    }
    entry.count += 1;
    if (r.person !== null) {
      entry.anyPerson = true;
      entry.people.add(r.person);
    }
    entry.byContributor.set(r.contributor, (entry.byContributor.get(r.contributor) ?? 0) + 1);
  }
  const out = new Map<string, CellTally>();
  for (const [cell, e] of byCell) {
    out.set(cell, {
      count: e.count,
      people: e.anyPerson ? e.people.size : null,
      top: Math.max(0, ...e.byContributor.values()),
    });
  }
  return out;
}

/** One cell on its own. */
export function protect(t: CellTally, thresholds: InsightThresholds): Cell {
  if (t.count === 0) return { shown: true, value: 0 };
  if (t.count < thresholds.minCell) return { shown: false, reason: 'SMALL' };
  if (t.people !== null && t.people < thresholds.minPeople)
    return { shown: false, reason: 'SMALL' };
  if (t.top / t.count > thresholds.maxShare) return { shown: false, reason: 'DOMINANT' };
  return { shown: true, value: t.count };
}

/**
 * Cells whose sum is published (or derivable) elsewhere. Hides the next smallest shown non-zero
 * count until no hidden count stands alone.
 */
export function protectGroup(tallies: readonly CellTally[], thresholds: InsightThresholds): Cell[] {
  const cells = tallies.map((t) => protect(t, thresholds));
  for (;;) {
    const hidden = cells.filter((c) => !c.shown).length;
    if (hidden !== 1) return cells;
    let smallest = -1;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c?.shown || c.value === 0) continue;
      const current = smallest >= 0 ? cells[smallest] : undefined;
      if (!current?.shown || c.value < current.value) smallest = i;
    }
    if (smallest < 0) return cells;
    cells[smallest] = { shown: false, reason: 'COMPLEMENTARY' };
  }
}
