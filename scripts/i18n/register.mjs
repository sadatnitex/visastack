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

/**
 * Register rows that stay English even though their review queue is released, each with the
 * reason. Add a row here when the owner or the review decides a specific string waits; remove it
 * only on that sign-off.
 */
export const HOLDBACK = new Map([
  [
    'SG-22bda9c8',
    'Public beta risk notice (real details, virus scanning): wording waits for the owner sign-off.',
  ],
  [
    'SG-0f9d5b37',
    'Consent acknowledgement (marketing, AI processing, sharing): wording waits for the owner sign-off.',
  ],
  [
    'SG-361e0c20',
    'Terms: a legal document name, held English like Privacy until the owner signs off.',
  ],
  [
    'SG-57e8fee4',
    'Free-at-your-own-risk notice (virus scanning not yet on): a risk notice, waits for the owner sign-off.',
  ],
  [
    'SG-8939253f',
    'Privacy heading (how information is treated): privacy wording waits for the owner sign-off.',
  ],
  [
    'SG-fe6d2f71',
    'Sharing flow description that mentions agreeing to share: consent wording waits for the owner sign-off.',
  ],
  [
    'SG-cda9a1ac',
    'Sharing starts with permission: a consent promise, waits for the owner sign-off.',
  ],
  [
    'SG-461caf20',
    'Trust page disclaimer (no approval guarantees): legal-style disclaimer, waits for the owner sign-off.',
  ],
  ['SG-b6f48122', 'Private by Design: a privacy claim, waits for the owner sign-off.'],
  [
    'SG-f92f9f0f',
    'Not Currently Verified: status of official visa information, waits for the owner sign-off.',
  ],
  [
    'SG-8e79eb73',
    'Official Channel: points to official visa sources, waits for the owner sign-off.',
  ],
  [
    'SG-7d8d7a57',
    'Invitation terms of sharing (what happens if you accept): consent wording, owner sign-off.',
  ],
  [
    'SG-c26f3e5b',
    'Invitation consent statement (nothing shared until you accept): owner sign-off.',
  ],
  [
    'SG-1fec77cc',
    'Invitation acceptance statement (opening the link accepts nothing): owner sign-off.',
  ],
  [
    'SG-f5a73aec',
    'Invitation consent withdrawal statement (stop sharing at any time): owner sign-off.',
  ],
  ['SG-f8a50812', 'Invitation expiry rule (7 days) and revocation: a stated rule, owner sign-off.'],
  [
    'SG-57b3157f',
    'Agency invitation promise on the home page (you approve it, you can stop it): consent wording, owner sign-off.',
  ],
  [
    'SG-58fc0338',
    'Your records belong to you, choose the recipient: a sharing and ownership promise, owner sign-off.',
  ],
  [
    'SG-4bfc56d4',
    'Review, pause or end future access: a statement about stopping sharing, owner sign-off.',
  ],
  [
    'SG-a5b2278c',
    'A suggestion stays separate until you approve it: a promise about AI and confirmed facts, owner sign-off.',
  ],
  [
    'SG-2604b090',
    'AI never changes your profile on its own: a promise about AI behaviour, owner sign-off.',
  ],
  [
    'SG-e956303b',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-0c3f69ec',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-192889ed',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-fbccaafa',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-b5644201',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-c68a7790',
    'Consent button or consent explanation (AI reading, sharing, marketing, processing): wording waits for the owner sign-off.',
  ],
  [
    'SG-58cc6dc1',
    'Document requirement for a country route (how recent a document must be): official visa-rule content stays English.',
  ],
  [
    'SG-50c83703',
    'Sharing permission statement: wording waits for the owner sign-off with the other sharing and consent text.',
  ],
  [
    'SG-00706ded',
    'Invitation and sharing choice statement: wording waits for the owner sign-off with the other sharing and consent text.',
  ],
  [
    'SG-9e771a8e',
    'Joiner word between names (" or "): its spaces carry the layout and the sentence around it is still English.',
  ],
  [
    'SG-674ee0dc',
    'Shared-access end date label: access and expiry wording waits for the owner sign-off.',
  ],
  [
    'SG-8205ffbd',
    'Invitation recovery help (new link or invited email): invitation access wording waits for the owner sign-off.',
  ],
  [
    'SG-515d1469',
    'Invitation expiry label: invitation expiry wording waits for the owner sign-off.',
  ],
  [
    'SG-750b0e73',
    'Invitation unavailable heading: invitation status wording waits for the owner sign-off.',
  ],
  [
    'SG-03d5ab6c',
    'Opening an invitation grants no access: a consent statement, waits for the owner sign-off.',
  ],
  [
    'SG-8600dbb5',
    'Permissions heading on a sharing invitation: access control wording waits for the owner sign-off.',
  ],
  [
    'SG-b1994b75',
    'Agency AI note on the client invitation: AI and consent wording waits for the owner sign-off.',
  ],
  ['SG-e432687f', 'AI Tools consent toggle: AI processing wording waits for the owner sign-off.'],
  ['SG-02122e22', 'Turn On consent toggle label: consent wording waits for the owner sign-off.'],
  [
    'SG-69e97063',
    'What an agency can do if you accept: access wording waits for the owner sign-off.',
  ],
  ['SG-cdca8c7b', 'Turn these on before accepting: consent wording waits for the owner sign-off.'],
  [
    'SG-1206824f',
    'Contributor request sent to a different email: access control wording waits for the owner sign-off.',
  ],
  [
    'SG-056ff2bb',
    'Error page promise that saved work is safe: a data safety promise, waits for the owner sign-off.',
  ],
  [
    'SG-a70820b8',
    'App connection duration (How Long): authorization wording waits for the owner sign-off.',
  ],
  ['SG-a4126292', 'Answer an AI app: authorization wording waits for the owner sign-off.'],
  [
    'SG-3fb2aa39',
    'AI App Access heading: AI and authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-cc574f29',
    'AI App Access heading (variant): AI and authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-711744f6',
    'Choose a record to connect to an AI app: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-fab4e436',
    'Choose the record an app may read: authorization wording waits for the owner sign-off.',
  ],
  ['SG-48c8ec6a', 'Connect an app: authorization wording waits for the owner sign-off.'],
  [
    'SG-3bf94aa3',
    'Connect an app for an agency: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-6e5e6fff',
    'Connect an app for an agency you run: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-ee296cf8',
    'Warning that an app runs on this computer: authorization wording waits for the owner sign-off.',
  ],
  [
    'SG-cdb5fd11',
    'No records to connect: authorization screen wording waits for the owner sign-off.',
  ],
]);

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
    if (HOLDBACK.has(group)) return { group, bn: null, reason: `held_back:${HOLDBACK.get(group)}` };
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
