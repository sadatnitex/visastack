#!/usr/bin/env node
/** Fills the example tables of the guardrails template from the census and writes VISASTACK_SEMANTIC_GUARDRAILS.md. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOC = path.join(ROOT, 'docs/localization');
const rows = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'apps/web/.preview/l10n/work/rows.json'), 'utf8'),
);
const tpl = fs.readFileSync(path.join(LOC, 'tools/guardrails.template.md'), 'utf8');
const TAGS = [
  ['G1_state_word', 'State words'],
  ['G2_safety_check', 'File safety'],
  ['G3_requirement_level', 'Requirement level'],
  ['G4_who_is_asking', 'Who is asking'],
  ['G5_share_lifecycle', 'Share lifecycle'],
  ['G6_copy_version', 'Copies and versions'],
  ['G7_country_role', 'Country roles'],
  ['G8_data_action', 'Data actions'],
  ['G9_claim_strength', 'Claim strength'],
];
const out = [];
for (const [tag, label] of TAGS) {
  const hit = rows.filter(
    (r) =>
      r.guard_tags.includes(tag) &&
      r.priority !== 'NOT_FOR_TRANSLATION' &&
      r.translation_unit === 'Y' &&
      r.evidence !== 'CANDIDATE_ONLY' &&
      r.audience === 'person' &&
      r.english.length <= 120,
  );
  const uniq = new Map();
  for (const r of hit) if (!uniq.has(r.english.toLowerCase())) uniq.set(r.english.toLowerCase(), r);
  // spread across files so one catalogue does not dominate
  const picked = [];
  const perFile = {};
  for (const r of [...uniq.values()].sort(
    (a, b) =>
      (b.rendered === 'CONFIRMED_RENDERED') - (a.rendered === 'CONFIRMED_RENDERED') ||
      a.id.localeCompare(b.id),
  )) {
    perFile[r.file] = (perFile[r.file] ?? 0) + 1;
    if (perFile[r.file] <= 2) picked.push(r);
    if (picked.length >= 8) break;
  }
  out.push(
    `### ${label} (${tag}): ${hit.length} rows, ${uniq.size} distinct texts`,
    '',
    '| Source id | English | Where |',
    '|---|---|---|',
    ...picked.map(
      (r) =>
        `| ${r.id} | ${r.english.replace(/\|/g, '/')} | \`${r.file.replace(/^(apps\/web\/src|packages)\//, '')}:${r.line_start}\`${r.rendered === 'CONFIRMED_RENDERED' ? ' (seen on a screen)' : ''} |`,
    ),
    '',
  );
}
fs.writeFileSync(
  path.join(LOC, 'VISASTACK_SEMANTIC_GUARDRAILS.md'),
  tpl.replace('<!-- EXAMPLES -->', out.join('\n')),
);
process.stdout.write('guardrails written\n');
