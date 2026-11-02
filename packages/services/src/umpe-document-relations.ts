/**
 * UMPE P3: how a newly arrived document relates to the person's other documents (ledger I13).
 *
 * Deterministic signals only, in this order: the file's SHA-256, the kind of document, a
 * passport's machine-readable lines (holder, number, expiry, all check-digit verified), and a
 * statement's period and account ending read from its own text. No AI, no guess: when the signals
 * do not settle it, there is no relation. The result is only ever a proposal the traveller
 * confirms; nothing here merges, replaces or deletes anything. Pure: no database.
 */

import { findTd3Block } from './classification';
import { parseTd3 } from './mrz';

export const DOCUMENT_RELATIONS = [
  'EXACT_DUPLICATE',
  'CORRECTED_SCAN',
  'NEW_PERIOD',
  'RENEWED',
] as const;
export type DocumentRelation = (typeof DOCUMENT_RELATIONS)[number];

export function isDocumentRelation(value: unknown): value is DocumentRelation {
  return typeof value === 'string' && (DOCUMENT_RELATIONS as readonly string[]).includes(value);
}

/** Kinds whose copies are told apart by their period (one statement per month or quarter). */
export const PERIOD_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'BANK_STATEMENT',
  'JOINT_ACCOUNT_STATEMENT',
  'SALARY_SLIP',
  'PENSION_STATEMENT',
  'CREDIT_CARD_STATEMENT',
  'LOAN_STATEMENT',
  'DIVIDEND_STATEMENT',
]);

/** Kinds with passport-style machine-readable lines, told apart by number and expiry. */
export const MACHINE_READABLE_IDENTITY_TYPES: ReadonlySet<string> = new Set([
  'PASSPORT',
  'TRAVEL_DOCUMENT',
]);

/** Signal codes stored with a proposal: which checks agreed, never a value from the document. */
export type RelationSignal =
  | 'same_file'
  | 'same_type'
  | 'same_holder'
  | 'same_number'
  | 'different_number'
  | 'later_expiry'
  | 'same_period'
  | 'different_period'
  | 'same_account';

export interface StatementPeriod {
  /** ISO date (YYYY-MM-DD). */
  readonly start: string;
  /** ISO date (YYYY-MM-DD). */
  readonly end: string;
}

export interface DocumentSignals {
  readonly passport: {
    readonly holderKey: string;
    readonly number: string;
    /** ISO date. */
    readonly expiry: string;
  } | null;
  readonly period: StatementPeriod | null;
  /** The last four digits of the account number, when the text names one. */
  readonly accountEnding: string | null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function monthNumber(word: string): number | null {
  const key = word.toLowerCase().slice(0, word.toLowerCase().startsWith('sept') ? 4 : 3);
  return MONTHS[key] ?? null;
}

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > last) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Every repeat in these readers has a small upper bound, so a long run of spaces or punctuation in
 * a scanned text can never make a match slow (no unbounded repeats next to each other).
 */
const MONTH_WORD =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** One date in any of the forms statements use; day first when the order is ambiguous. */
const DATE_PATTERN = `(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|\\d{1,2}[\\s-]${MONTH_WORD}[\\s,-]{1,3}\\d{4}|${MONTH_WORD}\\s{1,3}\\d{1,2},?\\s{1,3}\\d{4})`;

/** Reads one date found by `DATE_PATTERN`, or null when it is not a real calendar day. */
export function parseStatementDate(text: string): string | null {
  const value = text.trim();
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);
    // Day first (the convention where VisaStack is used), unless that cannot be a date.
    return b > 12 ? iso(year, a, b) : iso(year, b, a);
  }
  match = value.match(new RegExp(`^(\\d{1,2})[\\s-](${MONTH_WORD})[\\s,-]{1,3}(\\d{4})$`, 'i'));
  if (match?.[2]) {
    const month = monthNumber(match[2]);
    return month ? iso(Number(match[3]), month, Number(match[1])) : null;
  }
  match = value.match(new RegExp(`^(${MONTH_WORD})\\s{1,3}(\\d{1,2}),?\\s{1,3}(\\d{4})$`, 'i'));
  if (match?.[1]) {
    const month = monthNumber(match[1]);
    return month ? iso(Number(match[3]), month, Number(match[2])) : null;
  }
  return null;
}

/**
 * The period a statement covers, from its own text: "Statement Period: 01/03/2026 to 31/03/2026",
 * "From 1 March 2026 To 31 March 2026", or a whole month ("Statement for March 2026", "Pay Slip
 * for the Month of March 2026"). Null when the text names none, or names an end before its start.
 */
export function readStatementPeriod(text: string): StatementPeriod | null {
  const range = text.match(
    new RegExp(
      `(?:period|from|statement\\s{1,3}date|for\\s{1,3}the\\s{1,3}period)[^\\n\\d]{0,24}(${DATE_PATTERN})\\s{0,3}(?:to|till|until|through|-|\\u2013)\\s{0,3}(${DATE_PATTERN})`,
      'i',
    ),
  );
  if (range?.[1] && range[2]) {
    const start = parseStatementDate(range[1]);
    const end = parseStatementDate(range[2]);
    if (start && end && start <= end) return { start, end };
    return null;
  }
  const month = text.match(
    new RegExp(
      `(?:statement|slip|payslip|month|period)\\s{1,3}(?:for\\s{1,3})?(?:the\\s{1,3}month\\s{1,3}of\\s{1,3}|of\\s{1,3})?[:\\s]{0,3}(${MONTH_WORD})[\\s,-]{1,3}(\\d{4})`,
      'i',
    ),
  );
  if (month?.[1] && month[2]) {
    const number = monthNumber(month[1]);
    const year = Number(month[2]);
    const start = number ? iso(year, number, 1) : null;
    const end = number ? iso(year, number, lastDayOfMonth(year, number)) : null;
    if (start && end) return { start, end };
  }
  return null;
}

/** The last four digits of an account number named in the text ("Account Number: XXXX1234"). */
export function readAccountEnding(text: string): string | null {
  const match = text.match(
    /account\s{0,3}(?:no\.?|number|#)[ \t]{0,3}[:-]?\s{0,3}([X*\d][\dX* \t-]{3,30})/i,
  );
  if (!match?.[1]) return null;
  const digits = match[1].replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Every signal one document's text gives, for the kind of document it is. */
export function readDocumentSignals(text: string | null, docType: string | null): DocumentSignals {
  if (!text || !docType) return { passport: null, period: null, accountEnding: null };
  if (MACHINE_READABLE_IDENTITY_TYPES.has(docType)) {
    const block = findTd3Block(text);
    const parsed = block ? parseTd3(block.lines) : null;
    if (parsed?.ok && parsed.value.checksValid) {
      const v = parsed.value;
      return {
        passport: {
          holderKey: [v.surname, v.givenNames, v.dateOfBirth, v.nationality]
            .map((part) => part.trim().toUpperCase())
            .join('|'),
          number: v.passportNumber.trim().toUpperCase(),
          expiry: v.expiryDate,
        },
        period: null,
        accountEnding: null,
      };
    }
    return { passport: null, period: null, accountEnding: null };
  }
  if (PERIOD_DOCUMENT_TYPES.has(docType)) {
    return {
      passport: null,
      period: readStatementPeriod(text),
      accountEnding: readAccountEnding(text),
    };
  }
  return { passport: null, period: null, accountEnding: null };
}

export interface RelationSubject {
  readonly documentId: string;
  readonly sha256: string | null;
  readonly docType: string | null;
  readonly signals: DocumentSignals;
}

export interface RelationCandidate {
  readonly documentId: string;
  /** Every version's SHA-256 (a duplicate of an earlier version is still a duplicate). */
  readonly versionHashes: readonly string[];
  readonly docType: string | null;
  readonly signals: DocumentSignals;
  /** When the candidate was added: the latest wins a tie. */
  readonly createdAt: Date;
}

export interface ProposedRelation {
  readonly relatedDocumentId: string;
  readonly relation: DocumentRelation;
  /** True when the new document should be the Current Copy (later period or expiry). */
  readonly newIsCurrent: boolean;
  readonly signals: readonly RelationSignal[];
}

const PRIORITY: Readonly<Record<DocumentRelation, number>> = {
  EXACT_DUPLICATE: 0,
  CORRECTED_SCAN: 1,
  RENEWED: 2,
  NEW_PERIOD: 3,
};

function relationTo(
  subject: RelationSubject,
  candidate: RelationCandidate,
): ProposedRelation | null {
  if (candidate.documentId === subject.documentId) return null;
  if (subject.sha256 && candidate.versionHashes.includes(subject.sha256)) {
    return {
      relatedDocumentId: candidate.documentId,
      relation: 'EXACT_DUPLICATE',
      newIsCurrent: false,
      signals: ['same_file'],
    };
  }
  const type = subject.docType;
  if (!type || candidate.docType !== type) return null;

  const mine = subject.signals.passport;
  const theirs = candidate.signals.passport;
  if (mine && theirs) {
    if (mine.holderKey !== theirs.holderKey) return null;
    if (mine.number === theirs.number) {
      return {
        relatedDocumentId: candidate.documentId,
        relation: 'CORRECTED_SCAN',
        newIsCurrent: true,
        signals: ['same_type', 'same_holder', 'same_number'],
      };
    }
    const later = mine.expiry > theirs.expiry;
    return {
      relatedDocumentId: candidate.documentId,
      relation: 'RENEWED',
      newIsCurrent: later,
      signals: [
        'same_type',
        'same_holder',
        'different_number',
        ...(later ? (['later_expiry'] as const) : []),
      ],
    };
  }

  const myPeriod = subject.signals.period;
  const theirPeriod = candidate.signals.period;
  if (myPeriod && theirPeriod) {
    const myAccount = subject.signals.accountEnding;
    const theirAccount = candidate.signals.accountEnding;
    // Two different accounts are two different series, never related.
    if (myAccount && theirAccount && myAccount !== theirAccount) return null;
    const sameAccount: readonly RelationSignal[] =
      myAccount && theirAccount ? ['same_account'] : [];
    if (myPeriod.start === theirPeriod.start && myPeriod.end === theirPeriod.end) {
      return {
        relatedDocumentId: candidate.documentId,
        relation: 'CORRECTED_SCAN',
        newIsCurrent: true,
        signals: ['same_type', 'same_period', ...sameAccount],
      };
    }
    return {
      relatedDocumentId: candidate.documentId,
      relation: 'NEW_PERIOD',
      newIsCurrent: myPeriod.end > theirPeriod.end,
      signals: ['same_type', 'different_period', ...sameAccount],
    };
  }
  return null;
}

/** How far apart two periods are (days between their ends), for choosing the nearest one. */
function periodDistance(subject: RelationSubject, candidate: RelationCandidate): number {
  const a = subject.signals.period?.end;
  const b = candidate.signals.period?.end;
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(Date.parse(a) - Date.parse(b));
}

/**
 * The one relation to propose for a new document, or null. The strongest relation wins (same file,
 * then corrected scan, then renewed, then new period); among equals the nearest period, then the
 * most recently added document.
 */
export function proposeDocumentRelation(
  subject: RelationSubject,
  candidates: readonly RelationCandidate[],
): ProposedRelation | null {
  let best: { proposal: ProposedRelation; candidate: RelationCandidate } | null = null;
  for (const candidate of candidates) {
    const proposal = relationTo(subject, candidate);
    if (!proposal) continue;
    if (!best) {
      best = { proposal, candidate };
      continue;
    }
    const rank = PRIORITY[proposal.relation] - PRIORITY[best.proposal.relation];
    if (rank < 0) {
      best = { proposal, candidate };
      continue;
    }
    if (rank > 0) continue;
    const distance = periodDistance(subject, candidate) - periodDistance(subject, best.candidate);
    if (
      distance < 0 ||
      (distance === 0 && candidate.createdAt.getTime() > best.candidate.createdAt.getTime())
    ) {
      best = { proposal, candidate };
    }
  }
  return best?.proposal ?? null;
}

/**
 * The plain label for each side of a relation. The new document and the related one each get one:
 * Current Copy, Earlier Copy, Same as an Existing Copy, New Period, Renewed.
 */
export function relationLabels(
  relation: DocumentRelation,
  newIsCurrent: boolean,
): { readonly newDocument: string; readonly relatedDocument: string } {
  switch (relation) {
    case 'EXACT_DUPLICATE':
      return { newDocument: 'Same as an Existing Copy', relatedDocument: 'Current Copy' };
    case 'CORRECTED_SCAN':
      return newIsCurrent
        ? { newDocument: 'Current Copy', relatedDocument: 'Earlier Copy' }
        : { newDocument: 'Earlier Copy', relatedDocument: 'Current Copy' };
    case 'RENEWED':
      return newIsCurrent
        ? { newDocument: 'Renewed', relatedDocument: 'Earlier Copy' }
        : { newDocument: 'Earlier Copy', relatedDocument: 'Renewed' };
    case 'NEW_PERIOD':
      return newIsCurrent
        ? { newDocument: 'New Period', relatedDocument: 'Earlier Period' }
        : { newDocument: 'Earlier Period', relatedDocument: 'New Period' };
  }
}
