/**
 * Refills Bengali in every surface catalogue from the register, with no source file analysis.
 *
 * The codemod fills a Bengali value only when it first converts a key. When the release rules or
 * the register change (a review queue is signed off, a hold is lifted, a draft is corrected), the
 * catalogues already on disk need the same lookup again. This is that path: a key with no Bengali
 * and exactly one register group gets the register's Bengali if the same checks pass as at
 * conversion (released queue, not held, automated checks PASS, placeholders match). Bengali that is
 * already in a catalogue is never changed. A second run changes nothing.
 *
 * A key with no register group at all (a sentence written after the census, so it has no census
 * row and no register group) can take a draft written for that catalogue key instead
 * (docs/localization/data/drafts/no-census-*.jsonl, already in final form: owner term decisions
 * and Bengali digits applied). Such a draft goes through the same gates as a register row: the
 * English it was written for must be the catalogue English exactly, the automated checks
 * (guardrail-check) must PASS, a hold on the key (KEY_HOLDBACK) keeps it English, and
 * placeholders, edge spaces and markers must match. Words that put a text in a specialist queue
 * (legal, consent, privacy, payment, official visa rule) are refused outright: a key draft has no
 * register row and no release classification, and a note it carries is written by its drafter, so
 * it can never certify its own release. Such a sentence needs a register row and its own read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { check } from '../../docs/localization/tools/guardrail-check.mjs';
import { queuesByWords } from '../../docs/localization/tools/review-queue.mjs';
import { catalogRel, readCatalog, readSources, renderCatalog, sourcesRel } from './catalog.mjs';
import { decodeEntities } from './jsx-text.mjs';
import { Register } from './register.mjs';

/** Where drafts written for a catalogue key (no census row, no register group) are kept. */
export const KEY_DRAFTS_DIR = 'docs/localization/data/drafts';
const KEY_DRAFT_FILE = /^no-census-.*\.jsonl$/;

/**
 * Catalogue keys whose key draft stays English, each with the reason (the key-draft twin of
 * HOLDBACK in register.mjs, which names register groups). Remove one only on that sign-off.
 */
export const KEY_HOLDBACK = new Map([
  [
    'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptAgencyAnswerAskUs',
    'Applicant removal screens: the sentence names the Ask Us to Remove This File action in quotes, but the Manage menu still shows it in English, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'appApplicant.appApplicantIdDocumentsManageRemoval.copyKeptLegalHold',
    'New legal wording from a machine draft, owner has not confirmed; differs from released clause SG-3b2f1526 (in the owner approval queue, RELEASE_CLASSIFICATION_2026-11-12.md).',
  ],
  [
    'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptFinishedCaseAskUs',
    'Applicant removal screens: the sentence names the Ask Us to Remove This File action in quotes, but the Manage menu still shows it in English, so a Bengali name would not match what the person sees (label in name).',
  ],
]);

/**
 * Drafts keyed by catalogue key, from every no-census-*.jsonl file (files by name, rows in
 * order). A later row for the same key is a correction and replaces the earlier one. A line that
 * is not a complete JSON row (a torn last line) is skipped, so that key stays English.
 * @param {string} root
 * @returns {Map<string, { en: string, bn: string, note: string }>}
 */
export function loadKeyDrafts(root) {
  const dir = path.join(root, KEY_DRAFTS_DIR);
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => KEY_DRAFT_FILE.test(n))
    .sort())
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof d?.catalogue_key !== 'string' || typeof d.en !== 'string') continue;
      out.set(d.catalogue_key, {
        en: d.en,
        bn: typeof d.bn === 'string' ? d.bn : '',
        note: typeof d.note === 'string' ? d.note : '',
      });
    }
  return out;
}

/**
 * Bengali for a key from its key draft, through the same gates as a register row.
 * @param {Register} reg
 * @param {string} key
 * @param {string} english the catalogue English
 * @param {{ en: string, bn: string, note: string } | undefined} draft
 * @returns {{ bn: string|null, reason: string|null }}
 */
export function resolveKeyDraft(reg, key, english, draft) {
  if (!draft) return { bn: null, reason: 'no_key_draft' };
  if (KEY_HOLDBACK.has(key)) return { bn: null, reason: `held_back:${KEY_HOLDBACK.get(key)}` };
  // A draft written for other words (the English changed since) never fills the key.
  if (draft.en !== english) return { bn: null, reason: 'key_draft_english_differs' };
  // The same queues build-register.mjs gives a register row with these words. Any specialist
  // queue is refused: nothing about a key draft can release legal, consent or payment wording.
  const queues = queuesByWords(english);
  if (queues.length) return { bn: null, reason: `key_draft_specialist_queue:${queues[0]}` };
  if (/OFFICIAL_RULE/.test(draft.note))
    return { bn: null, reason: 'review_queue_not_signed_off:OFFICIAL_VISA_REQUIREMENT' };
  const all = draft.bn ? check(english, draft.bn.normalize('NFC')) : [];
  // A register draft has the owner's Bengali digits applied before its checks; a key draft is
  // final as written, so Latin digits in its prose fail here instead of shipping.
  const findings = all.filter((x) => !x.rule.startsWith('WARN_') || x.rule === 'WARN_LATIN_DIGITS');
  const checks = findings.length ? findings.map((x) => x.rule).join(' ; ') : 'PASS';
  // resolveRow applies the rest: the released queues, PASS, no marker or em dash, placeholders,
  // plural shape and edge spaces. A key draft is written for this key's own words, so it may carry
  // a plural message: the web translator formats the same plural subset in both languages, and the
  // variables, the plural variables and the nesting must match the English exactly.
  const r = reg.resolveRow(
    {
      semantic_group: key,
      review_queue: 'ORDINARY_UI',
      automated_checks: checks,
      bn_BD_draft: draft.bn,
    },
    english,
    { plural: true },
  );
  return { bn: r.bn, reason: r.reason };
}

/** Surfaces that have a catalogue and a sources map. */
/**
 * The only reasons a key with a register group may fall back to a draft written for the key: the
 * group's own row is released and passes, but it words the plural with an English-only switch or
 * names a placeholder differently from the catalogue, so it can never fit this key. A held group,
 * an unreleased queue or a failing row never falls back.
 */
export const KEY_DRAFT_FALLBACK_REASONS = new Set([
  'english_is_plural_message',
  'bn_placeholders_differ',
]);

export function listSurfaces(root) {
  const dir = path.join(root, 'apps/web/src/i18n');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sources.json'))
    .map((f) => f.slice(0, -'.sources.json'.length))
    .sort();
}

/**
 * With `groups`, only keys of those register groups are filled: a release of named groups (the
 * owner's sign-off of a set of rows) fills nothing else, even where a draft now exists.
 *
 * With `keyPrefix`, only catalogue keys that start with it are filled (one screen's own sentences,
 * `--key-prefix` on codemod.mjs --refill-bn).
 *
 * @param {{ root: string, register?: Register, keyDrafts?: Map<string, { en: string, bn: string, note: string }>, surfaces?: string[], groups?: ReadonlySet<string>, keyPrefix?: string, dryRun?: boolean, format?: (root: string, rels: string[]) => void }} o
 * @returns {{ surface: string, filled: string[] }[]}
 */
export function refillBengali({
  root,
  register,
  keyDrafts,
  surfaces,
  groups,
  keyPrefix,
  dryRun = false,
  format,
}) {
  if (keyPrefix !== undefined && !keyPrefix.trim())
    throw new Error('refillBengali: keyPrefix must be a non-empty catalogue key prefix');
  const reg = register ?? Register.load(root);
  // A release of named groups never fills from key drafts, so they are not even read then.
  const drafts = groups ? new Map() : (keyDrafts ?? loadKeyDrafts(root));
  const out = [];
  const written = [];
  for (const surface of surfaces ?? listSurfaces(root)) {
    const catAbs = path.join(root, catalogRel(surface));
    const catalog = readCatalog(catAbs);
    const sources = readSources(path.join(root, sourcesRel(surface)));
    const bn = { ...catalog.bn };
    const filled = [];
    for (const key of Object.keys(catalog.en).sort()) {
      if (keyPrefix !== undefined && !key.startsWith(keyPrefix)) continue;
      const group = sources[key];
      if (bn[key] !== undefined) continue;
      let r;
      if (typeof group === 'string') {
        if (group.includes('|')) continue;
        if (groups && !groups.has(group)) continue;
        r = reg.resolveGroup(group, catalog.en[key]);
        // The group's row passes but cannot fit this key's plural or placeholder names: a draft
        // written for the key itself may fill it, through every gate a key draft has.
        if (!r.bn && !groups && KEY_DRAFT_FALLBACK_REASONS.has(r.reason ?? '') && drafts.has(key))
          r = resolveKeyDraft(reg, key, catalog.en[key], drafts.get(key));
      } else {
        // No register group: only a draft written for this exact key may fill it, and never in a
        // release of named groups.
        if (groups || group !== null) continue;
        r = resolveKeyDraft(reg, key, catalog.en[key], drafts.get(key));
      }
      if (!r.bn) continue;
      // The register keeps the Bengali as written in the source (HTML entities included); the
      // catalogue holds the text people read, the same decoding the codemod applies to the English.
      const decoded = decodeEntities(r.bn);
      bn[key] = decoded.text ?? r.bn;
      filled.push(key);
    }
    out.push({ surface, filled });
    if (!filled.length || dryRun) continue;
    fs.writeFileSync(catAbs, renderCatalog(surface, catalog.en, bn));
    written.push(catalogRel(surface));
  }
  if (format && written.length) format(root, written);
  return out;
}
