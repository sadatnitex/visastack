import { AGENCIES_MESSAGES } from './agencies-messages';
import { COUNTRIES_MESSAGES } from './countries-messages';
import { HOW_MESSAGES } from './how-messages';
import { KIT_MESSAGES } from './kit-messages';
import { LEGAL_MESSAGES } from './legal-messages';
import type { PublicMessage } from './message-kit';
import { MISC_MESSAGES } from './misc-messages';
import { SHELL_MESSAGES } from './shell-messages';
import { STATUS_MESSAGES } from './status-messages';
import { TITLES_MESSAGES } from './titles-messages';
import { TRUST_MESSAGES } from './trust-messages';

/**
 * Finds the drafted Bengali for a public message. Every `*-messages.ts` file feeds this one table.
 * A message is found two ways: by catalogue key (when the English comes from a catalogue that has no
 * Bengali for it) or by its exact English text (the words a page hands to `publicText`). Only live
 * messages are found; a held message is simply not here, so the English stays, exactly as for any
 * message with no Bengali.
 */
const FILES: readonly Readonly<Record<string, PublicMessage>>[] = [
  SHELL_MESSAGES,
  TITLES_MESSAGES,
  HOW_MESSAGES,
  AGENCIES_MESSAGES,
  COUNTRIES_MESSAGES,
  LEGAL_MESSAGES,
  TRUST_MESSAGES,
  STATUS_MESSAGES,
  MISC_MESSAGES,
  KIT_MESSAGES,
];

const byEnglish = new Map<string, PublicMessage>();
const byKey = new Map<string, PublicMessage>();

for (const file of FILES) {
  for (const message of Object.values(file)) {
    if (!message.live) continue;
    if (message.key) byKey.set(message.key, message);
    else byEnglish.set(message.en, message);
  }
}

/** The live Bengali for these exact English words, or undefined. */
export const publicBnByEnglish = (english: string): string | undefined =>
  byEnglish.get(english)?.bn;

/** The live Bengali for this catalogue key, or undefined. */
export const publicBnByKey = (key: string): string | undefined => byKey.get(key)?.bn;

/** The English of every message in every file, for tests and the packet. */
export const ALL_PUBLIC_MESSAGES: readonly PublicMessage[] = FILES.flatMap((file) =>
  Object.values(file),
);

/**
 * What the browser needs from the lookup, as one small table: every live keyed line (catalogue key to
 * Bengali) and, as `en:<English>`, the live lines the two client components read by their English
 * (the status list and the animation button). Everything else is worded on the server.
 */
export const liveClientDrafts = (): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [key, message] of byKey) out[key] = message.bn;
  for (const message of [...Object.values(STATUS_MESSAGES), ...ALL_PUBLIC_MESSAGES]) {
    if (!message.live || message.key) continue;
    if (message.cls === 'status' || /the Animation$/.test(message.en))
      out[`en:${message.en}`] = message.bn;
  }
  return out;
};
