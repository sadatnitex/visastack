/**
 * A copy-ready follow-up message for one evidence request (Programme X WP-V4, Do next). It is
 * shown to the agency for review and never sent by the product: the agency copies it into its own
 * email or chat. Built only from the request's own fields, so it carries what the traveller
 * already knows and nothing more.
 *
 * Never in the message: ids, web links (with or without tokens), email addresses, long numbers
 * such as passport or account numbers, and long dashes. Each piece of free text (the traveller's
 * name, the case title, the item name, the organization name, the agency's own note) is checked on
 * its own and dropped for a plain stand-in when it holds any of those, so a risky detail can never
 * slip through. When the agency's note is dropped the standard wording is used instead and the
 * screen says why (owner decision 2026-10-25, W0 ledger Q5 option A).
 */

import { daysUntilDateOnly } from '../../../../lib/format-date';

// Every check runs on the NFKC form of the text, so full-width letters, digits, dots and the
// full-width at sign are judged like their plain forms. Digits are matched as any decimal digit
// (\p{Nd}), so Bangla and full-width numbers count too.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LINK =
  /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/?#:]|\b))/i;
/** Any at sign, including the full-width and small forms. */
const AT_SIGN = /[@\uFF20\uFE6B]/u;
/** An email address spelled out: "name at gmail dot com", "name(at)gmail(dot)com", "name [at] mail [dot] org". */
const SPELLED_EMAIL =
  /[\p{L}\p{N}._%+-]+\s*[([{<]?\s*\bat\b\s*[)\]}>]?\s*[\p{L}\p{N}-]+\s*[([{<]?\s*\bdot\b\s*[)\]}>]?\s*\p{L}{2,}/iu;
/** Six or more digits in a row: account, phone and most document numbers. */
const DIGIT_RUN = /\p{Nd}{6,}/u;
/**
 * Eight or more digits close together, split by spaces, slashes, underscores, dots, hyphens,
 * plus signs or brackets (at most three of those between digits): phone numbers such as
 * (017) 1234 5678, account numbers in groups, and numbers written as 0123/4567.
 */
const SPLIT_DIGITS = /(?:\p{Nd}[\s/_.()[\]{}+-]{0,3}){7}\p{Nd}/u;
/** A code mixing letters and at least five digits, such as a passport number (A1234567). */
const MIXED_CODE =
  /(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]*\p{L})(?=(?:\p{L}*\p{Nd}){5})[\p{L}\p{N}]{6,}(?![\p{L}\p{N}])/u;
/** A capital-letter prefix followed by five or more digits, even when split: A0123 4567, BX 012345. */
const SPLIT_CODE = /(?<![\p{L}\p{N}])\p{Lu}{1,3}[\s/_.-]?(?:\p{Nd}[\s/_.-]?){5,}/u;

/** True when the text holds a link, an email address (written or spelled out), an id or a long number. */
export function containsUnsafeDetail(text: string): boolean {
  const plain = text.normalize('NFKC');
  return [AT_SIGN, SPELLED_EMAIL, UUID, LINK, DIGIT_RUN, SPLIT_DIGITS, MIXED_CODE, SPLIT_CODE].some(
    (pattern) => pattern.test(plain),
  );
}

/** Dash characters that read as a long dash: figure, en, em and horizontal bar dashes, the minus sign, and the two- and three-em dashes. */
const LONG_DASHES = new RegExp(
  `[${[0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2e3a, 0x2e3b, 0xfe58]
    .map((code) => String.fromCodePoint(code))
    .join('')}]`,
  'gu',
);

/** One line of plain text: long dashes become hyphens, runs of spaces and line breaks become one space. */
function oneLine(value: string): string {
  return value.replace(LONG_DASHES, '-').replace(/\s+/g, ' ').trim();
}

/** Keeps paragraphs, but tidies each line and swaps long dashes for hyphens. */
function paragraphs(value: string): string {
  return value
    .replace(LONG_DASHES, '-')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The value as one clean line, or null when it is empty or holds an unsafe detail. */
function safeLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const line = oneLine(value);
  return line.length > 0 && !containsUnsafeDetail(line) ? line : null;
}

export interface FollowUpInput {
  /** The traveller's display name, as the agency already sees it. */
  readonly travellerName: string | null;
  /** What was asked for, in words (for example "Bank Statement"). */
  readonly itemLabel: string | null;
  readonly kind: 'FIELD' | 'DOCUMENT';
  /** Waiting for a first answer, or sent back for a fix. */
  readonly status: 'OPEN' | 'NEEDS_REPLACEMENT';
  /** Only when the agency set one. */
  readonly dueDate: Date | string | null;
  /** The case title, or null for a request made for the traveller in general. */
  readonly caseTitle: string | null;
  /** The agency's own note on the request. */
  readonly agencyNote: string | null;
  readonly organizationName: string | null;
  readonly now?: Date;
}

export interface FollowUpMessage {
  readonly text: string;
  /** The agency's own note is the body of the message. */
  readonly usedAgencyNote: boolean;
  /** The agency wrote a note, but it was left out because it holds a link, an email address or a long number. */
  readonly agencyNoteLeftOut: boolean;
}

function longDate(value: Date | string): string {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dueLine(dueDate: Date | string | null, now: Date): string | null {
  if (dueDate === null) return null;
  const days = daysUntilDateOnly(dueDate, now);
  const date = longDate(dueDate);
  if (days < 0) return `Due: ${date} (this date has passed)`;
  if (days === 0) return `Due: today, ${date}`;
  return `Due: ${date}`;
}

/** Builds the message. Pure and deterministic for the same input. */
export function buildFollowUpMessage(input: FollowUpInput): FollowUpMessage {
  const now = input.now ?? new Date();
  const name = safeLine(input.travellerName);
  const item = safeLine(input.itemLabel);
  const caseTitle = safeLine(input.caseTitle);
  const organization = safeLine(input.organizationName);

  const rawNote = input.agencyNote ? paragraphs(input.agencyNote) : '';
  const noteIsSafe = rawNote.length > 0 && !containsUnsafeDetail(rawNote);
  const agencyNoteLeftOut = rawNote.length > 0 && !noteIsSafe;

  const replacement = input.status === 'NEEDS_REPLACEMENT';
  const thing = input.kind === 'FIELD' ? 'detail' : 'document';
  const opening = replacement
    ? `One ${thing} you sent needs a new version before we can use it.`
    : `We are still waiting for one ${thing} we asked you for.`;

  const what =
    item ?? (input.kind === 'FIELD' ? 'The detail we asked for' : 'The document we asked for');
  const facts = [
    `What we need: ${what}${replacement ? ' (a new version)' : ''}`,
    caseTitle ? `Case: ${caseTitle}` : null,
    dueLine(input.dueDate, now),
  ].filter((line): line is string => line !== null);

  const standardBody = replacement
    ? 'Please sign in to your account, read the note on this request, and send a new version when you can. If something is unclear, reply to this message and we will help.'
    : input.kind === 'FIELD'
      ? 'Please sign in to your account and fill in this detail when you can. If something is stopping you, reply to this message and we will help.'
      : 'Please sign in to your account and add this document when you can. If something is stopping you, reply to this message and we will help.';

  const text = [
    name ? `Hello ${name},` : 'Hello,',
    opening,
    facts.join('\n'),
    noteIsSafe ? rawNote : standardBody,
    `Thank you,\n${organization ?? 'Your agency team'}`,
  ].join('\n\n');

  return { text, usedAgencyNote: noteIsSafe, agencyNoteLeftOut };
}
