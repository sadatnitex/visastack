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
    'SG-0092181b',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-1a432089',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-319b7d1b',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-4249425b',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-57024979',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-5dfd4948',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-5e68244c',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-751ac880',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-7cebc450',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-85a723da',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-8b062101',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-9f18aa86',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-a178f7cf',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-ae0400c3',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-b0cc740f',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-d028e6a4',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-d62d6a52',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  [
    'SG-f0429b7a',
    'Access control: who may see or act on what, or what a grant allows; waits for the owner sign-off.',
  ],
  ['SG-0006fab9', 'AI features and tools (AI processing): waits for the owner sign-off.'],
  ['SG-697612cb', 'AI features and tools (AI processing): waits for the owner sign-off.'],
  ['SG-84755ca2', 'AI features and tools (AI processing): waits for the owner sign-off.'],
  [
    'SG-03518c54',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-21824069',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-2b43768d',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-363e13bd',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-37468a51',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-7e0dba4b',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-899d13d1',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-8dca9740',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-8ee1a9d7',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-b0b7a8b8',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-b21f69f6',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-bdbe4cd8',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-e00eb31b',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  [
    'SG-ed74236c',
    'Client consent and sharing terms: what the traveller agrees to share or decides; waits for the owner sign-off.',
  ],
  ['SG-07e1fab2', 'Invitation expiry and acceptance terms: waits for the owner sign-off.'],
  ['SG-48a3b6e0', 'Invitation expiry and acceptance terms: waits for the owner sign-off.'],
  ['SG-d9561170', 'Invitation expiry and acceptance terms: waits for the owner sign-off.'],
  ['SG-65a98d6a', 'Virus scanning notices: a risk statement, waits for the owner sign-off.'],
  ['SG-e5a8b9e8', 'Virus scanning notices: a risk statement, waits for the owner sign-off.'],
  ['SG-04033af1', 'Billing and invoices (payment): waits for the owner sign-off.'],
  ['SG-11f4fd8f', 'Billing and invoices (payment): waits for the owner sign-off.'],
  [
    'SG-1f2c844a',
    'Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.',
  ],
  [
    'SG-c87e54e8',
    'Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.',
  ],
  [
    'SG-7a475bd6',
    'Access: says whether a traveller has granted an organization access; waits for the owner sign-off.',
  ],
  [
    'SG-98b5d44d',
    'Access: says what the organization can still act on; waits for the owner sign-off.',
  ],
  [
    'SG-576d295d',
    'Privacy promise: says what a person chose to send; waits for the owner sign-off.',
  ],
  [
    'SG-c60f522e',
    'Privacy promise: says what is needed and when anything is sent; waits for the owner sign-off.',
  ],
  [
    'SG-e3b1eece',
    'Issuer confirmation and readiness: states what is confirmed; waits for the owner sign-off.',
  ],
  [
    'SG-d6e09908',
    'Accessible name must match the visible button, which is still English here; stays English until the button is converted.',
  ],
  [
    'SG-678c621d',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-d9bcf36d',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-e53a446b',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-289e563b',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
  ],
  [
    'SG-dcadd581',
    'Issuer confirmation and the traveller sign-off state what is confirmed or agreed: waits for the owner sign-off.',
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
