#!/usr/bin/env node
// Rewrites apps/web/src/lib/ccd/prose-limits.json from a measurement run.
//   PROSE_MEASURE=/tmp/m.jsonl pnpm --filter @visastack/web exec vitest run src/lib/ccd/parity-
//   node scripts/agent/prose-limits.mjs /tmp/m.jsonl
// A ceiling is written only for a state that is over 30 words at a view that is not held to 30
// (the desktop view of every screen except Documents). Phone views are never written: they must
// be 30 or fewer. Lowering a ceiling is the point; raising one needs the owner.
import { readFileSync, writeFileSync } from 'node:fs';

const HELD_AT_DESKTOP = new Set(['documents']);
const file = process.argv[2];
if (!file) throw new Error('usage: prose-limits.mjs <measurement.jsonl>');
const out = {};
for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const row = JSON.parse(line);
  if (row.viewport !== 'desktop' || HELD_AT_DESKTOP.has(row.screen) || row.words <= 30) continue;
  out[row.screen] ??= {};
  out[row.screen][row.state] = { desktop: row.words };
}
writeFileSync('apps/web/src/lib/ccd/prose-limits.json', `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(
  `wrote ${Object.values(out).reduce((n, s) => n + Object.keys(s).length, 0)} ceilings\n`,
);
