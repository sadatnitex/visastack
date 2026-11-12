/**
 * Bengali lookup from docs/localization/VISASTACK_TRANSLATION_REGISTER.csv.
 *
 * A message's register row is found first through the census (same file, line and English,
 * which keeps homographs apart), then by exact English when exactly one register row has it.
 * Bengali is used only when the row's automated_checks starts with PASS, its placeholders are
 * the message's placeholders, and it holds no em dash or unresolved marker. Anything else is
 * left to English fallback with a reason.
 *
 * Owner rule (the language switch goes live): Bengali comes only from register rows in the
 * ordinary-screen review queue. Rows in the commercial, privacy/consent/legal and official visa
 * requirement queues (and any row with no queue) keep English until the owner signs them off,
 * whatever their automated checks say. Add a queue to RELEASED_QUEUES only on that sign-off.
 */

/** Review queues whose Bengali must not ship yet. Anything not ORDINARY_UI is held back. */
export const RELEASED_QUEUES = new Set(['ORDINARY_UI']);
import { readIfExists } from './catalog.mjs';

export const REGISTER_REL = 'docs/localization/VISASTACK_TRANSLATION_REGISTER.csv';
export const CENSUS_REL = 'docs/localization/VISASTACK_UI_SOURCE_CENSUS.csv';

/** RFC 4180 CSV -> array of objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** The census/register spelling of a text: whitespace collapsed, em dash as a marker. */
export const registerForm = (s) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\u2014/g, '[U+2014]');

export const placeholdersOf = (msg) => {
  const names = new Set();
  for (const m of msg.matchAll(/\{(\w+)(?:\}|,\s*plural\s*,)/g)) names.add(m[1]);
  return [...names].sort();
};

export class Register {
  constructor({ registerCsv = '', censusCsv = '' } = {}) {
    this.byGroup = new Map();
    this.byEnglish = new Map();
    for (const r of registerCsv ? parseCsv(registerCsv) : []) {
      this.byGroup.set(r.semantic_group, r);
      const list = this.byEnglish.get(r.english) ?? [];
      list.push(r);
      this.byEnglish.set(r.english, list);
    }
    this.census = new Map();
    for (const c of censusCsv ? parseCsv(censusCsv) : []) {
      if (!c.semantic_group) continue;
      this.census.set(`${c.file}|${c.line_start}|${c.english}`, c.semantic_group);
    }
  }

  static load(root) {
    const read = (rel) => {
      const p = `${root}/${rel}`;
      return readIfExists(p) ?? '';
    };
    return new Register({ registerCsv: read(REGISTER_REL), censusCsv: read(CENSUS_REL) });
  }

  /**
   * @param {{ file: string, line: number, censusText: string, english: string }} unit
   * @returns {{ group: string|null, bn: string|null, reason: string|null }}
   */
  lookup(unit) {
    const forms = [...new Set([registerForm(unit.censusText), registerForm(unit.english)])];
    let row = null;
    for (const f of forms) {
      const g = this.census.get(`${unit.file}|${unit.line}|${f}`);
      if (g && this.byGroup.has(g)) {
        row = this.byGroup.get(g);
        break;
      }
    }
    if (!row) {
      const groups = new Map();
      for (const f of forms)
        for (const r of this.byEnglish.get(f) ?? []) groups.set(r.semantic_group, r);
      if (groups.size > 1)
        return {
          group: [...groups.keys()].sort().join('|'),
          bn: null,
          reason: 'register_ambiguous',
        };
      row = groups.values().next().value ?? null;
    }
    if (!row) return { group: null, bn: null, reason: 'no_register_match' };
    const group = row.semantic_group;
    const queue = row.review_queue ?? '';
    if (!RELEASED_QUEUES.has(queue))
      return { group, bn: null, reason: `review_queue_not_signed_off:${queue || 'none'}` };
    const checks = row.automated_checks ?? '';
    if (!checks.startsWith('PASS'))
      return { group, bn: null, reason: `checks_not_pass:${checks.split(/[;|:]/)[0] || 'empty'}` };
    const draft = (row.bn_BD_draft ?? '').normalize('NFC');
    if (!draft.trim()) return { group, bn: null, reason: 'no_bn_draft' };
    if (/\u2014|\[U\+[0-9A-F]+\]/.test(draft))
      return { group, bn: null, reason: 'bn_has_marker_or_em_dash' };
    if (/[{}]/.test(unit.english.replace(/\{\w+\}/g, '')))
      return { group, bn: null, reason: 'english_is_plural_message' };
    const a = placeholdersOf(unit.english).join(',');
    const b = placeholdersOf(draft).join(',');
    if (a !== b) return { group, bn: null, reason: 'bn_placeholders_differ' };
    if (/[{}]/.test(draft.replace(/\{\w+\}/g, '')))
      return { group, bn: null, reason: 'bn_stray_brace' };
    return { group, bn: draft, reason: null };
  }
}
