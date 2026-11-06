#!/usr/bin/env node
// Updates apps/web/src/lib/ccd/prose-limits.json from a measurement run.
//   PROSE_MEASURE=/tmp/m.jsonl pnpm --filter @visastack/web exec vitest run src/lib/ccd/parity
//   node scripts/agent/prose-limits.mjs /tmp/m.jsonl
// A ceiling exists only for a state over 30 words at a view that is not held to 30. Since 6 Nov 2026
// every screen is held to 30 at every width (the depth "auto" is Glance everywhere), so no ceilings
// remain; this script only helps if the owner ever allows an exception again.
// This script only ever LOWERS or removes a ceiling for a state it measured. A state that grew past
// its ceiling, or a state with no ceiling that is over 30, stops the script: raising a ceiling
// needs the owner. States and screens that are not in the run are left exactly as they are.
import { readFileSync, writeFileSync } from 'node:fs';

const HELD_AT_DESKTOP = new Set(['documents']);
const LIMITS = 'apps/web/src/lib/ccd/prose-limits.json';
const file = process.argv[2];
if (!file) throw new Error('usage: prose-limits.mjs <measurement.jsonl>');
const limits = JSON.parse(readFileSync(LIMITS, 'utf8'));
const refused = [];
let lowered = 0;
const added = 0;
for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const row = JSON.parse(line);
  if (row.viewport !== 'desktop' || HELD_AT_DESKTOP.has(row.screen)) continue;
  const known = limits[row.screen]?.[row.state]?.desktop;
  if (row.words <= 30) {
    if (known !== undefined) {
      delete limits[row.screen][row.state];
      if (Object.keys(limits[row.screen]).length === 0) delete limits[row.screen];
      lowered += 1;
    }
    continue;
  }
  if (known === undefined) {
    refused.push(
      `${row.screen} / ${row.state}: ${row.words} words and no ceiling (a new over-30 state needs the owner)`,
    );
    continue;
  }
  if (row.words > known) {
    refused.push(`${row.screen} / ${row.state}: grew from ${known} to ${row.words}`);
    continue;
  }
  if (row.words < known) {
    limits[row.screen][row.state] = { desktop: row.words };
    lowered += 1;
  }
}
if (refused.length > 0) {
  process.stderr.write(`refused:\n${refused.map((r) => `  ${r}`).join('\n')}\n`);
  process.exit(1);
}
writeFileSync(LIMITS, `${JSON.stringify(limits, null, 2)}\n`);
process.stdout.write(`prose-limits.json: ${lowered} lowered or removed, ${added} added\n`);
