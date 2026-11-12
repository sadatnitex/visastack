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
// Text that must keep its original characters: placeholders, tags, URLs, email addresses, and
// code-like tokens (letters mixed with digits, such as P-A13JCX or ISO8601).
const KEEP_TOKEN =
  /(\{[^}]*\}|<[^>]*>|https?:\/\/\S+|\S+@\S+\.\S+|[A-Za-z][\w./-]*[0-9][\w./-]*|[0-9][\w./-]*[A-Za-z][\w./-]*)/;
const NOT_AFTER_BENGALI = '(?<![\\u0980-\\u09FF\\u200C\\u200D])';
const CASE_MARK = '';
/**
 * Owner decisions of 2026-11-12 (data/drafts/OWNER_DECISIONS.json), applied to the original drafts:
 * the case is written ভিসা ফাইল; an uploaded file is a ডকুমেন্ট; bare ফাইল is never used; the
 * navigation label Documents is ডকুমেন্টস; prose digits are Bengali (codes and addresses are not).
 */
function applyOwnerDecisions(text, english, keepLatinDigits = false) {
  let t = text;
  // 1. the case (already-final text is left alone, so the transform is idempotent)
  t = t.replace(/ভিসা ফাইল/g, CASE_MARK);
  t = t.replace(/ভিসা কেস/g, CASE_MARK);
  t = t.replace(new RegExp(`${NOT_AFTER_BENGALI}কেস`, 'g'), CASE_MARK);
  // English "file" that means the visa file (marketing headlines), not an upload
  if (/\b(clean|one private) file\b/i.test(english))
    t = t.replace(new RegExp(`${NOT_AFTER_BENGALI}ফাইল`, 'g'), CASE_MARK);
  // 2. uploaded evidence: compounds first, then the bare word
  const rx = (pattern) => new RegExp(`${NOT_AFTER_BENGALI}${pattern}`, 'g');
  t = t
    .replace(rx('ফাইলের ধরন ও কাঠামো'), 'ডকুমেন্টের ফরম্যাট ও কাঠামো')
    .replace(rx('ফাইলের ধরন'), 'ডকুমেন্টের ফরম্যাট')
    .replace(rx('ফাইলের নাম'), 'ডকুমেন্টের নাম')
    .replace(/ডকুমেন্ট ফাইল(?![\u0980-\u09FF])/g, 'আপলোড করা ডকুমেন্ট')
    .replace(/ডকুমেন্টের ফাইল(?![\u0980-\u09FF])/g, 'ডকুমেন্ট')
    .replace(rx('ফাইল'), 'ডকুমেন্ট')
    .replace(/ডকুমেন্ট ডকুমেন্ট/g, 'ডকুমেন্ট');
  t = t.split(CASE_MARK).join('ভিসা ফাইল');
  // 3. navigation label
  if (english.trim().toLowerCase() === 'documents') t = 'ডকুমেন্টস';
  // 4. digits in prose
  if (decisions.digits_in_prose === 'bengali' && !keepLatinDigits)
    t = t
      .split(KEEP_TOKEN)
      .map((part, i) => (i % 2 ? part : part.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)])))
      .join('');
  return t;
}
const QUEUES = {
  PRIVACY_CONSENT_LEGAL: '03-privacy-consent-legal',
  COMMERCIAL: '02-commercial',
  OFFICIAL_VISA_REQUIREMENT: '04-official-visa-requirements',
  ORDINARY_UI: '01-ordinary-ui',
};
const LEGAL_RE =
  /\b(consent|privacy|personal (data|information)|legal hold|legal requirement|retention|retain|erase|erasure|data protection|terms of|terms and|permanently delet\w*|audit trail|anonymi[sz]ed|lawful|withdraw consent|controller|processor)\b/i;
const COMMERCIAL_RE =
  /\b(invoice|receipt|refund|payment|price|pricing|billing|fee|fees|checkout|subscription|credit|charge|renew\w*|currency|plan|plans|purchase|paid|quota|fair.use)\b/i;
const OFFICIAL_RE =
  /\b(embassy|consulate|visa (rule|requirement|route|centre|center|application centre)|official (source|checklist|rule|requirement|page|website|pack)|immigration authority|checklist pack|issuing authority)\b/i;
/** Which review queue a group belongs to: by file class first, then by what the words say. Precedence: legal, commercial, official, ordinary. */
function reviewQueue(g) {
  const text = g.english;
  // A string that only sits in a specialist file, and is three words or fewer with no telling word,
  // is an ordinary interface word ("When", "Reference"); it does not need a specialist reviewer.
  const short = text.trim().split(/\s+/).length <= 3;
  const byFile = (cond) => cond && !short;
  const hits = [];
  if (
    LEGAL_RE.test(text) ||
    byFile(g.rc === 'LEGAL_POLICY_TEXT' || ['consent', 'privacy_lifecycle'].includes(g.domain))
  )
    hits.push('PRIVACY_CONSENT_LEGAL');
  if (
    COMMERCIAL_RE.test(text) ||
    byFile(g.rc === 'PAYMENT_BILLING' || g.domain === 'payments_billing')
  )
    hits.push('COMMERCIAL');
  if (OFFICIAL_RE.test(text) || byFile(g.rc === 'OFFICIAL_RULE_CONTENT'))
    hits.push('OFFICIAL_VISA_REQUIREMENT');
  return { queue: hits[0] ?? 'ORDINARY_UI', also: hits.slice(1) };
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
  'review_queue',
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
const navLabels = [];
const queues = {
  ORDINARY_UI: [],
  COMMERCIAL: [],
  PRIVACY_CONSENT_LEGAL: [],
  OFFICIAL_VISA_REQUIREMENT: [],
};
const queueUndrafted = {
  ORDINARY_UI: 0,
  COMMERCIAL: 0,
  PRIVACY_CONSENT_LEGAL: 0,
  OFFICIAL_VISA_REQUIREMENT: 0,
};
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
    bn = applyOwnerDecisions(d.bn, g.english, d.keep_latin_digits === true);
    conf = d.conf ?? '';
    note = d.note ?? '';
    const all = check(g.english, bn, { choiceDropOk: d.choice_drop_ok === true });
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
  const rq = reviewQueue(g);
  const legal =
    rq.queue !== 'ORDINARY_UI' || /LEGAL_REVIEW|OFFICIAL_RULE|BILLING_REVIEW/.test(note)
      ? `YES (${rq.queue !== 'ORDINARY_UI' ? rq.queue : note})`
      : '';
  if (
    bn &&
    /\bdocuments?\b/i.test(g.english) &&
    g.english.split(/\s+/).length <= 4 &&
    !g.english.includes('{')
  )
    navLabels.push(
      [g.sg, g.english, bn, g.domain, g.kinds.size ? [...g.kinds].sort().join('+') : '']
        .map(q)
        .join(','),
    );
  if (bn.includes('ভিসা ফাইল') && /ডকুমেন্ট|আপলোড/.test(bn))
    collisions.push(
      [
        g.sg,
        g.english,
        bn,
        'Holds both objects. Check that the visa file and the uploaded document cannot be confused',
      ]
        .map(q)
        .join(','),
    );
  if (bn) {
    queues[rq.queue].push(
      [
        g.sg,
        g.english,
        bn,
        g.priority,
        checks,
        glossHits(g.english).join(' '),
        rq.also.join(' '),
        'owner (decision 2026-11-12)',
        'NO',
        'ASSIGNED_NOT_REVIEWED',
        '',
        '',
      ]
        .map(q)
        .join(','),
    );
    queueUndrafted.ORDINARY_UI += 0;
  } else queueUndrafted[rq.queue]++;
  if (legal) {
    stats.qualified.total++;
    if (bn) stats.qualified.drafted++;
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
      rq.queue,
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
  path.join(LOC, 'data/NAV_TERM_REVIEW.csv'),
  `${['semantic_group,english,bn_BD_draft,domain,text_kinds', ...navLabels].join('\n')}\n`,
);
stats.documentLabels = navLabels.length;
fs.rmSync(path.join(LOC, 'data/QUALIFIED_REVIEW_QUEUE.csv'), { force: true });
fs.mkdirSync(path.join(LOC, 'data/review-queues'), { recursive: true });
const QHEAD =
  'semantic_group,english,bn_BD_draft,priority,automated_checks,glossary_terms,also_matches,assigned_reviewer,reviewed,review_state,reviewer_sign_off,sign_off_date';
stats.queues = {};
for (const [name, file] of Object.entries(QUEUES)) {
  fs.writeFileSync(
    path.join(LOC, `data/review-queues/${file}.csv`),
    `${[QHEAD, ...queues[name]].join('\n')}\n`,
  );
  stats.queues[name] = { drafted: queues[name].length, notDraftedYet: queueUndrafted[name] };
}
fs.writeFileSync(
  path.join(WORK, 'register-stats.json'),
  JSON.stringify({ ...stats, flaggedSample: flaggedList.slice(0, 40) }, null, 1),
);
process.stdout.write(`${JSON.stringify(stats)}\n`);
