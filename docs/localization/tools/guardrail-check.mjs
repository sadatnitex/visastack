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
import { splitOnTags, stripMarkers } from './text-markers.mjs';

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
  { en: /\b(secur\w*|saf(e|ely|ety)\w*)\b/i, bn: /নিরাপ/, name: 'security claim' },
  { en: /\bverif\w*/i, bn: /যাচাই/, name: 'verification claim' },
  {
    en: /\b(official\w*|government\w*)\b/i,
    bn: /অফিসিয়াল|সরকারি/,
    name: 'official or government claim',
  },
  { en: /\bapprov\w*/i, bn: /অনুমোদ/, name: 'approval claim' },
  { en: /\bguarantee\w*/i, bn: /গ্যারান্টি|নিশ্চয়তা/, name: 'guarantee claim' },
  {
    en: /\b(scan\w*|antivirus)\b/i,
    bn: /স্ক্যান|অ্যান্টিভাইরাস/,
    name: 'antivirus scan claim',
  },
  { en: /\b(viruses|virus|malware)\b/i, bn: /ভাইরাস|ম্যালওয়্যার/, name: 'virus claim' },
  {
    en: /\b(confirm\w*|guarantee\w*|sure|certain\w*|definite\w*)\b/i,
    bn: /নিশ্চিত/,
    name: 'confirmation claim',
  },
  { en: /\bencrypt\w*/i, bn: /এনক্রিপ্ট/, name: 'encryption claim' },
  {
    en: /\b(quarantine|quarantined|held|hold|flagged|blocked)\b/i,
    bn: /কোয়ারেন্টাইন|আটক|ব্লক/,
    name: 'held-back state claim',
  },
  { en: /\b(clean)\b/i, bn: /পরিষ্কার/, name: 'cleanliness claim' },
];
// Words that make "version" a real version (owner decision 2026-11-13), not a document's copy.
const REAL_VERSION_CONTEXT =
  /\b(snapshots?|packs?|checklists?|releases?|products?|VisaStack|apps?|notices?|terms|polic(y|ies)|privacy|letters?|names?|fields?|drafts?|published|publish|beta|test version|browsers?|software|editions?|version (one|two|1|2))\b/i;
const BANNED_BN = [
  [/নাবালক|নাবালিকা/, 'Gendered word for a minor; use অপ্রাপ্তবয়স্ক'],
  [/\u2014/, 'Em dash character'],
];

const say = (s) => process.stdout.write(`${s}\n`);
const tokens = (s, re) => [...s.matchAll(re)].map((m) => m[0]).sort();
export function check(enIn, bnIn, opts = {}) {
  let en = enIn;
  let bn = bnIn;
  const f = [];
  if (!bn) return f;
  // 1. placeholders and markup preserved
  en = en.replace(/&[a-z]+;/g, ' ');
  bn = bn.replace(/&[a-z]+;/g, ' ');
  const phE = tokens(en, /\{\w+\}/g);
  const phB = tokens(bn, /\{\w+\}/g);
  // {choice} glued to a word is an English plural suffix and may go; a free-standing {choice} (or {plural}) holds
  // real text built at run time and must stay. {agree} is an English verb-agreement switch and may go.
  const countOf = (arr, x) => arr.filter((y) => y === x).length;
  const glued = (en.match(/[A-Za-z)]\{choice\}/g) ?? []).length;
  const placeholderIssues = [];
  for (const name of new Set([...phE, ...phB])) {
    const total = countOf(phE, name);
    let required = total;
    if (name === '{agree}') required = 0;
    if (name === '{choice}') required = opts.choiceDropOk ? 0 : total - glued;
    const got = countOf(phB, name);
    if (got < required || got > total)
      placeholderIssues.push(`${name}: en ${total} (needs ${required}), bn ${got}`);
  }
  if (placeholderIssues.length)
    f.push({ rule: 'PLACEHOLDER_MISMATCH', detail: placeholderIssues.join('; ') });
  const tgE = tokens(en, /<\/?[A-Za-z][\w.]*\/?>/g);
  const tgB = tokens(bn, /<\/?[A-Za-z][\w.]*\/?>/g);
  if (JSON.stringify(tgE) !== JSON.stringify(tgB))
    f.push({ rule: 'MARKUP_MISMATCH', detail: `en ${tgE.join(' ')} vs bn ${tgB.join(' ')}` });
  // 2. glossary stems for terms found in the English
  // Placeholders, typed keywords (DELETE) and all-capital words are not English terms to translate.
  // Email addresses are typed examples, not words to translate (name@example.com is not the term Name).
  const enTerms = en
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\b[A-Z]{3,}\b/g, ' ');
  const present = GLOSS.filter((t) => WORD(t.english).test(enTerms));
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
  // Owner terminology decisions (2026-11-12). The case is ভিসা ফাইল; an upload is ডকুমেন্ট; bare ফাইল is ambiguous.
  if (/(?<![\u0980-\u09FF\u200C\u200D])(?<!ভিসা )ফাইল/.test(bn))
    f.push({
      rule: 'CASE_UPLOAD_AMBIGUITY',
      detail: 'Bare ফাইল: write ভিসা ফাইল for the case and ডকুমেন্ট for an upload',
    });
  if (/নথি/.test(bn)) f.push({ rule: 'NOT_STANDARD_DOCUMENT_WORD', detail: 'Use ডকুমেন্ট, not নথি' });
  if (/দলিল/.test(bn) && !/\bdeed/i.test(en))
    f.push({
      rule: 'NOT_STANDARD_DOCUMENT_WORD',
      detail: 'দলিল means a deed; use ডকুমেন্ট unless the English is about a deed',
    });
  if (en.trim().toLowerCase() === 'documents' && bn.trim() !== 'ডকুমেন্টস')
    f.push({ rule: 'NAV_DOCUMENTS', detail: 'The navigation label Documents is ডকুমেন্টস' });
  if (/[\u0980-\u09FF\u200C\u200D]ডকুমেন্ট/.test(bn))
    f.push({
      rule: 'TRANSFORM_DAMAGE',
      detail:
        'A Bengali word is glued to ডকুমেন্ট: a terminology replacement cut into another word (for example প্রোফাইল)',
    });
  const enNoPh = `${en.replace(/\{[^}]*\}/g, ' ')}${/\bv\{/i.test(en) ? ' version' : ''}`;
  // Legal hold is আইনি হোল্ড at any length; the word for Saved (সংরক্ষণ) must never stand for it.
  if (/legal hold/i.test(en) && !/আইনি হোল্ড/.test(bn))
    f.push({ rule: 'LEGAL_HOLD_TERM', detail: 'English says legal hold; write আইনি হোল্ড' });
  if (/আইনি (কারণে )?সংরক্ষণ/.test(bn))
    f.push({
      rule: 'LEGAL_HOLD_TERM',
      detail: 'আইনি সংরক্ষণ reads as Saved; use আইনি হোল্ড, or আইনি কারণে রেখে দেওয়া for retention',
    });
  if (/সংস্করণর/.test(bn)) f.push({ rule: 'TYPO', detail: 'সংস্করণর: the genitive is সংস্করণের' });
  // Version words: banned only where the English does not mean a version; and a real version must not silently become a copy.
  if (/সংস্করণ|ভার্সন/.test(bn) && !/\b(version|revision)/i.test(enNoPh))
    f.push({
      rule: 'BANNED_WORDING',
      detail: 'Version wording where the English says copy or document (no Version 2 semantics)',
    });
  // Owner decision 2026-11-13: a document's version is কপি; সংস্করণ is only for a product, release,
  // snapshot, pack or name version. Where the English names such a thing, the version word is still
  // required; elsewhere the version is a document's and কপি is accepted. A row with neither word fails.
  if (/\b(versions?|revisions?)\b/i.test(enNoPh)) {
    const realVersion = REAL_VERSION_CONTEXT.test(enNoPh) || /\brevisions?\b/i.test(enNoPh);
    const accepted = realVersion ? /সংস্করণ|ভার্সন/ : /সংস্করণ|ভার্সন|কপি/;
    if (!accepted.test(bn))
      f.push({
        rule: 'VERSION_CONCEPT_REVIEW',
        detail: realVersion
          ? 'English names a product, release, snapshot, pack or name version; Bengali dropped the version word (সংস্করণ)'
          : 'English says version of a document; Bengali has neither কপি nor সংস্করণ',
      });
  }
  // 4. banned wording
  for (const [re, why] of BANNED_BN)
    if (re.test(bn)) f.push({ rule: 'BANNED_WORDING', detail: why });
  // Owner decision 2026-11-12: Bengali digits in prose. Latin digits are allowed only inside placeholders, tags and code-like tokens.
  const prose = splitOnTags(bn.replace(/\{[^}]*\}/g, ' '))
    .join(' ')
    .replace(/[A-Za-z][\w./-]*[0-9][\w./-]*|[0-9][\w./-]*[A-Za-z][\w./-]*/g, ' ');
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
  // A label quoted exactly as the English writes it ("Settings") is the person's own device label,
  // kept in Latin by the direction of 2026-11-13 (OWNER_DECISIONS.json); anything else in Latin is still a leftover.
  const quotedLabels = withoutPluralScaffold(en, stripMarkers(bn)).replace(
    /"([^"\u0980-\u09FF]+)"/g,
    (m, label) => (en.includes(label) ? ' ' : m),
  );
  if (
    /[A-Za-z]{4,}/.test(
      quotedLabels.replace(
        /\{\w+\}|https?:\/\/\S*|\S+@\S+\.\S+|\b[A-Z][A-Z0-9/.-]{2,}\b|VisaStack|WhatsApp|ChatGPT|Claude|Meta|PDF|OCR|ICS|CSV|URL|WiFi|Wi-Fi|Google|Apple|Microsoft|iPhone|iPad|Android|Safari|Outlook|Vercel|Cloudflare|Neon Auth|Neon|Resend|ImmiAccount|clamav|zip|JPG|JPEG|PNG|HEIC|Word|Excel|COVID/g,
        '',
      ),
    )
  )
    f.push({ rule: 'LATIN_LEFTOVER', detail: 'long Latin word left in Bengali text' });
  return f;
}

/**
 * The Bengali without the plural scaffolding the English also has: `{count, plural,` and the branch
 * names (`=1`, `one`, `other`) that open a branch of that plural. Those words are message syntax,
 * not text a person reads, so they are not Latin leftovers. Only a variable the English pluralizes
 * is read as a plural, and a branch name is removed only where it opens a branch of that plural:
 * an English word inside a branch, or in front of a placeholder outside the plural, still fails.
 * @param {string} en
 * @param {string} bn
 */
function withoutPluralScaffold(en, bn) {
  const variables = new Set([...en.matchAll(/\{\s*(\w+)\s*,\s*plural\s*,/g)].map((m) => m[1]));
  if (!variables.size) return bn;
  const closeOf = (text, from) => {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return i;
    }
    return -1;
  };
  const strip = (text) => {
    let out = '';
    for (let i = 0; i < text.length; i++) {
      const head = text[i] === '{' ? text.slice(i).match(/^\{\s*(\w+)\s*,\s*plural\s*,/) : null;
      const end = head && variables.has(head[1]) ? closeOf(text, i) : -1;
      if (!head || end === -1) {
        out += text[i];
        continue;
      }
      // Inside this plural: branch name, then its body in braces, until the plural closes.
      let rest = text.slice(i + head[0].length, end);
      let inner = '';
      while (rest.trim()) {
        const branch = rest.match(/^\s*(=\d+|zero|one|two|few|many|other)\s*\{/);
        const open = branch ? branch[0].length - 1 : -1;
        const bodyEnd = branch ? closeOf(rest, open) : -1;
        if (!branch || bodyEnd === -1) {
          // Not plural syntax after all: leave the rest as written, so it is checked as text.
          inner += rest;
          rest = '';
          break;
        }
        inner += ` {${strip(rest.slice(open + 1, bodyEnd))}}`;
        rest = rest.slice(bodyEnd + 1);
      }
      out += `{${inner}}`;
      i = end;
    }
    return out;
  };
  return strip(bn);
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
  // The wrong Bengali the review file recorded (existing_bn) is a fixed sample. The shipped catalogue is
  // corrected as fixes land (PR 512 applied them), so it is no longer a source of known-wrong strings.
  const review = parseCsv(
    fs.readFileSync(
      path.join(ROOT, 'docs/localization/data/BN_EXISTING_CATALOGUE_REVIEW.csv'),
      'utf8',
    ),
  );
  const wrongBn = Object.fromEntries(review.map((r) => [r.key, r]));
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
    const row = wrongBn[k];
    // A length warning alone is not a guard catching a meaning error.
    const r = row
      ? check(row.english_now, row.existing_bn).filter((x) => !x.rule.startsWith('WARN_'))
      : [];
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
  // Fixed cases for the refinements of 2026-11-13 (owner decisions on version wording and device
  // labels, and email addresses in the English). Each must keep failing or passing as listed.
  const cases = [
    ['fail', 'A new version of VisaStack is ready.', 'VisaStack-এর একটি নতুন আপডেট প্রস্তুত।'],
    ['fail', 'Snapshot version {version} captured.', 'স্ন্যাপশটের কপি {version} নেওয়া হয়েছে।'],
    ['fail', 'Previous Versions', 'আগের ডকুমেন্ট'],
    ['pass', 'Previous Versions', 'আগের কপি'],
    ['pass', 'A new version of VisaStack is ready.', 'VisaStack-এর একটি নতুন সংস্করণ প্রস্তুত।'],
    ['fail', 'Enter your name.', 'আপনার ইমেইল ঠিকানা লিখুন।'],
    [
      'pass',
      'Enter a valid email address, like name@example.com.',
      'সঠিক একটি ইমেইল ঠিকানা লিখুন, যেমন name@example.com।',
    ],
    ['fail', 'iPhone: open Settings.', 'iPhone: Settings খুলুন।'],
    ['fail', 'iPhone: open Settings.', 'iPhone: "Preferences" খুলুন।'],
    ['pass', 'iPhone: open Settings.', 'iPhone: "Settings" খুলুন।'],
    ['pass', 'Neon Auth handles sign-in.', 'Neon Auth সাইন ইন পরিচালনা করে।'],
    // Plural messages (2026-11-13): the plural syntax the English also has is not a Latin leftover,
    // an English word inside a branch still is, and the syntax excuses nothing in a plain sentence.
    [
      'pass',
      '{count, plural, one {# request waiting} other {# requests waiting}}',
      '{count, plural, one {#টি অনুরোধ অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}',
    ],
    [
      'pass',
      '{held, plural, =1 {{held} file is waiting.} other {{held} files are waiting.}}',
      '{held, plural, =1 {{held}টি ডকুমেন্ট অপেক্ষা করছে।} other {{held}টি ডকুমেন্ট অপেক্ষা করছে।}}',
    ],
    [
      'fail',
      '{count, plural, one {# request waiting} other {# requests waiting}}',
      '{count, plural, one {# request অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}',
    ],
    [
      'fail',
      '{count, plural, one {# request waiting} other {# requests waiting}}',
      '{total, plural, one {#টি অনুরোধ অপেক্ষায়} other {#টি অনুরোধ অপেক্ষায়}}',
    ],
    ['fail', 'Requests waiting: {count}', '{count, plural, other {#টি অনুরোধ অপেক্ষায়}}'],
    ['fail', 'Show the other requests.', 'other অনুরোধগুলো দেখান।'],
    [
      'fail',
      '{count, plural, one {# answer} other {# answers}} for the other {agency}',
      '{count, plural, one {#টি উত্তর} other {#টি উত্তর}} other {agency}-এর জন্য',
    ],
    [
      'fail',
      '{count, plural, one {# answer} other {# answers}}',
      '{count, plural, one {#টি উত্তর} other answers {#টি উত্তর}}',
    ],
    [
      'pass',
      '{sent, plural, one {# sent to {agency}.} other {# sent to {agency}.}} {changed, plural, one {# was not sent.} other {# were not sent.}} Check the list.',
      '{sent, plural, one {{agency}-কে #টি পাঠানো হয়েছে।} other {{agency}-কে #টি পাঠানো হয়েছে।}} {changed, plural, one {#টি পাঠানো হয়নি।} other {#টি পাঠানো হয়নি।}} তালিকাটি দেখুন।',
    ],
  ];
  for (const [want, en, bn] of cases) {
    const r = check(en, bn).filter((x) => !x.rule.startsWith('WARN_'));
    const ok = want === 'fail' ? r.length > 0 : r.length === 0;
    say(
      `${ok ? (want === 'fail' ? 'FAILS AS EXPECTED' : 'PASSES AS EXPECTED') : want === 'fail' ? 'UNEXPECTEDLY PASSES' : 'UNEXPECTED FINDING'}  ${en} => ${bn}  ${r.map((x) => x.rule).join(',')}`,
    );
    if (!ok) bad++;
  }
  // corrected wording from the review file must pass the same checks
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
