/**
 * Bengali lookup from docs/localization/VISASTACK_TRANSLATION_REGISTER.csv.
 *
 * A message's register row is found first through the census (same file, line and English,
 * which keeps homographs apart), then by exact English when exactly one register row has it.
 * Bengali is used only when the row's automated_checks starts with PASS, its placeholders are
 * the message's placeholders, and it holds no em dash or unresolved marker. Anything else is
 * left to English fallback with a reason.
 *
 * Owner rule (the language switch goes live): Bengali comes only from register rows in a released
 * review queue. On 2026-11-12 the owner signed off the ordinary-screen, commercial and
 * privacy/consent/legal queues (a blanket approval, not a line-by-line reading). Rows in the
 * official visa requirement queue (and any row with no queue) keep English, whatever their
 * automated checks say. Add a queue to RELEASED_QUEUES only on the owner's sign-off.
 */

/** Review queues whose Bengali may ship. Anything else (official visa requirements, no queue) is held back. */
export const RELEASED_QUEUES = new Set(['ORDINARY_UI', 'COMMERCIAL', 'PRIVACY_CONSENT_LEGAL']);
import { readIfExists } from './catalog.mjs';

/**
 * Register rows that stay English even though their review queue is released, each with the
 * reason. Add a row here when the owner or the review decides a specific string waits; remove it
 * only on that sign-off.
 */
export const HOLDBACK = new Map([
  [
    'SG-01aeac1c',
    'Held in English for a technical reason: English-only size label (mbLabel) filled into the sentence.',
  ],
  [
    'SG-01e34e77',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for minors.',
  ],
  [
    'SG-02122e22',
    'Held in English for a technical reason: English-only consent label filled into the sentence (label in name).',
  ],
  [
    'SG-02a56416',
    'Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.',
  ],
  [
    'SG-04e98a42',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt reference (receipt record content).',
  ],
  ['SG-066180d4', 'english word inside bengali sentence'],
  [
    'SG-0a12f492',
    'Accessible name must match the visible button, which is still English here (Remove); stays English until the button is converted.',
  ],
  [
    'SG-0a629d98',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt statement (receipt record content).',
  ],
  [
    'SG-0b6663fd',
    'Held in English for a technical reason: English-only upload notice filled into the sentence.',
  ],
  [
    'SG-0c3da2e7',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-0e9f785b',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): official visa fee wording.',
  ],
  ['SG-103526c4', 'english word inside bengali sentence'],
  [
    'SG-11f4fd8f',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt amount line (receipt record content).',
  ],
  [
    'SG-153f9777',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-1549c176',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): what most visa forms ask for first.',
  ],
  [
    'SG-16600835',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): embassy original-paper rule.',
  ],
  [
    'SG-19b168cd',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-1d11e900',
    'Request thread label beside a date and time that is still English (a Bengali label and an English date in one sentence); held until dates are localised.',
  ],
  [
    'SG-1f2c844a',
    'Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.',
  ],
  [
    'SG-21e2947f',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for minors.',
  ],
  [
    'SG-260ff35f',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-2625eb6a',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt statement (receipt record content).',
  ],
  [
    'SG-2e2357fd',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): official fees and application channels.',
  ],
  [
    'SG-32f5aefc',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): passport validity requirement for a route.',
  ],
  [
    'SG-338d92d1',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-37c14fc0',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): route rule: evidence must be dated within a set window.',
  ],
  [
    'SG-3a35db0e',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt title (receipt record content).',
  ],
  [
    'SG-3d6b855e',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): heading over route date rules.',
  ],
  [
    'SG-4bd5843b',
    'Remove: {name} (accessible name of the Remove button): the visible button text stays English, so the name waits with it.',
  ],
  [
    'SG-4e812a3e',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-4fbf3546',
    'Optional marker with a leading separator: the Bengali drops the space that joins it to the label.',
  ],
  [
    'SG-575944d9',
    'Held in English for a technical reason: no screen shows it today: the large export panel only draws a job that is still active, so this failed-job badge cannot be rendered.',
  ],
  [
    'SG-58cc6dc1',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for a country route (how recent a document must be).',
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
    'SG-5d43545f',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for minors.',
  ],
  [
    'SG-5e7adbab',
    "Safe copy row button: its screen-reader name is 'Select/Accept/Remove box N', which has no Bengali draft and stays English, so the visible text stays English too (label in name).",
  ],
  [
    'SG-61e87632',
    'Held in English for a technical reason: English-only state word filled into the sentence.',
  ],
  [
    'SG-658e1cac',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-6840bbdb',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-68e8afb4',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-6cdf21a6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-742d2250',
    'Held in English for a technical reason: the end date is written as an English date inside the sentence; waits until dates are localised.',
  ],
  [
    'SG-75b245d1',
    'Opening words of the show-all toggle must match its English closing words; stays English until the toggle is converted.',
  ],
  [
    'SG-76e5623e',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): pay the official fee where the authority says.',
  ],
  [
    'SG-79505021',
    'Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.',
  ],
  [
    'SG-7ba0413d',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for minors.',
  ],
  [
    'SG-7fed393b',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-826d2c99',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-8546093a',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-86f84a55',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-8881fc69',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8d14d065',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-8fd6641e',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-95b07104',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): official government fee wording.',
  ],
  [
    'SG-9d878677',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-9e771a8e',
    'Joiner word between names (" or "): its spaces carry the layout and the sentence around it is still English.',
  ],
  [
    'SG-a5fa0621',
    'Held after reading the Bengali: official authority is rendered as government authority, which says more than the English.',
  ],
  [
    'SG-a7694752',
    'Applicant screens: Joiner text whose trailing space carries the layout, so its Bengali would run into the next sentence.',
  ],
  [
    'SG-a818802f',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): Official Fee label.',
  ],
  [
    'SG-a8684ed6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-aa9771db',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-ac40a214',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-acdb0e90',
    'Request thread label beside a date and time that is still English (a Bengali label and an English date in one sentence); held until dates are localised.',
  ],
  [
    'SG-ad36e94f',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): embassy original-paper rule.',
  ],
  [
    'SG-aeff30b3',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt line with an amount and a billing date (receipt record content).',
  ],
  [
    'SG-afed0db1',
    'Held in English for a technical reason: date from the non-locale helper formatTimestampDate at the call site.',
  ],
  [
    'SG-b1994b75',
    'Held in English for a technical reason: English-only agency note filled into the sentence.',
  ],
  [
    'SG-b3edb4f6',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): credit note on an invoice (invoice record content).',
  ],
  [
    'SG-b41c58b1',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): route rule: documents dated within a set window.',
  ],
  [
    'SG-b4a4f931',
    'Accessible name of the show-all toggle must match its visible words, which are still English here; stays English until the toggle is converted.',
  ],
  [
    'SG-b59bc29b',
    'Held in English for a technical reason: English-only description filled into the sentence.',
  ],
  [
    'SG-b6c2f783',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): embassy original-paper rule.',
  ],
  [
    'SG-b8f9ef37',
    'Held in English for a technical reason: date from the non-locale helper formatTimestampDate at the call site.',
  ],
  [
    'SG-ba0fbeb7',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-bd7b343f',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-c0b36ea9',
    'Done or cancelled task count: the number word comes from an English helper, so the sentence would mix scripts; waits for a proper plural message.',
  ],
  [
    'SG-c1fb8969',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-c55cd000',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-c60ff807',
    'Already sent note that follows other text: the Bengali drops the leading space.',
  ],
  [
    'SG-c67c0fbc',
    "Safe copy row button: its screen-reader name is 'Select/Accept/Remove box N', which has no Bengali draft and stays English, so the visible text stays English too (label in name).",
  ],
  [
    'SG-c87bb1a1',
    'Held in English for a technical reason: date from the non-locale helper formatBillingDate (English month names).',
  ],
  [
    'SG-c87e54e8',
    'Number or date inside the sentence is not yet formatted for Bengali digits here; stays English until it is.',
  ],
  [
    'SG-c9a7f414',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-cb6538b8',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-ccadbccd',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt issued line (receipt record content).',
  ],
  [
    'SG-ccbd8ad0',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): label for the embassy original-paper rule.',
  ],
  [
    'SG-d0d5e75c',
    'Held after reading the Bengali: the English word sign-off is rendered as final consent, which says more than the English.',
  ],
  [
    'SG-d10ae531',
    'Invoice and receipt record content stays English with a Bengali note (owner decision 2026-11-12): receipt number (receipt record content).',
  ],
  [
    'SG-d2c91826',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-d5319908',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-d6e09908',
    'Accessible name must match the visible button, which is still English here; stays English until the button is converted.',
  ],
  [
    'SG-d9561170',
    'Held in English for a technical reason: date from the non-locale helper formatTimestampDate at the call site.',
  ],
  [
    'SG-d9696fe7',
    'Held in English for a technical reason: English-only saved label filled into the sentence.',
  ],
  [
    'SG-db11732d',
    'Held by the guardrail checker: PLACEHOLDER_MISMATCH: {choice}: en 1 (needs 1), bn 0.',
  ],
  [
    'SG-dc1af39a',
    'Held in English: its button or screen-reader name pairs with visible English text, or a leading space is lost in Bengali; waits until both are fixed together.',
  ],
  [
    'SG-de969496',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-dedaa54b',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-e004a268',
    'Button name read by screen readers while the visible text is still English (label in name).',
  ],
  [
    'SG-e3fdc097',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): heading over route rules.',
  ],
  [
    'SG-e4498255',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-e6123c0d',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-e70b69ad',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): visa Fee label.',
  ],
  [
    'SG-e8727ba5',
    'Applicant screens: Sentence built around English-only helper output (a counted phrase, status word or description): waits until that value is translated.',
  ],
  [
    'SG-eb382184',
    'Applicant screens: Sentence built around an English-only value (a counted phrase, a lower-cased field label or a helper phrase): waits until the value itself is translated.',
  ],
  [
    'SG-ecd96750',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for minors.',
  ],
  [
    'SG-f22cca12',
    'A date, count or label is filled in as English text inside the sentence; held in English until the value itself is shown in the reader language.',
  ],
  [
    'SG-f3c3a277',
    "Safe copy row button: its screen-reader name is 'Select/Accept/Remove box N', which has no Bengali draft and stays English, so the visible text stays English too (label in name).",
  ],
  [
    'SG-f6430216',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): embassy original-paper rule.',
  ],
  [
    'SG-f974eb5d',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): document requirement for minors.',
  ],
  [
    'SG-fe5feab6',
    'Applicant screens: The visible button text beside it is still English, so a Bengali accessible name would not match what is on the button (label in name).',
  ],
  [
    'SG-ff7d2a1c',
    'Official visa rule content stays English with a Bengali note (owner decision 2026-11-12): what most visa forms ask for first.',
  ],
  [
    'SG-c1f08b9e',
    'Term conflict: this footer draft names the Public Trust page differently from the page link on the home page; one page keeps one name, so it waits for the owner term decision.',
  ],
  [
    'SG-1ce16669',
    'Applicant removal screens: the sentence names the Recently Deleted list in quotes, but its tab and menu still show the English name, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'SG-5cbaeb71',
    'Applicant removal screens: the sentence names the Recently Deleted list in quotes, but its tab and menu still show the English name, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'SG-95ad8477',
    'Applicant removal screens: the sentence names the Recently Deleted list in quotes, but its tab and menu still show the English name, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'SG-a467fb90',
    'Applicant removal screens: the sentence names the Recently Deleted list in quotes, but its tab and menu still show the English name, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'SG-a516cfad',
    'Applicant removal screens: the sentence names the Recently Deleted list, but its tab and menu still show the English name, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'SG-da772478',
    'Applicant removal screens: the sentence names the Recently Deleted list, but its tab and menu still show the English name, so a Bengali name would not match what the person sees (label in name).',
  ],
  [
    'SG-32ebd49c',
    'Applicant removal screens: the sentence names the Ask Us to Remove This File action, but the Manage menu still shows it in English, so a Bengali name would not match what the person sees (label in name).',
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

/**
 * The structure of a message's `{...}` parts: `{name}` and `{name, plural, sel {...} ...}`, nested,
 * as one comparable string (plural branch selectors left out: languages pick different ones; the
 * number sign in the other branch kept).
 * Null when the braces do not balance or a `{...}` part is neither shape.
 * @returns {{ text: string, everyPluralHasOther: boolean } | null}
 */
export function messageShape(msg) {
  let everyPluralHasOther = true;
  const close = (s, from) => {
    let depth = 0;
    for (let i = from; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) return i;
    }
    return -1;
  };
  const walk = (s) => {
    const parts = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '}') return null;
      if (s[i] !== '{') continue;
      const end = close(s, i);
      if (end === -1) return null;
      const inner = s.slice(i + 1, end);
      const simple = inner.match(/^(\w+)$/);
      const pl = inner.match(/^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/);
      if (simple) parts.push(simple[1]);
      else if (pl) {
        const branches = new Set();
        const bodies = [];
        let otherHasNumber = false;
        let rest = pl[2];
        while (rest.trim()) {
          const m = rest.match(/^\s*(=\d+|zero|one|two|few|many|other)\s*\{/);
          if (!m) return null;
          const open = m[0].length - 1;
          const bEnd = close(rest, open);
          if (bEnd === -1) return null;
          branches.add(m[1]);
          if (m[1] === 'other') otherHasNumber = rest.slice(open + 1, bEnd).includes('#');
          const body = walk(rest.slice(open + 1, bEnd));
          if (body === null) return null;
          bodies.push(body);
          rest = rest.slice(bEnd + 1);
        }
        if (!branches.has('other')) everyPluralHasOther = false;
        // The number (#) in the other branch is part of the shape: Bengali must not drop it.
        parts.push(
          `${pl[1]}:plural${otherHasNumber ? '#' : ''}[${[...new Set(bodies)].sort().join('|')}]`,
        );
      } else return null;
      i = end;
    }
    return [...new Set(parts)].sort().join(',');
  };
  const text = walk(msg);
  return text === null ? null : { text, everyPluralHasOther };
}

/** How far a text may have moved in its file and still take its census row (see lookup). */
export const CENSUS_LINE_DRIFT = 25;

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
    this.censusByFile = new Map();
    for (const c of censusCsv ? parseCsv(censusCsv) : []) {
      if (!c.semantic_group) continue;
      this.census.set(`${c.file}|${c.line_start}|${c.english}`, c.semantic_group);
      const both = `${c.file}|${c.english}`;
      const rows = this.censusByFile.get(both) ?? [];
      rows.push({ line: Number(c.line_start), group: c.semantic_group });
      this.censusByFile.set(both, rows);
    }
  }

  /**
   * The census group for a text in a file whose lines have moved since the census was taken:
   * found by file and English within CENSUS_LINE_DRIFT lines of where the text is now, and only
   * when every such census row names the same register group. Two meanings of one word in one
   * file are never merged, and a far-away row (perhaps a different text that has since gone)
   * is never borrowed. A census row that another text of the same run still matches exactly
   * (`claimed`, see claimedBy) belongs to that text and is never lent to a new one.
   */
  censusGroupIgnoringLine(file, form, line, claimed = new Set()) {
    const near = (this.censusByFile.get(`${file}|${form}`) ?? []).filter(
      (r) =>
        Math.abs(r.line - line) <= CENSUS_LINE_DRIFT && !claimed.has(`${file}|${r.line}|${form}`),
    );
    const groups = new Set(near.map((r) => r.group));
    if (groups.size !== 1) return null;
    const [group] = groups;
    return this.byGroup.has(group) ? group : null;
  }

  static load(root) {
    const read = (rel) => {
      const p = `${root}/${rel}`;
      return readIfExists(p) ?? '';
    };
    return new Register({ registerCsv: read(REGISTER_REL), censusCsv: read(CENSUS_REL) });
  }

  formsOf(unit) {
    return [...new Set([registerForm(unit.censusText), registerForm(unit.english)])];
  }

  /**
   * The census rows that these texts (every text found in a run's files, converted or not) still
   * match at their exact line. Pass the set to lookup, so the moved-line fallback never lends a
   * row that still belongs to a text in place.
   * @param {Array<{ file: string, line: number, censusText: string, english: string }>} units
   * @returns {Set<string>}
   */
  claimedBy(units) {
    const claimed = new Set();
    for (const u of units)
      for (const f of this.formsOf(u)) {
        const key = `${u.file}|${u.line}|${f}`;
        if (this.census.has(key)) claimed.add(key);
      }
    return claimed;
  }

  /**
   * @param {{ file: string, line: number, censusText: string, english: string }} unit
   * @param {Set<string>} [claimed] census rows other texts of the run match exactly (claimedBy)
   * @returns {{ group: string|null, bn: string|null, reason: string|null }}
   */
  lookup(unit, claimed = new Set()) {
    const forms = this.formsOf(unit);
    let row = null;
    for (const f of forms) {
      const g = this.census.get(`${unit.file}|${unit.line}|${f}`);
      if (g && this.byGroup.has(g)) {
        row = this.byGroup.get(g);
        break;
      }
    }
    for (const f of forms) {
      if (row) break;
      const g = this.censusGroupIgnoringLine(unit.file, f, unit.line, claimed);
      if (g) row = this.byGroup.get(g);
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
    return this.resolveRow(row, unit.english);
  }

  /**
   * Bengali for one group as written in a catalogue (no source position needed). Used to refill
   * catalogues after the rules or the register change.
   * @returns {{ group: string, bn: string|null, reason: string|null }}
   */
  resolveGroup(group, english, options) {
    const row = this.byGroup.get(group);
    if (!row) return { group, bn: null, reason: 'no_register_match' };
    return this.resolveRow(row, english, options);
  }

  /**
   * With `plural`, an ICU plural message may be filled: its variables, plural variables and
   * nesting must match the English exactly and every Bengali plural must have an `other` branch.
   * Only callers whose text is written in the catalogue's own plural shape pass it: the services
   * catalogue, and a draft written for one web catalogue key (refill.mjs). A register row read
   * for a web key still refuses a plural message, because its Bengali was drafted from the
   * flattened census sentence.
   * @param {{ plural?: boolean }} [options]
   */
  resolveRow(row, english, { plural = false } = {}) {
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
    const isPlural = /[{}]/.test(english.replace(/\{\w+\}/g, ''));
    if (isPlural && !plural) return { group, bn: null, reason: 'english_is_plural_message' };
    const a = placeholdersOf(english).join(',');
    const b = placeholdersOf(draft).join(',');
    if (a !== b) return { group, bn: null, reason: 'bn_placeholders_differ' };
    if (isPlural) {
      const shapeEn = messageShape(english);
      const shapeBn = messageShape(draft);
      if (shapeEn === null) return { group, bn: null, reason: 'english_plural_unreadable' };
      if (shapeBn === null || shapeBn.text !== shapeEn.text || !shapeBn.everyPluralHasOther)
        return { group, bn: null, reason: 'bn_plural_differs' };
    } else if (/[{}]/.test(draft.replace(/\{\w+\}/g, '')))
      return { group, bn: null, reason: 'bn_stray_brace' };
    // A space at the start or end of the English joins it to the text beside it; Bengali that drops
    // that space would run the two together.
    const edge = (text) => `${/^\s/.test(text)}${/\s$/.test(text)}`;
    if (edge(english) !== edge(draft)) return { group, bn: null, reason: 'bn_edge_space_differs' };
    return { group, bn: draft, reason: null };
  }
}
