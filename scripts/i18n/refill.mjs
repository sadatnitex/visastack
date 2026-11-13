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
 * (docs/localization/data/drafts/no-census-*.jsonl). Such a draft goes through the same gates as a
 * register row: the English it was written for must be the catalogue English exactly, the same
 * automated checks (guardrail-check) must PASS, official visa rule wording stays English, a hold
 * on the key keeps it English, and placeholders, edge spaces and markers must match (resolveRow).
 */
import fs from 'node:fs';
import path from 'node:path';
import { check } from '../../docs/localization/tools/guardrail-check.mjs';
import { catalogRel, readCatalog, readSources, renderCatalog, sourcesRel } from './catalog.mjs';
import { decodeEntities } from './jsx-text.mjs';
import { Register } from './register.mjs';

/** Where drafts written for a catalogue key (no census row, no register group) are kept. */
export const KEY_DRAFTS_DIR = 'docs/localization/data/drafts';
const KEY_DRAFT_FILE = /^no-census-.*\.jsonl$/;

/**
 * Official visa rule wording, the same pattern build-register.mjs (OFFICIAL_RE) uses to put a
 * register row in the OFFICIAL_VISA_REQUIREMENT queue, which is not released. A key draft has no
 * queue of its own, so it is classified by the same words. refill.test.mjs pins the two equal.
 */
export const OFFICIAL_RE =
  /\b(embassy|consulate|visa (rule|requirement|route|centre|center|application centre)|official (source|checklist|rule|requirement|page|website|pack)|immigration authority|checklist pack|issuing authority)\b/i;

/**
 * Drafts keyed by catalogue key, from every no-census-*.jsonl file. A key drafted twice is
 * ambiguous and is left out, so neither draft fills it.
 * @param {string} root
 * @returns {Map<string, { en: string, bn: string, note: string }>}
 */
export function loadKeyDrafts(root) {
  const dir = path.join(root, KEY_DRAFTS_DIR);
  const out = new Map();
  const twice = new Set();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => KEY_DRAFT_FILE.test(n))
    .sort())
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const d = JSON.parse(line);
      if (typeof d.catalogue_key !== 'string' || typeof d.en !== 'string') continue;
      if (out.has(d.catalogue_key)) twice.add(d.catalogue_key);
      out.set(d.catalogue_key, {
        en: d.en,
        bn: typeof d.bn === 'string' ? d.bn : '',
        note: typeof d.note === 'string' ? d.note : '',
      });
    }
  for (const k of twice) out.delete(k);
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
  // A draft written for other words (the English changed since) never fills the key.
  if (draft.en !== english) return { bn: null, reason: 'key_draft_english_differs' };
  const queue =
    OFFICIAL_RE.test(english) || /OFFICIAL_RULE/.test(draft.note)
      ? 'OFFICIAL_VISA_REQUIREMENT'
      : 'ORDINARY_UI';
  const findings = draft.bn
    ? check(english, draft.bn.normalize('NFC')).filter((x) => !x.rule.startsWith('WARN_'))
    : [];
  const checks = findings.length ? findings.map((x) => x.rule).join(' ; ') : 'PASS';
  // resolveRow applies the rest: a hold on the key, the released queues, PASS, no marker or em
  // dash, placeholders, plural shape and edge spaces.
  const r = reg.resolveRow(
    { semantic_group: key, review_queue: queue, automated_checks: checks, bn_BD_draft: draft.bn },
    english,
  );
  return { bn: r.bn, reason: r.reason };
}

/** Surfaces that have a catalogue and a sources map. */
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
 * With `keys`, only those catalogue keys are filled (one lane's own sentences).
 *
 * @param {{ root: string, register?: Register, keyDrafts?: Map<string, { en: string, bn: string, note: string }>, surfaces?: string[], groups?: ReadonlySet<string>, keys?: ReadonlySet<string>, dryRun?: boolean, format?: (root: string, rels: string[]) => void }} o
 * @returns {{ surface: string, filled: string[] }[]}
 */
export function refillBengali({
  root,
  register,
  keyDrafts,
  surfaces,
  groups,
  keys,
  dryRun = false,
  format,
}) {
  const reg = register ?? Register.load(root);
  const drafts = keyDrafts ?? loadKeyDrafts(root);
  const out = [];
  const written = [];
  for (const surface of surfaces ?? listSurfaces(root)) {
    const catAbs = path.join(root, catalogRel(surface));
    const catalog = readCatalog(catAbs);
    const sources = readSources(path.join(root, sourcesRel(surface)));
    const bn = { ...catalog.bn };
    const filled = [];
    for (const key of Object.keys(catalog.en).sort()) {
      if (keys && !keys.has(key)) continue;
      const group = sources[key];
      if (bn[key] !== undefined) continue;
      let r;
      if (typeof group === 'string') {
        if (group.includes('|')) continue;
        if (groups && !groups.has(group)) continue;
        r = reg.resolveGroup(group, catalog.en[key]);
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
