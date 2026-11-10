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

import { formatReferenceCode, parseReferenceCode } from '@visastack/core';
import { containsUnsafeDetail } from '../../../../lib/unsafe-detail';
import { daysUntilDue } from './console-format';

export { containsUnsafeDetail };

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
  /** The traveller's time zone, which decides when the due day ends (ADR 0015 amendment). */
  readonly timezone?: string | null;
  /**
   * The request's visible code (`R-7K2Q9M`, ADR 0018), as a structured field: it is written on
   * its own fixed line only when it reads as a valid request code, and never joins or loosens the
   * checks on any free text.
   */
  readonly requestReference?: string | null;
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

function dueLine(
  dueDate: Date | string | null,
  now: Date,
  timezone: string | null | undefined,
): string | null {
  if (dueDate === null) return null;
  const days = daysUntilDue(dueDate, now, timezone);
  const date = longDate(dueDate);
  if (days < 0) return `Due: ${date} (this date has passed)`;
  if (days === 0) return `Due: today, ${date}`;
  return `Due: ${date}`;
}

/** "Request reference: R-7K2Q9M" for a valid request code, or null (anything else is left out). */
function referenceLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseReferenceCode(value, 'R');
  return parsed.ok ? `Request reference: ${formatReferenceCode('R', parsed.code)}` : null;
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
    dueLine(input.dueDate, now, input.timezone),
    referenceLine(input.requestReference),
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
