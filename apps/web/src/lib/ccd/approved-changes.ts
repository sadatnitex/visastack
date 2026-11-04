import type { InventoryEntry } from './inventory';

/**
 * The only differences between a screen before and after Calm Core With Depths that the owner
 * has approved (docs/uiux/ccd/PARITY-LEDGER.md). Anything else missing is a bug. `to: null`
 * is a removal and needs the owner's name against it in the ledger.
 */
export interface ApprovedChange {
  readonly screen: string;
  readonly from: InventoryEntry;
  /** The element that replaces it (worked out per state when the wording depends on the person), or null for a removal. */
  readonly to: InventoryEntry | null | ((state: string) => InventoryEntry | null);
  readonly reason: string;
}

/** Home states (parity-home.test.tsx) with no record of the person's own, so no first name. */
const HOME_STATES_WITHOUT_OWN_RECORD = new Set([
  'nothing started yet, agency member',
  'more people than Home reads',
]);

export const APPROVED_CHANGES: readonly ApprovedChange[] = [
  {
    screen: 'account',
    from: { kind: 'heading', name: 'traveller@example.com', detail: '1' },
    to: { kind: 'text', name: 'traveller@example.com' },
    reason: 'D3: the page is named "Your Account" and the email sits under the heading.',
  },
  {
    screen: 'home',
    from: { kind: 'heading', name: 'Account Overview', detail: '1' },
    // Only the states that hold a record of the person's own greet them by first name.
    to: (state) => ({
      kind: 'heading',
      name: HOME_STATES_WITHOUT_OWN_RECORD.has(state) ? 'Welcome back' : 'Welcome back, Karim',
      detail: '1',
    }),
    reason:
      'D3: Home is headed "Welcome back, {first name}", or "Welcome back" when no name is known.',
  },
  {
    screen: 'traveller',
    from: { kind: 'heading', name: 'Welcome, Karim Hossain', detail: '2' },
    to: { kind: 'heading', name: 'Karim Hossain', detail: '1' },
    reason: "D3: a traveller's page is headed with their full name, once, as the page heading.",
  },
  {
    screen: 'traveller',
    from: { kind: 'link', name: 'New Visa Case', detail: '/app/applicant/person/missions' },
    to: { kind: 'link', name: 'Start a Case', detail: '/app/applicant/person/missions#start-case' },
    reason:
      'D3: one name for starting a case. It is now a secondary button; the Next Step holds the one primary.',
  },
  {
    screen: 'traveller',
    from: { kind: 'link', name: 'Start a Visa Case', detail: '/app/applicant/person/missions' },
    to: { kind: 'link', name: 'Start a Case', detail: '/app/applicant/person/missions' },
    reason: 'D3 (CCD-7): one name for starting a case, in the empty state too.',
  },
  {
    screen: 'traveller',
    from: { kind: 'heading', name: 'Reply to an Evidence Request', detail: '2' },
    to: { kind: 'heading', name: 'Bank Statement', detail: '2' },
    reason: "D1: the next step comes from the same ranking as Home, with Home's wording.",
  },
  {
    screen: 'traveller',
    from: { kind: 'text', name: 'An agency is waiting for evidence before it can continue.' },
    to: {
      kind: 'text',
      name: 'Karim Hossain \u00b7 Japan Tourist Visa. An agency asked you for a document. Reply with a file from your documents.',
    },
    reason: "D1: Home's wording for the same request.",
  },
  {
    screen: 'traveller',
    from: { kind: 'link', name: 'Open Requests', detail: '/app/applicant/person/evidence' },
    to: { kind: 'link', name: 'Reply to Request', detail: '/app/applicant/person/evidence' },
    reason: "D1: Home's button for the same request.",
  },
  {
    screen: 'documents',
    from: { kind: 'heading', name: 'Documents', detail: '2' },
    to: { kind: 'heading', name: 'Documents', detail: '1' },
    reason: 'D2: the page name is the one page heading (h1).',
  },
  {
    screen: 'documents',
    from: { kind: 'link', name: 'Upload Document', detail: '#document-upload' },
    to: { kind: 'link', name: 'Add Documents', detail: '/app/applicant/a1/documents/add' },
    reason:
      'UX7 (owner, 3 Nov 2026): adding documents is one door, its own page, instead of a closed section further down.',
  },
  {
    screen: 'documents',
    from: { kind: 'button', name: 'Upload Document', detail: '' },
    to: null,
    reason:
      'UX7 (owner, 3 Nov 2026): the closed Upload Document section is gone; its job is the one Add Documents link.',
  },
  {
    screen: 'documents',
    from: { kind: 'text', name: 'Upload' },
    to: null,
    reason: 'UX7 (owner, 3 Nov 2026): the small Upload label belonged to the removed section.',
  },
  {
    screen: 'documents',
    from: {
      kind: 'text',
      name: 'Add several at once. Documents are stored privately and pass a structural safety scan before they can be previewed.',
    },
    to: null,
    reason:
      'UX7 (owner, 3 Nov 2026) moved this promise beside the link to the Add Documents page; UX17 (owner, 4 Nov 2026) removed that bottom card, and the Add Documents page says it.',
  },
  {
    screen: 'documents',
    from: {
      kind: 'text',
      name: 'This is your document vault: passports, bank statements, photos and the other papers you use again and again. Add your first one with the form on this page.',
    },
    to: {
      kind: 'text',
      name: 'This is your document vault: passports, bank statements, photos and the other papers you use again and again. Add your first one with Add Documents.',
    },
    reason:
      'UX7 (owner, 3 Nov 2026): the form moved to the Add Documents page, so the line names it.',
  },
  {
    screen: 'expiry',
    from: { kind: 'link', name: 'Add a Document', detail: '/app/applicant/person/documents' },
    to: { kind: 'link', name: 'Add a Document', detail: '/app/applicant/person/documents/add' },
    reason: 'UX7 (owner, 3 Nov 2026): Add a Document opens the Add Documents page directly.',
  },
  {
    screen: 'traveller',
    from: { kind: 'link', name: 'Add a Document', detail: '/app/applicant/person/documents' },
    to: { kind: 'link', name: 'Add a Document', detail: '/app/applicant/person/documents/add' },
    reason: 'UX7 (owner, 3 Nov 2026): Add a Document opens the Add Documents page directly.',
  },
  {
    screen: 'traveller',
    from: {
      kind: 'link',
      name: 'Suggested Details Awaiting Approval2',
      detail: '/app/applicant/person/documents',
    },
    to: {
      kind: 'link',
      name: 'Suggested Details Awaiting Approval2',
      detail: '/app/applicant/person/review',
    },
    reason: 'What We Found: details read from documents wait on one screen, not inside the list.',
  },
  {
    screen: 'home',
    from: { kind: 'text', name: 'People' },
    to: null,
    reason:
      'UX18 (owner, 4 Nov 2026: Home after Start Here approved): the small label above a section heading is gone; the heading says it.',
  },
  {
    screen: 'home',
    from: { kind: 'text', name: 'In Progress' },
    to: null,
    reason: 'UX18: the small label above a section heading is gone; the heading says it.',
  },
  {
    screen: 'home',
    from: { kind: 'heading', name: 'My Records', detail: '2' },
    to: { kind: 'heading', name: 'People', detail: '2' },
    reason: 'UX18: People, as cards with a face and two numbers.',
  },
  {
    screen: 'home',
    from: { kind: 'heading', name: 'Active Requests and Work', detail: '2' },
    to: { kind: 'heading', name: 'Cases', detail: '2' },
    reason: 'UX18: Cases, as cards with a thin bar.',
  },
  {
    screen: 'home',
    from: { kind: 'heading', name: 'My Next Journey', detail: '2' },
    to: null,
    reason:
      'UX18: the next case is a dashed Start a Case tile at the end of Cases, with no words to read.',
  },
  {
    screen: 'home',
    from: {
      kind: 'text',
      name: 'Planning another trip? Start a case and check your saved documents against it.',
    },
    to: null,
    reason: 'UX18: the dashed Start a Case tile replaces the sentence and its button.',
  },
  {
    screen: 'documents',
    from: { kind: 'heading', name: 'Add Documents', detail: '2' },
    to: null,
    reason:
      'UX17 (owner, 4 Nov 2026: "we dont need Add Documents at the bottom"): the bottom card is gone; the page keeps the header button and, on a phone, an always-there Add button.',
  },
  {
    screen: 'documents',
    from: { kind: 'link', name: 'Home', detail: '/app' },
    to: null,
    reason:
      'UX17: the consent hint lived only inside the removed card; the Add Documents page asks for it.',
  },
  {
    screen: 'documents',
    from: { kind: 'link', name: 'Add a Document', detail: '#add-document' },
    to: { kind: 'link', name: 'Add a Document', detail: '/app/applicant/a1/documents/add' },
    reason: 'UX17: the empty list opens the Add Documents page directly, not the removed card.',
  },
  {
    screen: 'documents',
    from: { kind: 'heading', name: 'Selected Document', detail: '3' },
    to: { kind: 'heading', name: 'Selected Document', detail: '2' },
    reason: 'D2: no skipped heading levels; the panel heading follows the page heading.',
  },
  {
    screen: 'expiry',
    from: { kind: 'heading', name: 'Expiry & Freshness', detail: '2' },
    to: { kind: 'heading', name: 'Dates & Expiry', detail: '1' },
    reason:
      'D3 and D2: one name for the page ("Dates & Expiry", eyebrow "Record"), as the one page heading.',
  },
  {
    screen: 'traveller',
    from: {
      kind: 'link',
      name: 'Document Expiry Centre \u2192',
      detail: '/app/applicant/person/expiry',
    },
    to: { kind: 'link', name: 'Dates & Expiry \u2192', detail: '/app/applicant/person/expiry' },
    reason: 'D3: "Expiry Centre" is retired; the page is Dates & Expiry everywhere.',
  },
  {
    screen: 'profile',
    from: { kind: 'heading', name: 'My Profile', detail: '2' },
    to: { kind: 'heading', name: 'My Profile', detail: '1' },
    reason:
      'D2: the page name is the one page heading (eyebrow "Record" replaces "Your Canonical Record").',
  },
  ...['Karim Hossain', 'Profile Health', 'Latest Changes'].map(
    (name): ApprovedChange => ({
      screen: 'profile',
      from: { kind: 'heading', name, detail: '3' },
      to: { kind: 'heading', name, detail: '2' },
      reason: 'D2: no skipped heading levels under the page heading; same words and size.',
    }),
  ),
  {
    screen: 'profile',
    from: {
      kind: 'link',
      name: 'Check Document Expiry \u2192',
      detail: '/app/applicant/person/expiry',
    },
    to: { kind: 'link', name: 'Dates & Expiry \u2192', detail: '/app/applicant/person/expiry' },
    reason: 'D3: one name for the Dates & Expiry page.',
  },
  {
    screen: 'cases',
    from: { kind: 'heading', name: 'Visa Cases', detail: '2' },
    to: { kind: 'heading', name: 'Cases', detail: '1' },
    reason:
      'D3 and D2: the page is "Cases", eyebrow the traveller\'s name, as the one page heading.',
  },
  {
    screen: 'cases',
    from: { kind: 'heading', name: 'Active & Past', detail: '2' },
    to: { kind: 'heading', name: 'Active Cases', detail: '2' },
    reason: 'LC-G2: open cases under Active Cases, closed and cancelled under Past Cases.',
  },
  {
    screen: 'cases',
    from: { kind: 'text', name: 'Your Cases' },
    to: null,
    reason: 'D3 retires "Your Cases"; the small label above the list repeated the page name.',
  },
  ...[
    { kind: 'text', name: 'No Cases Yet' },
    {
      kind: 'text',
      name: "A case checks this person's documents against the checklist of one visa route. Start one with the form on this page.",
    },
    {
      kind: 'text',
      name: 'Once a checklist is attached, you see how many items are ready and what is still missing.',
    },
  ].map(
    (entry): ApprovedChange => ({
      screen: 'cases',
      from: entry as InventoryEntry,
      to: (state) => (state === 'cases could not be read' ? null : (entry as InventoryEntry)),
      reason:
        'When the list could not be read, the page says so instead of "No Cases Yet", which invited a duplicate case.',
    }),
  ),
  ...[0, 2].map(
    (count): ApprovedChange => ({
      screen: 'sharing',
      from: {
        kind: 'text',
        name: `What actually happened to your data, not just what a grant permits - the most recent ${count} events.`,
      },
      to: {
        kind: 'text',
        name: 'What actually happened to your data, not just what a grant permits.',
      },
      reason:
        'The log under it now says how many entries it holds and how far back they go (owner, 28 Oct 2026).',
    }),
  ),
  {
    screen: 'agency-home',
    from: { kind: 'heading', name: 'Atlas Visa', detail: '1' },
    to: { kind: 'heading', name: 'Agency Overview', detail: '1' },
    reason: "D3: on agency pages the agency's name is the eyebrow and the page's name the one h1.",
  },
  {
    screen: 'agency-home',
    from: {
      kind: 'text',
      name: 'Cases that need action come first. Search covers only the cases you are already allowed to see, by traveller, case title, reference, destination or stage.',
    },
    to: { kind: 'text', name: 'Cases that need action come first.' },
    reason:
      'The sentence about search moved beside the search form, at the level that shows it (both sentences kept).',
  },
  {
    screen: 'agency-home',
    from: { kind: 'link', name: 'Invite Traveller', detail: '/app/agency/o1/clients' },
    to: { kind: 'link', name: 'Invite a Client', detail: '/app/agency/o1/clients' },
    reason: 'D3: one name, "Invite a Client".',
  },
  {
    screen: 'agency-cases',
    from: { kind: 'text', name: 'Issuer confirmations (EVI-05)' },
    to: { kind: 'text', name: 'Issuer Confirmations' },
    reason: 'D3: plain names, no reference codes in visible text (VOCABULARY.md).',
  },
  {
    screen: 'case',
    from: { kind: 'text', name: 'Fix 2 required items' },
    to: { kind: 'text', name: 'Fix 2 required items for Japan visitor visa' },
    reason: 'CCD section 6 (speak to the person): the Next Step names the case.',
  },
  {
    screen: 'case',
    from: { kind: 'text', name: 'Some required items are missing, out of date or do not match.' },
    to: {
      kind: 'text',
      name: 'First to fix: Bank Statement. Some required items are missing, out of date or do not match.',
    },
    reason: 'CCD section 6 (anticipate): the Next Step names the first item to fix.',
  },
  {
    screen: 'sharing',
    from: { kind: 'heading', name: 'Sharing & Access', detail: '2' },
    to: { kind: 'heading', name: 'Sharing', detail: '1' },
    reason:
      'D3 and D2: the page is "Sharing", eyebrow the traveller\'s name, as the one page heading.',
  },
  {
    screen: 'evidence',
    from: { kind: 'heading', name: 'Requests from Agencies', detail: '2' },
    to: { kind: 'heading', name: 'Evidence Requests', detail: '1' },
    reason:
      'D3 and D2: the page is "Evidence Requests", eyebrow the traveller\'s name, as the one page heading.',
  },
  ...[
    { kind: 'text', name: 'No Evidence Requests' },
    {
      kind: 'text',
      name: 'This is where an agency asks you for a document or a detail. A request appears here with what is needed, why, and the date it is needed by. Keeping your documents up to date makes replying quick.',
    },
    {
      kind: 'text',
      name: 'You reply from your saved documents in one step, and you decide what to send.',
    },
    { kind: 'link', name: 'Open Documents', detail: '/app/applicant/person/documents' },
  ].map(
    (entry): ApprovedChange => ({
      screen: 'evidence',
      from: entry as InventoryEntry,
      to: (state) => (state === 'requests could not be read' ? null : (entry as InventoryEntry)),
      reason:
        'When the requests could not be read, the page says so instead of claiming there are none.',
    }),
  ),
  {
    screen: 'case',
    from: { kind: 'heading', name: 'Evidence Progress', detail: '3' },
    to: { kind: 'heading', name: 'Evidence Progress', detail: '2' },
    reason: 'D2: no skipped heading level under the case title; same words and size.',
  },
  {
    screen: 'notifications',
    from: { kind: 'heading', name: 'Updates on Your Cases', detail: '1' },
    to: { kind: 'heading', name: 'Notifications', detail: '1' },
    reason: 'D3: one name, "Notifications" (retiring "Alerts" and "Updates on Your Cases").',
  },
  {
    screen: 'notifications',
    from: { kind: 'text', name: 'No Alerts Yet' },
    to: { kind: 'text', name: 'No Notifications Yet' },
    reason: 'D3: "Alerts" is retired.',
  },
  {
    screen: 'privacy',
    from: { kind: 'heading', name: 'Your Data Rights', detail: '1' },
    to: { kind: 'heading', name: 'Privacy & Consent', detail: '1' },
    reason: 'D3: the page is "Privacy & Consent", as in the account menu.',
  },
  {
    screen: 'privacy',
    from: {
      kind: 'link',
      name: 'Download export (CSV/ZIP)',
      detail: '/app/privacy/export?format=csv',
    },
    to: {
      kind: 'link',
      name: 'Download Export (CSV/ZIP)',
      detail: '/app/privacy/export?format=csv',
    },
    reason: 'D3: the two downloads share one form of words.',
  },
];

/**
 * D3 (CCD-7): a person with a record is a "traveller" in visible text, never an "applicant".
 * Routes, stored values and code names keep "applicant". Exact phrases, applied in order.
 */
const TRAVELLER_WORDS: readonly (readonly [string, string])[] = [
  ['Add an Applicant', 'Add a Traveller'],
  ['Add Applicant', 'Add Traveller'],
  ['No Applicants Yet', 'No Travellers Yet'],
  ['See All Applicants', 'See All Travellers'],
  ['View Applicants', 'View Travellers'],
  ['All Applicants', 'All Travellers'],
  ['An applicant is one person', 'A traveller is one person'],
  ['Open an applicant', 'Open a traveller'],
  ['create applicant or profile records', 'create traveller or profile records'],
  ['Awaiting Applicant', 'Awaiting Traveller'],
  ['Applicant has not confirmed yet', 'Traveller has not confirmed yet'],
  ['Applicant confirmation', 'Traveller confirmation'],
  ['Confirmed by applicant', 'Confirmed by the traveller'],
  ["this applicant's", "this traveller's"],
  ['an applicant must grant', 'a traveller must grant'],
  ['Applicant-Wide (Default)', 'Whole Traveller Record (Default)'],
  ['Choose an applicant', 'Choose a traveller'],
  ['Declared by the applicant', 'Declared by the traveller'],
  ['before any applicant or', 'before any traveller or'],
  ['Ask an applicant', 'Ask a traveller'],
  ['their own applicant profiles', 'their own traveller profiles'],
  ['The following applicant record', 'The following traveller record'],
  ['every applicant you own goes with it', 'every traveller on your account goes with it'],
  ['applicants, Master Profile facts', 'travellers, Master Profile facts'],
  ['Confirmed by the applicant on', 'Confirmed by the traveller on'],
  ['applicant confirmation are checked', 'traveller confirmation are checked'],
  ['adding applicant records', 'adding traveller records'],
  ['Each applicant is re-checked', 'Each traveller is re-checked'],
];

function travellerWords(name: string): string {
  return TRAVELLER_WORDS.reduce((text, [from, to]) => text.split(from).join(to), name);
}

/** The first letters of the first and last word, as the person card draws them. */
function homeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? '?'}${words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''}`.toUpperCase();
}

const label = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const PROGRESS_TEXT =
  '(\\d+ of \\d+ items? ready|Pick a checklist to see what is ready|This checklist has no required items to count\\.|Open the case to see its progress\\.)';

/**
 * The new Home card for each old Home row. Every way of reading an old row is tried, because a
 * name can end in a digit and so be ambiguous against the count that follows it; the check keeps
 * the one that is on the screen.
 */
function homeCardForms(entry: InventoryEntry): readonly InventoryEntry[] {
  if (entry.kind !== 'link') return [];
  const forms: string[] = [];
  const old = entry.name;
  // A person: "Name2 documents · 1 active case[ · 3 open requests][Action Needed]›".
  const person = old.match(
    /^(.*?)(\d+) documents? \u00b7 (\d+) active cases?(?: \u00b7 (\d+) open requests?)?(Action Needed)?\u203a$/,
  );
  if (person && /^\/app\/applicant\/[^/]+$/.test(entry.detail ?? '')) {
    const head = person[1] ?? '';
    const digits = person[2] ?? '';
    // The digit run holds the end of the name and then the document count: try every split.
    for (let k = 1; k <= digits.length; k += 1) {
      const name = `${head}${digits.slice(0, digits.length - k)}`;
      const documents = Number(digits.slice(digits.length - k));
      const cases = Number(person[3]);
      const requests = person[4] === undefined ? 0 : Number(person[4]);
      const chip = person[5] ?? (documents === 0 ? 'Add a Document' : '');
      forms.push(
        `${homeInitials(name)}${name}${chip}${label(documents, 'Document', 'Documents')}${label(cases, 'Case', 'Cases')}${requests > 0 ? label(requests, 'Request', 'Requests') : ''}`,
      );
    }
  }
  // A case: "Title" + "Active case · Person" + progress + [badge] + "›".
  const caseRow = old.match(
    new RegExp(`^(.*?)Active case \\u00b7 (.*?)${PROGRESS_TEXT}(.*?)\\u203a$`),
  );
  if (caseRow) {
    forms.push(`${caseRow[1]}${caseRow[2]}${caseRow[4]}${caseRow[3]}`);
  }
  // Requests from an agency: the same words without the chevron.
  if (old.startsWith('Requests from an Agency') && old.endsWith('\u203a')) {
    forms.push(old.slice(0, -1));
  }
  return forms.map((name) => ({ ...entry, name }));
}

/**
 * Approved changes that apply to a kind of element rather than one element: a link that now
 * carries an anchor so it lands on what it names (ADR 0023, links never land hidden).
 */
export interface ApprovedRule {
  readonly screens: readonly string[];
  readonly reason: string;
  /** Other forms the same element may now take. */
  readonly alternatives: (entry: InventoryEntry) => readonly InventoryEntry[];
}

export const APPROVED_RULES: readonly ApprovedRule[] = [
  {
    // Only the screens whose wording changed in this pass.
    screens: [
      'agency-cases',
      'agency-home',
      'case',
      'cases',
      'home',
      'privacy',
      'profile',
      'traveller',
    ],
    reason: 'D3 (CCD-7): "traveller", never "applicant", in visible text.',
    alternatives: (entry) => {
      const name = travellerWords(entry.name);
      return name === entry.name ? [] : [{ ...entry, name }];
    },
  },
  {
    screens: ['traveller'],
    reason: 'D3 (CCD-7): "Cases", never "Visa Cases"; the count tile reads "Active Cases".',
    alternatives: (entry) =>
      entry.kind === 'link' && entry.name.startsWith('Active Visa Cases')
        ? [{ ...entry, name: entry.name.replace('Active Visa Cases', 'Active Cases') }]
        : [],
  },
  {
    screens: ['home', 'traveller'],
    reason:
      'CCD-4: every Start a Case link opens the form, which sits deeper on the Cases page, through its #start-case anchor.',
    alternatives: (entry) =>
      entry.kind === 'link' && entry.detail?.endsWith('/missions')
        ? [{ ...entry, detail: `${entry.detail}#start-case` }]
        : [],
  },
  {
    screens: ['home'],
    reason:
      'UX18: a person is a card (initials, name, one chip, two big numbers), and a case or a set of agency requests is a card (title, person, chip, thin bar). The same facts and the same address; only the order of the words and the chevron differ.',
    alternatives: homeCardForms,
  },
];
