import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { PATHNAME_REQUEST_HEADER } from '../../lib/csp-middleware';
import { primeLocale } from '../../lib/i18n-server';
import { WorkspaceFrame } from './workspace-frame';

export const dynamic = 'force-dynamic';

/**
 * Shared context-aware chrome over existing owner/membership/role reads (see `WorkspaceFrame`).
 * The page address is set by the middleware on every workspace request; it only lets the first
 * paint of a case page name its traveller, and the frame checks that case with the owner's read.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  // Layouts and pages render in parallel, so this layout primes the language for its own chrome.
  await primeLocale();
  return WorkspaceFrame({ children, pathname: await requestedPath() });
}

/**
 * The address the middleware passed on. With no request to read (a unit test, a static render) the
 * answer is none, so the layout never fails over a first-paint improvement; the case page then
 * names its traveller from the browser, as before.
 */
async function requestedPath(): Promise<string | null> {
  try {
    return (await headers()).get(PATHNAME_REQUEST_HEADER);
  } catch {
    return null;
  }
}
