import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { PATHNAME_REQUEST_HEADER } from '../../lib/csp-middleware';
import { WorkspaceFrame } from './workspace-frame';

export const dynamic = 'force-dynamic';

/**
 * Shared context-aware chrome over existing owner/membership/role reads (see `WorkspaceFrame`).
 * The page address is set by the middleware on every workspace request; it only lets the first
 * paint of a case page name its traveller, and the frame checks that case with the owner's read.
 */
export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const pathname = (await headers()).get(PATHNAME_REQUEST_HEADER);
  return <WorkspaceFrame pathname={pathname}>{children}</WorkspaceFrame>;
}
