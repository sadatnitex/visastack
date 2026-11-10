'use client';

import { useSyncExternalStore } from 'react';
import { Icon } from './icons';

/**
 * The flag of a country, drawn from its two-letter code with no picture to download: the flag
 * emoji for that code, round, with the country's name as its accessible name.
 *
 * Windows desktops do not draw flag emoji (a person sees two letters in a box), so there the same
 * place shows the country's letters on a plain round badge instead, which reads the same on every
 * screen. The server always sends the emoji and the browser switches after the page loads through
 * `useSyncExternalStore`, whose first browser pass equals the server's, so the page never fails to
 * match its own markup. A code that is not two letters draws a plain globe; with no name it is
 * decoration and is hidden from a screen reader.
 */

export type CountryFlagSize = 'sm' | 'md' | 'lg';

const CODE = /^[A-Za-z]{2}$/;
const REGIONAL_A = 0x1f1e6;

/** The flag emoji for a two-letter country code, or null when the code is not two letters. */
export function flagEmoji(iso2: string | null | undefined): string | null {
  const code = (iso2 ?? '').trim();
  if (!CODE.test(code)) return null;
  const [first, second] = code.toUpperCase();
  if (!first || !second) return null;
  return String.fromCodePoint(
    REGIONAL_A + first.charCodeAt(0) - 65,
    REGIONAL_A + second.charCodeAt(0) - 65,
  );
}

/** The two capital letters a plain badge shows for a country code, or null for a bad code. */
export function flagLetters(iso2: string | null | undefined): string | null {
  const code = (iso2 ?? '').trim();
  return CODE.test(code) ? code.toUpperCase() : null;
}

/** True where the operating system does not draw flag emoji (Windows desktops). */
export function platformLacksFlagEmoji(platform: {
  readonly userAgent?: string | undefined;
  readonly platform?: string | undefined;
}): boolean {
  // Firefox brings its own flag font to Windows; every other browser there shows two letters.
  if (/firefox\//i.test(platform.userAgent ?? '')) return false;
  return /windows/i.test(platform.platform ?? '') || /windows/i.test(platform.userAgent ?? '');
}

interface UserAgentDataNavigator {
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
}

function readLacksEmoji(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as UserAgentDataNavigator;
  return platformLacksFlagEmoji({
    userAgent: nav.userAgent,
    platform: nav.userAgentData?.platform,
  });
}

const noSubscription = () => () => {};
const serverSnapshot = () => false;

/** False on the server and on the first browser pass; true afterwards on a Windows desktop. */
export function useLacksFlagEmoji(): boolean {
  return useSyncExternalStore(noSubscription, readLacksEmoji, serverSnapshot);
}

export function CountryFlag({
  iso2,
  name,
  size = 'md',
  decorative = false,
}: {
  /** The country's two-letter code. Anything else draws a plain globe. */
  readonly iso2: string | null | undefined;
  /** The country's name: the flag's accessible name. */
  readonly name?: string | null | undefined;
  /** sm 24px, md 32px, lg 44px. */
  readonly size?: CountryFlagSize;
  /** True where the name is written right beside the flag, so a screen reader does not say it twice. */
  readonly decorative?: boolean;
}) {
  const lacksEmoji = useLacksFlagEmoji();
  const emoji = flagEmoji(iso2);
  const letters = flagLetters(iso2);
  const label = (name ?? '').trim();
  const hidden = decorative || label === '';
  const a11y = hidden
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': label } as const);

  if (!emoji || !letters) {
    return (
      <span className="country-flag country-flag-unknown" data-size={size} {...a11y}>
        <Icon name="globe" size={size === 'lg' ? 22 : size === 'md' ? 16 : 12} />
      </span>
    );
  }
  if (lacksEmoji) {
    return (
      <span
        className="country-flag country-flag-letters"
        data-size={size}
        data-flag-kind="letters"
        {...a11y}
      >
        {letters}
      </span>
    );
  }
  return (
    <span className="country-flag" data-size={size} data-flag-kind="emoji" {...a11y}>
      {emoji}
    </span>
  );
}
