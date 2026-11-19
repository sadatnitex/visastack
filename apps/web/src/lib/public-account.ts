import { cache } from 'react';
import type { SessionReader } from './signed-in';

const LONGEST_FIRST_NAME = 40;

/**
 * The first name shown on the public pages (NAV3): the first word of the display name the
 * sign-in system holds, the same name the signed-in account card shows. Never the email: a name
 * that is an address (some sign-ups use one as the name) reads as no name at all, so a public
 * page, which may be shared in a screenshot, never carries it.
 */
export function publicFirstName(displayName: unknown): string | null {
  if (typeof displayName !== 'string') return null;
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  if (!first || first.includes('@')) return null;
  return first.length > LONGEST_FIRST_NAME ? first.slice(0, LONGEST_FIRST_NAME) : first;
}

async function readFirstName(reader?: SessionReader): Promise<string | null> {
  try {
    const source = reader ?? (await import('./providers')).createIdentityPort();
    const identity = await source.currentIdentity();
    return publicFirstName((identity as { displayName?: unknown } | null | undefined)?.displayName);
  } catch {
    // The name is a courtesy: without it the menu says "Account" and everything else works.
    return null;
  }
}

/** The signed-in visitor's first name for this request, or null. Call it only after `isSignedIn`. */
export const signedInFirstName = cache(readFirstName);
