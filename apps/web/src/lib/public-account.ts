import { cache } from 'react';
import { accountInitials } from './account-initials';
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

/** What a public page may show of a signed-in person: a first name and up to two letters. */
export interface PublicPerson {
  readonly firstName: string;
  /** Up to two letters, the workspace's own rule; the rest of the name never leaves the server. */
  readonly initials: string;
}

/**
 * Next's own control-flow signals carry a string `digest` and must go back to Next unchanged
 * (the same check `isSignedIn` makes); an application error has none.
 */
function isNextSignal(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === 'string'
  );
}

export function publicPerson(displayName: unknown): PublicPerson | null {
  const firstName = publicFirstName(displayName);
  if (!firstName) return null;
  const words = (displayName as string)
    .trim()
    .split(/\s+/)
    .filter((word) => !word.includes('@'));
  return { firstName, initials: accountInitials(words.join(' ')) };
}

async function readPerson(reader?: SessionReader): Promise<PublicPerson | null> {
  try {
    const source = reader ?? (await import('./providers')).createIdentityPort();
    const identity = await source.currentIdentity();
    return publicPerson((identity as { displayName?: unknown } | null | undefined)?.displayName);
  } catch (error) {
    if (isNextSignal(error)) throw error;
    // The name is a courtesy: without it the menu says "Account" and everything else works.
    return null;
  }
}

/** The signed-in visitor for this request, or null. Call it only after `isSignedIn`. */
export const signedInPerson = cache(readPerson);
