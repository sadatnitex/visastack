/**
 * The one place a WhatsApp message and its "open WhatsApp" link are made (owner decision,
 * 10 Nov 2026: WhatsApp is offered everywhere a person sends someone something). VisaStack never
 * sends anything: the link only opens WhatsApp with the words filled in, and the person presses
 * Send there.
 *
 * What a message may hold (the floor the owner set): the first name, the agency name, the names
 * of document kinds (Passport, Bank Statement), the case name, a due date, and one VisaStack link
 * to the place to act. It never holds an identifier number, a date of birth, an address, file
 * contents, a preview, a storage address or a link that opens a file.
 *
 * That floor is kept in code, not by care: a message is built only from typed fields (never a
 * record), every free-text field is checked, the date must be a plausible due date, the link must
 * belong to VisaStack, and the finished text is checked again before it is returned. Anything that
 * fails the check makes the whole message fail, so the caller offers no WhatsApp action.
 *
 * Pure and free of server-only code, so the same rules run on the server and in the browser.
 */

import { containsUnsafeDetail } from './unsafe-detail';

declare const checkedMessage: unique symbol;

/**
 * A finished, checked message. Only `composeShareMessage` makes one: the marker below exists in
 * the type only, so no screen can write an object literal that passes for a checked message.
 */
export interface ShareMessage {
  readonly text: string;
  readonly [checkedMessage]: true;
}

export type ShareRejection =
  | { readonly reason: 'unsafe-text'; readonly field: string }
  | { readonly reason: 'bad-link' }
  | { readonly reason: 'bad-date' }
  | { readonly reason: 'too-long' };

export type ShareResult =
  | { readonly ok: true; readonly message: ShareMessage }
  | { readonly ok: false; readonly rejection: ShareRejection };

/** The fields a message can be built from. There is deliberately no field for a record. */
interface Named {
  readonly firstName?: string | undefined;
  readonly agencyName?: string | undefined;
}

export type ShareInput =
  /** A message already prepared and scrubbed elsewhere (the agency follow-up). Rechecked here. */
  | { readonly template: 'prepared-text'; readonly text: string }
  /** The private request link an agency sends to a person before they have an account. */
  | ({
      readonly template: 'collection-link';
      readonly link: string;
      readonly documentKinds?: readonly string[] | undefined;
      readonly caseName?: string | undefined;
      /** The day it is due, as YYYY-MM-DD. */
      readonly dueDate?: string | undefined;
    } & Named)
  /** An agency inviting a client to VisaStack. */
  | ({ readonly template: 'client-invitation'; readonly link: string } & Named)
  /** An agency inviting a colleague to its team. */
  | ({ readonly template: 'team-invitation'; readonly link: string } & Named)
  /** A traveller inviting someone to see what they share. */
  | ({ readonly template: 'sharing-invitation'; readonly link: string } & Named)
  /** A traveller telling someone to sign in and see what was shared. */
  | { readonly template: 'summary-link'; readonly link: string }
  /**
   * A traveller asking a sponsor or relative for one document, through the private contributor
   * link. It names the kind of document and nothing else about the case.
   */
  | {
      readonly template: 'contributor-request';
      readonly link: string;
      readonly documentKind?: string | undefined;
    }
  /** A person starting a conversation with VisaStack support. No link, no details. */
  | { readonly template: 'support-hello' };

export interface ShareOptions {
  /** The origins VisaStack's own links may use, for example `https://vs.obsidianglobal.studio`. */
  readonly allowedOrigins: readonly string[];
  /** Today, for the due-date check. Defaults to the real clock. */
  readonly now?: Date | undefined;
}

/** The only pages a message may point to, per template: the ones the product already mints. */
const LINK_PAGES = {
  'collection-link': ['/collect/open'],
  'client-invitation': ['/invitation'],
  'team-invitation': ['/invitation'],
  'sharing-invitation': ['/invitation'],
  'summary-link': ['/app/shared'],
  'contributor-request': ['/app/contributor-requests/accept'],
} as const;

const MAX_WORDS_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_KINDS = 8;

/** A date written out in a name: 12 Apr 1990, 12/04/1990, 1990-04-12, April 1990. */
const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_LIKE = new RegExp(
  [
    '\\p{Nd}{1,4}[\\s./-]+\\p{Nd}{1,2}[\\s./-]+\\p{Nd}{2,4}',
    `\\p{Nd}{1,2}(?:st|nd|rd|th)?[\\s./,-]*${MONTH}\\b[\\s./,-]*\\p{Nd}{2,4}`,
    `\\b${MONTH}\\b[\\s./,-]*\\p{Nd}{1,2}(?:st|nd|rd|th)?[\\s./,-]+\\p{Nd}{2,4}`,
    `\\b${MONTH}\\b[\\s./,-]*(?:19|20)\\p{Nd}{2}`,
  ].join('|'),
  'iu',
);
/** A line break or a control character: a name is one line of words. */
const CONTROL = /[\p{Cc}\p{Cf}]/u;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** One line of plain words, or null. Numbers that could identify someone are never plain words. */
function plainWords(value: string | undefined): string | null {
  if (value === undefined) return null;
  const line = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (line.length === 0 || line.length > MAX_WORDS_LENGTH) return null;
  if (CONTROL.test(line) || containsUnsafeDetail(line) || DATE_LIKE.test(line)) return null;
  return line;
}

type Field = { readonly ok: true; readonly value: string | null } | { readonly ok: false };

/** An optional field: absent is fine, present must be plain words. */
function optionalWords(value: string | undefined): Field {
  if (value === undefined || value.trim() === '') return { ok: true, value: null };
  const line = plainWords(value);
  return line === null ? { ok: false } : { ok: true, value: line };
}

function fail(rejection: ShareRejection): ShareResult {
  return { ok: false, rejection };
}

/** The link, when it is one of VisaStack's own, on an allowed page, and cannot open a file. Otherwise null. */
function ownLink(
  raw: string,
  allowedOrigins: readonly string[],
  paths: readonly string[],
): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const origin = url.origin;
  const local = url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !local) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (!allowedOrigins.includes(origin)) return null;
  // A page to act on, never a file: only the exact pages this message is meant to point to.
  if (!paths.includes(url.pathname)) return null;
  // Only the few query values the existing invitation and request links already use.
  for (const key of url.searchParams.keys()) {
    if (!['token', 'kind', 'id'].includes(key)) return null;
  }
  return url.toString();
}

/** A due date in words, or null when it is not a plausible due date. */
function dueDateWords(value: string, now: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  if (!isDueWindow(date, now)) return null;
  const month = MONTH_NAMES[date.getUTCMonth()];
  return month === undefined ? null : `${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** A due date is soon, or just past. A date of birth or an old expiry is far outside this window. */
function isDueWindow(date: Date, now: Date): boolean {
  const day = 86_400_000;
  const distance = date.getTime() - now.getTime();
  return distance >= -90 * day && distance <= 3 * 365 * day;
}

const DAY_MONTH_YEAR = new RegExp(`^(\\p{Nd}{1,2}) (${MONTH}) (\\p{Nd}{4})$`, 'iu');

/**
 * Prepared text may name a due day ("Due: 12 Nov 2026"), and nothing else shaped like a date: every
 * date-like piece must be a day, a month name and a year that fall in the due-date window. A date
 * of birth in words, with slashes or with dashes is therefore refused.
 */
function datesAreDueDates(text: string, now: Date): boolean {
  const matches = text.match(new RegExp(DATE_LIKE.source, 'giu')) ?? [];
  return matches.every((found) => {
    const parts = found.trim().match(DAY_MONTH_YEAR);
    if (!parts) return false;
    const month = MONTH_NAMES.findIndex((name) =>
      parts[2]?.toLowerCase().startsWith(name.toLowerCase()),
    );
    if (month < 0) return false;
    const date = new Date(Date.UTC(Number(parts[3]), month, Number(parts[1])));
    return !Number.isNaN(date.getTime()) && isDueWindow(date, now);
  });
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function greeting(firstName: string | null): string {
  return firstName ? `Hello ${firstName},` : 'Hello,';
}

function finish(text: string, link: string | null): ShareResult {
  if (text.length > MAX_MESSAGE_LENGTH) return fail({ reason: 'too-long' });
  // The finished text is checked again: apart from the one link, it must hold nothing risky.
  const rest = link === null ? text : text.replace(link, '');
  if (rest.includes('://') || containsUnsafeDetail(rest)) {
    return fail({ reason: 'unsafe-text', field: 'message' });
  }
  return { ok: true, message: { text } as ShareMessage };
}

/** Builds a message from typed fields, or says why it cannot. Never throws. */
export function composeShareMessage(input: ShareInput, options: ShareOptions): ShareResult {
  const now = options.now ?? new Date();

  if (input.template === 'support-hello') {
    return finish('Hello VisaStack, I need some help.', null);
  }

  if (input.template === 'prepared-text') {
    const text = input.text.normalize('NFKC').trim();
    if (text.length === 0) return fail({ reason: 'unsafe-text', field: 'text' });
    if (text.length > MAX_MESSAGE_LENGTH) return fail({ reason: 'too-long' });
    // Prepared text has no link by design; one in it is a mistake, not a feature.
    if (containsUnsafeDetail(text) || !datesAreDueDates(text, now)) {
      return fail({ reason: 'unsafe-text', field: 'text' });
    }
    return finish(input.text.trim(), null);
  }

  const link = ownLink(input.link, options.allowedOrigins, LINK_PAGES[input.template]);
  if (link === null) return fail({ reason: 'bad-link' });

  if (input.template === 'summary-link') {
    return finish(
      `Hello, I have put my visa details together on VisaStack and shared what you need there. Please sign in to VisaStack to see it: ${link}`,
      link,
    );
  }

  if (input.template === 'contributor-request') {
    const kind = optionalWords(input.documentKind);
    if (!kind.ok) return fail({ reason: 'unsafe-text', field: 'documentKind' });
    const of = kind.value ? ` (${kind.value})` : '';
    return finish(
      `Hello, I need one document from you${of} for my visa application. I keep my documents safe on VisaStack. Open this private link to send it: ${link}`,
      link,
    );
  }

  const first = optionalWords(input.firstName);
  if (!first.ok) return fail({ reason: 'unsafe-text', field: 'firstName' });
  const agency = optionalWords(input.agencyName);
  if (!agency.ok) return fail({ reason: 'unsafe-text', field: 'agencyName' });
  const hello = greeting(first.value);

  if (input.template === 'client-invitation') {
    const who = agency.value ?? 'your agency';
    return finish(
      `${hello} ${who} has invited you to VisaStack, where you keep your visa documents in one place. Open your private invitation and follow the steps: ${link}`,
      link,
    );
  }

  if (input.template === 'team-invitation') {
    const who = agency.value ?? 'your agency';
    return finish(
      `${hello} ${who} has invited you to join its team on VisaStack. Open your private invitation and follow the steps: ${link}`,
      link,
    );
  }

  if (input.template === 'sharing-invitation') {
    return finish(
      `${hello} I would like to share some of my visa details with you on VisaStack. Open this private invitation to review and accept: ${link}`,
      link,
    );
  }

  // collection-link
  const kinds: string[] = [];
  for (const kind of (input.documentKinds ?? []).slice(0, MAX_KINDS)) {
    const word = plainWords(kind);
    if (word === null) return fail({ reason: 'unsafe-text', field: 'documentKinds' });
    kinds.push(word);
  }
  const caseName = optionalWords(input.caseName);
  if (!caseName.ok) return fail({ reason: 'unsafe-text', field: 'caseName' });
  let due: string | null = null;
  if (input.dueDate !== undefined) {
    due = dueDateWords(input.dueDate, now);
    if (due === null) return fail({ reason: 'bad-date' });
  }
  const who = agency.value ?? 'your agency';
  const ask = kinds.length > 0 ? `for ${listWords(kinds)}` : 'for documents';
  const about = caseName.value ? ` for ${caseName.value}` : '';
  const by = due ? ` Please send them by ${due}.` : '';
  return finish(
    `${hello} ${who} has asked you ${ask}${about} through VisaStack.${by} Open your private link to get started: ${link}`,
    link,
  );
}

/** A phone number in international digits (8 to 15), or null. Accepts +, spaces and dashes. */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw
    .replace(/[\s().-]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/**
 * The link that opens WhatsApp with the message ready. With a number it opens that chat; without
 * one it opens WhatsApp's own contact picker. Nothing is sent until the person presses Send.
 */
export function whatsAppHref(message: ShareMessage, number?: string | null): string {
  const digits = normalizeWhatsAppNumber(number);
  const query = `text=${encodeURIComponent(message.text)}`;
  return digits ? `https://wa.me/${digits}?${query}` : `https://wa.me/?${query}`;
}
