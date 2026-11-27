/**
 * The shape of a drafted Bengali message for the public pages, shared by every `*-messages.ts` file
 * (landing, shell, how it works, ...). Each says what kind of wording it is and whether its Bengali
 * is shown (`live`) or held in English until signed off. See landing-messages.ts for the kinds.
 *
 * `key` ties a message to a catalogue key (`home.layout.status`) when the English comes from a
 * catalogue that has no Bengali for it; without a key the message is found by its exact English
 * text (the words a page passes to `publicText`).
 */
export type MessageClass = 'ordinary' | 'claim' | 'authority' | 'status' | 'example' | 'legal';

export interface PublicMessage {
  readonly en: string;
  readonly bn: string;
  readonly cls: MessageClass;
  /** True when the Bengali is shown to a visitor who chose Bengali. False: held for review. */
  readonly live: boolean;
  readonly key?: string;
}

/** Interface wording: ships. */
export const o = (en: string, bn: string, key?: string): PublicMessage => ({
  en,
  bn,
  cls: 'ordinary',
  live: true,
  ...(key ? { key } : {}),
});

/** Wording that needs sign-off first: written in full, shown in English. */
export const held = (
  cls: Exclude<MessageClass, 'ordinary'>,
  en: string,
  bn: string,
  key?: string,
): PublicMessage => ({ en, bn, cls, live: false, ...(key ? { key } : {}) });
