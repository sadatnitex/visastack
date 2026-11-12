#!/usr/bin/env node
/**
 * Builds the drafting input set: every semantic group that is semantic-critical, or drawn on one
 * of the 20 journey screens. Output: apps/web/.preview/l10n/work/draft-input.json (English only, no translations).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WORK = path.join(ROOT, 'apps/web/.preview/l10n/work');
const rows = JSON.parse(fs.readFileSync(path.join(WORK, 'rows.json'), 'utf8'));
const rendered = JSON.parse(fs.readFileSync(path.join(WORK, 'rendered-results.json'), 'utf8'));
const journeys = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs/localization/data/journeys.json'), 'utf8'),
);
const byId = new Map(rows.map((r) => [r.id, r]));
const slugToJourneys = new Map();
for (const j of journeys)
  for (const s of j.slugs) {
    if (!slugToJourneys.has(s)) slugToJourneys.set(s, []);
    slugToJourneys.get(s).push(j.id);
  }

const groups = new Map(); // semantic_group -> record
for (const r of rows) {
  if (r.priority === 'NOT_FOR_TRANSLATION') continue;
  if (r.translation_unit !== 'Y') continue; // translate the composed sentence, not its fragments
  const g = groups.get(r.semantic_group) ?? {
    sg: r.semantic_group,
    english: r.english,
    domain: r.domain,
    guard_tags: r.guard_tags,
    kinds: new Set(),
    icu: new Set(),
    placeholders: r.placeholders,
    roles: new Set(),
    priority: r.priority,
    review_class: r.review_class,
    ids: [],
    occurrences: 0,
    journeys: new Set(),
    states: new Set(),
    outputKinds: new Set(),
    sampleFile: r.file,
    key: r.key,
  };
  g.kinds.add(r.kind);
  for (const f of r.icu_flags ? r.icu_flags.split('|') : []) g.icu.add(f);
  for (const x of r.roles ? r.roles.split('|') : []) g.roles.add(x);
  for (const x of r.state_hint ? r.state_hint.split('|') : []) g.states.add(x);
  if (r.output_kind) g.outputKinds.add(r.output_kind);
  if (g.ids.length < 4) g.ids.push(r.id);
  g.occurrences++;
  const order = [
    'P0_SEMANTIC_CRITICAL',
    'P1_CORE_UI',
    'P2_RULE_CONTENT_QUALIFIED_REVIEW',
    'P2_STAFF_OR_SYSTEM',
    'P3_REVIEW_FIRST',
  ];
  if (order.indexOf(r.priority) < order.indexOf(g.priority)) g.priority = r.priority;
  groups.set(r.semantic_group, g);
}
// link journeys through rendered text -> source ids -> groups
const lowerIndex = new Map();
for (const r of rows) {
  const k = r.english.toLowerCase();
  if (!lowerIndex.has(k)) lowerIndex.set(k, []);
  lowerIndex.get(k).push(r);
}
for (const res of rendered.results) {
  if (!['exact', 'exact_case_changed', 'template'].includes(res.class)) continue;
  const js = slugToJourneys.get(res.slug);
  if (!js) continue;
  const ids = res.source_ids ? res.source_ids.split(' ') : [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const g = groups.get(r.semantic_group);
    if (g) for (const j of js) g.journeys.add(j);
  }
}
const out = [];
for (const g of groups.values()) {
  const inScope =
    (g.priority === 'P0_SEMANTIC_CRITICAL' &&
      g.english.length <= 200 &&
      g.review_class !== 'LEGAL_POLICY_TEXT') ||
    g.journeys.size > 0;
  if (!inScope) continue;
  out.push({
    ...g,
    kinds: [...g.kinds],
    icu: [...g.icu],
    roles: [...g.roles],
    journeys: [...g.journeys].sort(),
    states: [...g.states],
    outputKinds: [...g.outputKinds],
  });
}
out.sort((a, b) => b.journeys.length - a.journeys.length || a.sg.localeCompare(b.sg));
fs.writeFileSync(path.join(WORK, 'draft-input.json'), JSON.stringify(out));
const sum = {
  groupsTotal: groups.size,
  inScope: out.length,
  chars: out.reduce((n, g) => n + g.english.length, 0),
  withJourney: out.filter((g) => g.journeys.length).length,
  p0NoJourney: out.filter((g) => !g.journeys.length).length,
  longer200: out.filter((g) => g.english.length > 200).length,
  legalOrRule: out.filter((g) => g.review_class !== 'STANDARD_UI').length,
};
process.stdout.write(`${JSON.stringify(sum)}\n`);
