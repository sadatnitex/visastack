#!/usr/bin/env node
/**
 * Builds VISASTACK_TRANSLATION_REGISTER.csv: one row per de-duplicated semantic group of
 * user-visible English, with source ids, the proposed bn-BD draft (where drafted), automated
 * guardrail results, provenance and release state. Nothing here is released text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, loadGlossary } from './guardrail-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LOC = path.join(ROOT, 'docs/localization');
const WORK = path.join(ROOT, 'apps/web/.preview/l10n/work');
const rows = JSON.parse(fs.readFileSync(path.join(WORK, 'rows.json'), 'utf8'));
const inputs = JSON.parse(fs.readFileSync(path.join(WORK, 'draft-input.json'), 'utf8'));
const inputBySg = new Map(inputs.map((g) => [g.sg, g]));
const drafts = new Map();
const draftDir = path.join(LOC, 'data/drafts');
for (const f of fs
  .readdirSync(draftDir)
  .filter((x) => /^bn-BD\.(part-.*|corrections)\.jsonl$/.test(x))
  .sort(
    (a, b) =>
      Number(a.includes('corrections')) - Number(b.includes('corrections')) || a.localeCompare(b),
  )) {
  for (const line of fs.readFileSync(path.join(draftDir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      drafts.set(o.sg, {
        ...o,
        part: f.includes('corrections')
          ? 'corrections after independent review'
          : f.replace('bn-BD.part-', '').replace('.jsonl', ''),
      });
    } catch {
      /* ignore a torn last line */
    }
  }
}
const decisions = JSON.parse(
  fs.readFileSync(path.join(draftDir, 'OWNER_DECISIONS.json'), 'utf8'),
).decisions;
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const KEEP_TOKEN =
  /(\{[^}]*\}|<[^>]*>|[A-Za-z][\w./-]*[0-9][\w./-]*|[0-9][\w./-]*[A-Za-z][\w./-]*)/;
/** Owner decisions 2026-11-12: the case word is ফাইল; prose digits are Bengali (codes, placeholders and tags are left alone). */
function applyOwnerDecisions(text) {
  let out = text.split(decisions.case_term.replaces).join(decisions.case_term.bn);
  if (decisions.digits_in_prose === 'bengali')
    out = out
      .split(KEEP_TOKEN)
      .map((part, i) => (i % 2 ? part : part.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])))
      .join('');
  return out;
}
const glossary = loadGlossary();
const glossHits = (en) =>
  glossary
    .filter((t) =>
      new RegExp(
        `(^|[^A-Za-z])${t.english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`,
        'i',
      ).test(en),
    )
    .map((t) => t.term_id);

// all semantic groups that are meant for people
const groups = new Map();
for (const r of rows) {
  if (r.priority === 'NOT_FOR_TRANSLATION' || r.translation_unit !== 'Y') continue;
  // URLs, paths and typed keywords are literals to keep, not text to translate.
  if (/^\/[\w/?=&.#-]*$/.test(r.english) || /^[A-Z_]{3,}$/.test(r.english)) continue;
  const g = groups.get(r.semantic_group) ?? {
    sg: r.semantic_group,
    english: r.english,
    domain: r.domain,
    guard: r.guard_tags,
    kinds: new Set(),
    icu: new Set(),
    ph: r.placeholders,
    roles: new Set(),
    priority: r.priority,
    rc: r.review_class,
    ids: [],
    n: 0,
    rendered: false,
    outKinds: new Set(),
  };
  g.kinds.add(r.kind);
  for (const x of r.icu_flags ? r.icu_flags.split('|') : []) g.icu.add(x);
  for (const x of r.roles ? r.roles.split('|') : []) g.roles.add(x);
  if (r.output_kind) g.outKinds.add(r.output_kind);
  if (r.rendered === 'CONFIRMED_RENDERED') g.rendered = true;
  if (g.ids.length < 3) g.ids.push(r.id);
  g.n++;
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

const COLS = [
  'semantic_group',
  'source_ids_sample',
  'occurrences',
  'english',
  'domain',
  'text_kinds',
  'guard_tags',
  'priority',
  'review_class',
  'journeys',
  'roles',
  'placeholders',
  'icu_flags',
  'rendered_on_a_screen',
  'bn_BD_draft',
  'draft_confidence',
  'draft_note',
  'automated_checks',
  'glossary_terms',
  'provenance',
  'qualified_review_required',
  'assigned_reviewer',
  'human_reviewer',
  'review_state',
  'release_state',
  'other_locales',
];
const q = (v) => {
  const s = String(v ?? '').replace(/\u2014/g, '[U+2014]');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const out = [COLS.join(',')];
const stats = {
  groups: groups.size,
  drafted: 0,
  checkedPass: 0,
  checkedFlag: 0,
  ruleCounts: {},
  byConf: {},
  undrafted: 0,
  ownerDecision: 0,
};
const flaggedList = [];
const collisions = [];
const queue = [];
stats.qualified = { total: 0, drafted: 0 };
stats.versionReview = 0;
for (const g of [...groups.values()].sort(
  (a, b) =>
    a.priority.localeCompare(b.priority) ||
    a.domain.localeCompare(b.domain) ||
    a.english.localeCompare(b.english),
)) {
  const d = drafts.get(g.sg);
  const inp = inputBySg.get(g.sg);
  let checks = '';
  let bn = '';
  let conf = '';
  let note = '';
  let prov = 'NOT_DRAFTED';
  if (d?.bn) {
    bn = applyOwnerDecisions(d.bn);
    conf = d.conf ?? '';
    note = d.note ?? '';
    const all = check(g.english, bn);
    const f = all.filter((x) => !x.rule.startsWith('WARN_'));
    const warn = all.filter((x) => x.rule.startsWith('WARN_'));
    checks = f.length
      ? f.map((x) => `${x.rule}: ${x.detail}`).join(' ; ')
      : warn.length
        ? `PASS (${warn.map((x) => x.rule).join(',')})`
        : 'PASS';
    prov = `VISASTACK_RECOMMENDED (model draft, batch ${d.part}); glossary-guided; owner decisions applied (case=ফাইল, Bengali digits)`;
    stats.drafted++;
    stats.byConf[conf] = (stats.byConf[conf] ?? 0) + 1;
    if (f.length) {
      stats.checkedFlag++;
      flaggedList.push({ sg: g.sg, en: g.english, bn, f });
      for (const x of f) stats.ruleCounts[x.rule] = (stats.ruleCounts[x.rule] ?? 0) + 1;
    } else stats.checkedPass++;
  } else if (d) {
    stats.ownerDecision++;
    note = d.note ?? '';
    prov = 'OWNER_DECISION_NEEDED';
    checks = 'NOT_DRAFTED';
  } else stats.undrafted++;
  const legal =
    g.rc !== 'STANDARD_UI' || /LEGAL_REVIEW|OFFICIAL_RULE|BILLING_REVIEW/.test(note)
      ? `YES (${g.rc !== 'STANDARD_UI' ? g.rc : note})`
      : '';
  if (bn && /\bcases?\b/i.test(g.english) && /\b(files?|uploads?|uploaded)\b/i.test(g.english))
    collisions.push(
      [
        g.sg,
        g.english,
        bn,
        'English has both case and file; Bengali uses ফাইল for both. Editor: keep the case as ফাইল and call the upload ডকুমেন্ট or আপলোড করা ফাইল',
      ]
        .map(q)
        .join(','),
    );
  if (legal) {
    stats.qualified.total++;
    if (bn) stats.qualified.drafted++;
    queue.push(
      [
        g.sg,
        g.rc,
        g.domain,
        g.english,
        bn,
        checks,
        'OWNER_ASSIGNED_BY_OWNER_DECISION (not asserted to be a qualified legal reviewer; nothing reviewed yet)',
      ]
        .map(q)
        .join(','),
    );
  }
  if (checks.includes('VERSION_CONCEPT_REVIEW')) stats.versionReview++;
  out.push(
    [
      g.sg,
      g.ids.join(' '),
      g.n,
      g.english,
      g.domain,
      [...g.kinds].sort().join('+'),
      g.guard,
      g.priority,
      g.rc,
      inp ? inp.journeys.join(' ') : '',
      [...g.roles].sort().join('|'),
      g.ph,
      [...g.icu].sort().join('|'),
      g.rendered ? 'Y' : 'N',
      bn,
      conf,
      note,
      checks,
      glossHits(g.english).join(' '),
      prov,
      legal,
      bn ? 'owner (decision 2026-11-12)' : '',
      '',
      bn ? 'ASSIGNED_NOT_REVIEWED' : '',
      'DRAFT_NOT_FOR_RELEASE',
      'ar fr de es zh-Hans: NOT_STARTED (Bengali ships first by owner decision; no other locale is justified until the owner names one)',
    ]
      .map(q)
      .join(','),
  );
}
fs.writeFileSync(path.join(LOC, 'VISASTACK_TRANSLATION_REGISTER.csv'), `${out.join('\n')}\n`);
fs.writeFileSync(
  path.join(LOC, 'data/CASE_FILE_COLLISION_REVIEW.csv'),
  `${['semantic_group,english,bn_BD_draft,note', ...collisions].join('\n')}\n`,
);
stats.caseFileCollisions = collisions.length;
fs.writeFileSync(
  path.join(LOC, 'data/QUALIFIED_REVIEW_QUEUE.csv'),
  `${['semantic_group,review_class,domain,english,bn_BD_draft,automated_checks,reviewer_state', ...queue].join('\n')}\n`,
);
fs.writeFileSync(
  path.join(WORK, 'register-stats.json'),
  JSON.stringify({ ...stats, flaggedSample: flaggedList.slice(0, 40) }, null, 1),
);
process.stdout.write(`${JSON.stringify(stats)}\n`);
