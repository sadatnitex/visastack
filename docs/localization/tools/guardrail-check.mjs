#!/usr/bin/env node
/**
 * Semantic guardrail checks for proposed translations (see VISASTACK_SEMANTIC_GUARDRAILS.md).
 * Library: check(en, bn) -> list of findings. CLI: node guardrail-check.mjs --self-test
 *
 * The self-test runs the real Bengali strings that already sit in packages/i18n against the
 * checks and requires them to FAIL where the review file says they are wrong. A guard that
 * cannot fail proves nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body
    .filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
export function loadGlossary() {
  return parseCsv(
    fs.readFileSync(path.join(ROOT, 'docs/localization/data/BN_BD_CORE_GLOSSARY.csv'), 'utf8'),
  );
}

const WORD = (term) =>
  new RegExp(`(^|[^A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i');
const split = (s) => (s ? s.split('|').filter(Boolean) : []);
const GLOSS = loadGlossary().filter(
  (t) =>
    /^G[1-8]_/.test(t.semantic_group) ||
    ['consent', 'people', 'objects'].includes(t.semantic_group),
);

// Claims that must not appear in Bengali unless the English makes the same claim.
const CLAIMS = [
  { en: /\b(secure|safe|safety|security)\b/i, bn: /নিরাপ/, name: 'security claim' },
  { en: /\b(verify|verified|verification)\b/i, bn: /যাচাই/, name: 'verification claim' },
  { en: /\b(official|government)\b/i, bn: /অফিসিয়াল|সরকারি/, name: 'official or government claim' },
  { en: /\b(approve|approved|approval)\b/i, bn: /অনুমোদ/, name: 'approval claim' },
  { en: /\b(guarantee|guaranteed)\b/i, bn: /গ্যারান্টি|নিশ্চয়তা/, name: 'guarantee claim' },
  {
    en: /\b(scan|scanned|scanning|antivirus)\b/i,
    bn: /স্ক্যান|অ্যান্টিভাইরাস/,
    name: 'antivirus scan claim',
  },
  { en: /\b(viruses|virus|malware)\b/i, bn: /ভাইরাস|ম্যালওয়্যার/, name: 'virus claim' },
  { en: /\b(confirm|confirmed|confirmation)\b/i, bn: /নিশ্চিত/, name: 'confirmation claim' },
  { en: /\b(encrypt|encrypted|encryption)\b/i, bn: /এনক্রিপ্ট|সংকেত/, name: 'encryption claim' },
  {
    en: /\b(quarantine|quarantined|held|hold|flagged|blocked)\b/i,
    bn: /কোয়ারেন্টাইন|আটক|ব্লক/,
    name: 'held-back state claim',
  },
  { en: /\b(clean)\b/i, bn: /পরিষ্কার/, name: 'cleanliness claim' },
];
const BANNED_BN = [
  [/দলিল/, '"দলিল" means a deed; the word for document is ডকুমেন্ট'],
  [/নাবালক|নাবালিকা/, 'Gendered word for a minor; use অপ্রাপ্তবয়স্ক'],
  [/\u2014/, 'Em dash character'],
];

const say = (s) => process.stdout.write(`${s}\n`);
const tokens = (s, re) => [...s.matchAll(re)].map((m) => m[0]).sort();
export function check(enIn, bnIn) {
  let en = enIn;
  let bn = bnIn;
  const f = [];
  if (!bn) return f;
  // 1. placeholders and markup preserved
  en = en.replace(/&[a-z]+;/g, ' ');
  bn = bn.replace(/&[a-z]+;/g, ' ');
  const phE = tokens(en, /\{\w+\}/g);
  const phB = tokens(bn, /\{\w+\}/g);
  const dropOk = /\{choice\}/.test(en); // English-only plural switch may be dropped
  const phEcmp = dropOk ? phE.filter((x) => x !== '{choice}') : phE;
  if (JSON.stringify(phEcmp) !== JSON.stringify(phB))
    f.push({ rule: 'PLACEHOLDER_MISMATCH', detail: `en ${phE.join(' ')} vs bn ${phB.join(' ')}` });
  const tgE = tokens(en, /<\/?[A-Za-z][\w.]*\/?>/g);
  const tgB = tokens(bn, /<\/?[A-Za-z][\w.]*\/?>/g);
  if (JSON.stringify(tgE) !== JSON.stringify(tgB))
    f.push({ rule: 'MARKUP_MISMATCH', detail: `en ${tgE.join(' ')} vs bn ${tgB.join(' ')}` });
  // 2. glossary stems for terms found in the English
  const present = GLOSS.filter((t) => WORD(t.english).test(en));
  // longest term wins: drop a term contained in a longer present term (Verify inside Verified is not an issue; Mandatory inside Mandatory if applicable is)
  const longest = present.filter(
    (t) =>
      !present.some(
        (u) =>
          u !== t &&
          u.english.length > t.english.length &&
          u.english.toLowerCase().includes(t.english.toLowerCase()),
      ),
  );
  const allowedStems = new Set(present.flatMap((t) => split(t.bn_must_contain_any_of)));
  for (const t of longest) {
    const need = split(t.bn_must_contain_any_of);
    if (need.length && !need.some((s) => bn.includes(s)))
      f.push({
        rule: 'GLOSSARY_TERM_MISSING',
        detail: `"${t.english}" needs ${need.join(' or ')} (${t.term_id})`,
      });
    // Cross-use is checked on short labels only; long sentences are covered by the required-stem and claim checks.
    if (en.length <= 40) {
      for (const bad of split(t.bn_must_not_contain_any_of)) {
        if (!bn.includes(bad) || allowedStems.has(bad)) continue;
        const owners = GLOSS.filter((u) => split(u.bn_must_contain_any_of).includes(bad));
        const rootPresent = owners.some((u) =>
          en.toLowerCase().includes(u.english.toLowerCase().slice(0, 5)),
        );
        if (!rootPresent)
          f.push({
            rule: 'GLOSSARY_FORBIDDEN_STEM',
            detail: `"${t.english}" must not use ${bad} (${t.term_id})`,
          });
      }
    }
  }
  // 3. no stronger claim than English
  for (const c of CLAIMS)
    if (c.bn.test(bn) && !c.en.test(en))
      f.push({
        rule: 'STRONGER_CLAIM',
        detail: `Bengali has a ${c.name} the English does not make`,
      });
  // Version words: banned only where the English does not mean a version; and a real version must not silently become a copy.
  if (/সংস্করণ|ভার্সন/.test(bn) && !/\bversion/i.test(en))
    f.push({
      rule: 'BANNED_WORDING',
      detail: 'Version wording where the English says copy or document (no Version 2 semantics)',
    });
  if (/\bversions?\b/i.test(en) && !/সংস্করণ|ভার্সন/.test(bn))
    f.push({
      rule: 'VERSION_CONCEPT_REVIEW',
      detail:
        'English says version; Bengali dropped it. Fine for a document copy, wrong for a snapshot, pack or product version: editor to confirm',
    });
  // 4. banned wording
  for (const [re, why] of BANNED_BN)
    if (re.test(bn)) f.push({ rule: 'BANNED_WORDING', detail: why });
  // Owner decision 2026-11-12: Bengali digits in prose. Latin digits are allowed only inside placeholders, tags and code-like tokens.
  const prose = bn.replace(
    /\{[^}]*\}|<[^>]*>|[A-Za-z][\w./-]*[0-9][\w./-]*|[0-9][\w./-]*[A-Za-z][\w./-]*/g,
    ' ',
  );
  if (/[0-9]/.test(prose))
    f.push({
      rule: 'WARN_LATIN_DIGITS',
      detail: 'Latin digits in prose; owner decision is Bengali digits',
    });
  // 5. narrow controls
  const short = en.length <= 24;
  if (short && bn.length > Math.max(14, en.length * 2.4))
    f.push({
      rule: 'WARN_LENGTH',
      detail: `bn ${bn.length} chars vs en ${en.length} (narrow button risk)`,
    });
  // 6. forbidden Latin letters (a bn string that is still English)
  if (
    /[A-Za-z]{4,}/.test(
      bn.replace(
        /\{\w+\}|<\/?[\w.]+\/?>|VisaStack|WhatsApp|PDF|OCR|ICS|CSV|URL|WiFi|Wi-Fi|Google|Apple|Microsoft/g,
        '',
      ),
    )
  )
    f.push({ rule: 'LATIN_LEFTOVER', detail: 'long Latin word left in Bengali text' });
  return f;
}

// ---- self-test: the existing catalogue must trip the guards
function selfTest() {
  const src = fs.readFileSync(path.join(ROOT, 'packages/i18n/src/messages.ts'), 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};?`));
    const out = {};
    for (const mm of m[1].matchAll(
      /^\s*'([\w.]+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),?\s*$/gm,
    ))
      out[mm[1]] = mm[2] ?? mm[3];
    return out;
  };
  const EN = grab('EN');
  const BN = grab('BN');
  const mustFail = [
    'document.status.clean',
    'document.scanning',
    'document.status.scanning',
    'document.processing.scanning',
    'document.processing.ready',
    'document.processing.quarantined',
    'applicant.relationship.minorGuardian',
  ];
  const mustPass = ['grant.status.active', 'consent.required', 'error.notFound.title'];
  let bad = 0;
  for (const k of mustFail) {
    const r = check(EN[k], BN[k]);
    const ok = r.length > 0;
    say(
      `${ok ? 'FAILS AS EXPECTED' : 'UNEXPECTEDLY PASSES'}  ${k}  ${ok ? r.map((x) => x.rule).join(',') : ''}`,
    );
    if (!ok) bad++;
  }
  for (const k of mustPass) {
    const r = check(EN[k], BN[k]).filter((x) => !x.rule.startsWith('WARN_'));
    const ok = r.length === 0;
    say(
      `${ok ? 'PASSES AS EXPECTED' : 'UNEXPECTED FINDING'}  ${k}  ${r.map((x) => x.rule).join(',')}`,
    );
    if (!ok) bad++;
  }
  // corrected wording from the review file must pass the same checks
  const review = parseCsv(
    fs.readFileSync(
      path.join(ROOT, 'docs/localization/data/BN_EXISTING_CATALOGUE_REVIEW.csv'),
      'utf8',
    ),
  );
  let fixedBad = 0;
  for (const r of review)
    if (r.proposed_bn) {
      const x = check(r.english_now, r.proposed_bn).filter((y) => !y.rule.startsWith('WARN_'));
      if (x.length) {
        fixedBad++;
        say(
          `PROPOSED FIX STILL FLAGGED ${r.key}: ${x.map((y) => `${y.rule} ${y.detail}`).join('; ')}`,
        );
      }
    }
  say(
    `self-test: ${bad === 0 && fixedBad === 0 ? 'PASS' : 'FAIL'} (guard misses: ${bad}, proposed fixes still flagged: ${fixedBad})`,
  );
  process.exit(bad === 0 && fixedBad === 0 ? 0 : 1);
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test'))
  selfTest();
