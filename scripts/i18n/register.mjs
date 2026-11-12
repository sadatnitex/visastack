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
    'SG-e6123c0d',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-0016aa98',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-5018af46',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-e7158ae3',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-afe937a3',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-ce511844',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-81bf750c',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-67266d24',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-61e87632',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-8829c695',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-72d9142d',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-a59d20ba',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-882d2ab6',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-6dc10a9f',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-24776023',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-1436ceee',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-1065be84',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-5463c56c',
    'Applicant screens: AI processing or AI approval wording (waits for the owner sign-off with the other AI and consent text).',
  ],
  [
    'SG-b9d38c86',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-0b6663fd',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-226bab50',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-f6430216',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-03b8a6b0',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-4d48fa01',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-197fdeca',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-eac05478',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-3a222fbf',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-e78bd437',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-f1f5bccb',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-7b432da4',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-fe795501',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-a17de272',
    'Applicant screens: Promise about what happens to a file (stored, checked, kept, removed, replaced): waits for the owner sign-off.',
  ],
  [
    'SG-66f87a10',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-583aa6b5',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-3141220f',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-16600835',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-37c14fc0',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-b41c58b1',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-3d6b855e',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-e3fdc097',
    'Applicant screens: Disclaimer or official visa rule wording: waits for the owner sign-off.',
  ],
  [
    'SG-eb382184',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-8546093a',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-de969496',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-59d94eb1',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-5a6c4e41',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-b08c4520',
    'Applicant screens: Process promise about checking saved documents against a checklist: waits for the owner sign-off.',
  ],
  [
    'SG-d7a62e22',
    'Applicant screens: Status of automatic reading (AI processing): waits for the owner sign-off.',
  ],
  [
    'SG-1549c176',
    'Applicant screens: Statement about what visa forms require: waits for the owner sign-off.',
  ],
  [
    'SG-ff7d2a1c',
    'Applicant screens: Statement about what visa forms require: waits for the owner sign-off.',
  ],
  [
    'SG-d9696fe7',
    'Applicant screens: Says a value was read from the document by automatic reading (AI processing): waits for the owner sign-off.',
  ],
  [
    'SG-ac40a214',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-338d92d1',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-c9a7f414',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-aa9771db',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-19b168cd',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-68e8afb4',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-fe5feab6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-6cdf21a6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-a8684ed6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-dedaa54b',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-4e812a3e',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-826d2c99',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-153f9777',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-c1fb8969',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-658e1cac',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-d2c91826',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-ba0fbeb7',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-e4498255',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-d5319908',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8d14d065',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-e8727ba5',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8881fc69',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8fd6641e',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-bd7b343f',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-9d878677',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-a7694752',
    'Applicant screens: Joiner text whose trailing space carries the layout, so its Bengali would run into the next sentence.',
  ],
  [
    'SG-6775fd3b',
    'Applicant screens: Heading over what automatic reading found (AI processing): waits for the owner sign-off.',
  ],
  // Wave E: case screens and the document collection flow.
  ['SG-094bebc7', 'Case answer status "Submitted to Agency": a sharing outcome, owner sign-off.'],
  [
    'SG-45ad6a0b',
    'What the agency can open of a submitted answer: access control wording, owner sign-off.',
  ],
  ['SG-2b1514c9', 'Agency not yet reviewed: a trust status about an agency, owner sign-off.'],
  [
    'SG-d39a9da3',
    'Nothing can be shared until the agency is reviewed: sharing and access wording, owner sign-off.',
  ],
  ['SG-dc081055', 'Private link opened has shared nothing: a sharing promise, owner sign-off.'],
  ['SG-d7bcf439', 'Confirm it is you, no account is made: a privacy promise, owner sign-off.'],
  [
    'SG-a5fa0621',
    'Checked date and confirm final requirements with the authority: official visa requirement wording, owner sign-off.',
  ],
  [
    'SG-9574696f',
    'Case removed for good with its contents: a data deletion promise, owner sign-off.',
  ],
  [
    'SG-8987f99a',
    'What a sponsor or family member sees of your record: sharing wording, owner sign-off.',
  ],
  [
    'SG-991b05ef',
    'Which agency notes are shared and which never are: sharing and access wording, owner sign-off.',
  ],
  ['SG-079d1f0e', 'What the contributor will see: sharing wording, owner sign-off.'],
  ['SG-e4a97e33', 'Who sees a complaint: access control and privacy promise, owner sign-off.'],
  ['SG-98c55098', 'Who reviews a complaint: access control and privacy promise, owner sign-off.'],
  [
    'SG-f0bd6092',
    'Nothing is sent until you share it yourself: a sharing promise, owner sign-off.',
  ],
  [
    'SG-63dab094',
    'Generated from confirmed evidence, not AI-written: a claim about AI behaviour, owner sign-off.',
  ],
  [
    'SG-d3914f71',
    'Reason to reject or request a correction of an agency snapshot: approval action wording, owner sign-off.',
  ],
  [
    'SG-5efa8d43',
    'Access and permissions stay separate per case: access control wording, owner sign-off.',
  ],
  [
    'SG-84514c27',
    'Trip date checks are not country rules: official visa rule wording, owner sign-off.',
  ],
  [
    'SG-c0b36ea9',
    'Done or cancelled task count: the number word comes from an English helper, so the sentence would mix scripts; waits for a proper plural message.',
  ],
  [
    'SG-4fbf3546',
    'Optional marker with a leading separator: the Bengali drops the space that joins it to the label.',
  ],
  [
    'SG-c60ff807',
    'Already sent note that follows other text: the Bengali drops the leading space.',
  ],
  [
    'SG-cb6538b8',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-260ff35f',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-e004a268',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-86f84a55',
    'Button name read by screen readers while the visible text is still English (label in name).',
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
