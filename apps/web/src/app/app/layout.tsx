import type { ReactNode } from 'react';
import { primeLocale } from '../../lib/i18n-server';
import { requestedPath } from '../../lib/request-path';
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
