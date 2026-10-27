import type { SelectedOutput } from '../selected-output';
import { LIMITS, type ListRow } from './whatsapp-port';

/**
 * What the WhatsApp channel says, decided by plain rules (no AI): reading the person's message,
 * and turning server-authorized summaries into short messages. Pure functions, so every reply is
 * tested exactly as sent. Wording rules: plain words, "case" never "mission", and never ask for
 * passport, ID or bank details in chat (WhatsApp Business Policy, research file section 15).
 */

export type ChannelIntent =
  | { readonly kind: 'ignore' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'start' }
  | { readonly kind: 'link'; readonly code: string }
  | { readonly kind: 'status' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'expiry' }
  | { readonly kind: 'person' }
  | { readonly kind: 'media' }
  | { readonly kind: 'menu' };

export const MENU_REPLY_IDS = {
  status: 'menu:status',
  missing: 'menu:missing',
  expiry: 'menu:expiry',
  person: 'menu:person',
  stop: 'menu:stop',
} as const;

const LINK_PATTERN = /^link\s*(\d{5})[-\s]?(\d{5})$/i;
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop messages', 'opt out', 'optout']);
const START_WORDS = new Set(['start', 'subscribe', 'resume']);

function matches(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/**
 * Reads one inbound message. Unknown text shows the menu rather than guessing; a reaction, a
 * location or anything else that is not text, a button or a file is left unanswered, so a
 * thumbs-up never sends the menu again.
 */
export function readIntent(input: {
  readonly kind: 'text' | 'reply' | 'media' | 'unsupported';
  readonly text: string | null;
  readonly replyId: string | null;
}): ChannelIntent {
  if (input.kind === 'unsupported') return { kind: 'ignore' };
  if (input.kind === 'media') return { kind: 'media' };
  if (input.kind === 'reply') {
    switch (input.replyId) {
      case MENU_REPLY_IDS.status:
        return { kind: 'status' };
      case MENU_REPLY_IDS.missing:
        return { kind: 'missing' };
      case MENU_REPLY_IDS.expiry:
        return { kind: 'expiry' };
      case MENU_REPLY_IDS.person:
        return { kind: 'person' };
      case MENU_REPLY_IDS.stop:
      case 'stop':
        return { kind: 'stop' };
      default:
        return { kind: 'menu' };
    }
  }
  const text = (input.text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const link = text.match(LINK_PATTERN);
  if (link) return { kind: 'link', code: `${link[1]}${link[2]}` };
  // "Stop.", "STOP!" and "stop 🙏" are an opt-out too; a sentence that mentions stopping is not.
  const bare = text.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (STOP_WORDS.has(bare)) return { kind: 'stop' };
  if (START_WORDS.has(bare)) return { kind: 'start' };
  if (matches(text, ['person', 'human', 'agent', 'someone', 'support', 'call me'])) {
    return { kind: 'person' };
  }
  if (matches(text, ['missing', 'need', 'left to do', 'to do', 'todo'])) return { kind: 'missing' };
  if (matches(text, ['expir', 'renew', 'valid until'])) return { kind: 'expiry' };
  if (matches(text, ['status', 'case', 'ready', 'progress', 'update'])) return { kind: 'status' };
  return { kind: 'menu' };
}

const PRIVACY_LINE = 'VisaStack never asks for passport, ID or bank details in WhatsApp.';

export const MENU_ROWS: readonly ListRow[] = [
  { id: MENU_REPLY_IDS.status, title: 'Case Status', description: 'Where each case stands' },
  { id: MENU_REPLY_IDS.missing, title: 'What Is Missing', description: 'Items still needed' },
  { id: MENU_REPLY_IDS.expiry, title: 'Expiring Soon', description: 'Documents that expire soon' },
  { id: MENU_REPLY_IDS.person, title: 'Talk to a Person', description: 'How to reach a person' },
  { id: MENU_REPLY_IDS.stop, title: 'Stop Messages', description: 'Turn off these messages' },
];

export const TEXT = {
  menuBody: `What would you like to see? ${PRIVACY_LINE}`,
  menuButton: 'Menu',
  welcome: `Hello from VisaStack. To see your case updates here, connect this WhatsApp from your VisaStack account. ${PRIVACY_LINE}`,
  connectLabel: 'Connect',
  connected:
    'This WhatsApp is now connected to your VisaStack account. You can disconnect it any time from your account page.',
  alreadyLinkedElsewhere:
    'This WhatsApp is already connected to a VisaStack account. Disconnect it there first, then try again.',
  codeRefused:
    'That code did not work. Codes last 10 minutes and work once. Create a new one from your VisaStack account.',
  tooManyAttempts: 'Too many tries. Please wait an hour, then create a new code in VisaStack.',
  stopped:
    'You will not get messages from VisaStack on WhatsApp. Send START to turn them back on. Your VisaStack account is not affected.',
  started: 'Messages from VisaStack on WhatsApp are on again.',
  media:
    'For your privacy, VisaStack does not take documents in WhatsApp. Add them in VisaStack, where they are checked and kept private.',
  mediaLabel: 'Add Documents',
  openLabel: 'Open VisaStack',
  noRecords: 'You have no travellers in VisaStack yet. Open VisaStack to add one.',
  unavailable: 'VisaStack cannot show this right now. Please try again later, or open VisaStack.',
} as const;

export function personText(supportEmail: string): string {
  return `To reach a person, email ${supportEmail} and a person will reply. If an agency is handling your case, you can also send them a message from the case page in VisaStack.`;
}

type Line = string;

/** Joins lines, stopping before the body limit, and says when something was left out. */
function fit(heading: string, lines: readonly Line[], empty: string): string {
  const more = 'Open VisaStack to see everything.';
  if (lines.length === 0) return `${heading}\n${empty}`;
  let body = heading;
  for (const [index, line] of lines.entries()) {
    const next = `${body}\n${line}`;
    const room = index === lines.length - 1 ? LIMITS.body : LIMITS.body - more.length - 1;
    if (next.length > room) return `${body}\n${more}`;
    body = next;
  }
  return body;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function caseName(title: string, destination: string | null): string {
  return clip(destination ? `${title} (${destination})` : title, 60);
}

export interface PersonSummary {
  readonly displayName: string;
  readonly output: SelectedOutput;
}

function withName(people: readonly PersonSummary[], person: PersonSummary, line: string): Line {
  return people.length > 1 ? `${clip(person.displayName, 30)}: ${line}` : line;
}

/** Each case: how many requirements are met and the next step. */
export function caseStatusText(people: readonly PersonSummary[]): string {
  const lines: Line[] = [];
  for (const person of people) {
    for (const item of person.output.cases) {
      const readiness = item.readiness
        ? `${item.readiness.satisfiedCount} of ${item.readiness.requiredCount} ready`
        : item.state;
      const next = item.nextActions[0];
      lines.push(
        withName(
          people,
          person,
          `- ${caseName(item.title, item.destination)}: ${readiness}.${next ? ` Next: ${clip(next.title, 60)}.` : ''}`,
        ),
      );
    }
  }
  return fit('Your cases', lines, 'You have no open cases in VisaStack yet.');
}

/** What each case still needs, by name only, never a value. */
export function missingText(people: readonly PersonSummary[]): string {
  const lines: Line[] = [];
  for (const person of people) {
    for (const item of person.output.cases) {
      const open = [...(item.readiness?.missing ?? []), ...(item.readiness?.needsAttention ?? [])]
        .filter((requirement) => !requirement.optional)
        .map((requirement) => clip(requirement.label, 40));
      if (open.length === 0) continue;
      const shown = open.slice(0, 5).join(', ');
      const extra = open.length > 5 ? ` and ${open.length - 5} more` : '';
      lines.push(
        withName(people, person, `- ${caseName(item.title, item.destination)}: ${shown}${extra}.`),
      );
    }
  }
  return fit('Still needed', lines, 'Nothing is missing from your open cases.');
}

/** Documents that expire within `withinDays`, soonest first. */
export function expiryText(people: readonly PersonSummary[], withinDays = 120): string {
  const items = people
    .flatMap((person) =>
      person.output.expiry
        .filter((entry) => entry.daysLeft <= withinDays)
        .map((entry) => ({ person, entry })),
    )
    .sort((a, b) => a.entry.daysLeft - b.entry.daysLeft);
  const lines = items.map(({ person, entry }) => {
    const when =
      entry.daysLeft < 0
        ? `expired on ${entry.expiresOn}`
        : `expires on ${entry.expiresOn} (${entry.daysLeft} ${entry.daysLeft === 1 ? 'day' : 'days'})`;
    return withName(people, person, `- ${clip(entry.kind, 40)}: ${when}.`);
  });
  return fit('Expiring soon', lines, 'Nothing expires in the next four months.');
}
