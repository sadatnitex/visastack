import type { PublicMessage } from './message-kit';
import { SHELL_MESSAGES } from './shell-messages';
import { TITLES_MESSAGES } from './titles-messages';

/**
 * Finds the drafted Bengali for a public message. Every `*-messages.ts` file feeds this one table.
 * A message is found two ways: by catalogue key (when the English comes from a catalogue that has no
 * Bengali for it) or by its exact English text (the words a page hands to `publicText`). Only live
 * messages are found; a held message is simply not here, so the English stays, exactly as for any
 * message with no Bengali.
 */
const FILES: readonly Readonly<Record<string, PublicMessage>>[] = [SHELL_MESSAGES, TITLES_MESSAGES];

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
