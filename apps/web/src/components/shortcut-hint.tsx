'use client';

import { useEffect, useState } from 'react';

/** What the browser says about the device; every part is optional because browsers differ. */
export interface PlatformHints {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string } | undefined;
}

const APPLE = /mac|iphone|ipad|ipod/i;

/**
 * Whether the keyboard has a Command key: Mac, iPhone and iPad (an iPad with a keyboard uses
 * Command too). Newer browsers say so in `userAgentData`; the rest in `platform` or, last, the
 * user agent text.
 */
export function isApplePlatform(hints: PlatformHints): boolean {
  const named = hints.userAgentData?.platform || hints.platform || hints.userAgent || '';
  return APPLE.test(named);
}

/** The keys to press, written the way each keyboard labels them. */
export function shortcutLabel(apple: boolean, key: string): string {
  // U+2318 is the Command key symbol printed on Apple keyboards.
  return apple ? `${String.fromCodePoint(0x2318)} ${key}` : `Ctrl ${key}`;
}

/**
 * The keyboard hint beside a search box ("Ctrl K", or the Command symbol and K on Apple
 * devices). The server cannot know the device, so the first render, on the server and in the
 * browser alike, keeps the hint's space but shows nothing (no hydration mismatch, no flash of
 * the wrong key); the browser fills it in once the page is running.
 */
export function ShortcutHint({
  keyName,
  className,
}: {
  readonly keyName: string;
  readonly className?: string;
}) {
  const [apple, setApple] = useState<boolean | null>(null);
  useEffect(() => {
    setApple(isApplePlatform(navigator as PlatformHints));
  }, []);
  const classes = [className, apple === null ? 'shortcut-hint-pending' : undefined]
    .filter(Boolean)
    .join(' ');
  return <kbd className={classes || undefined}>{shortcutLabel(apple ?? false, keyName)}</kbd>;
}
