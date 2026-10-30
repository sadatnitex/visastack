import type { Metadata } from 'next';
import { versionNoticeCopy } from '../../components/pilot-banner';
import { getDeploymentMode } from '../../lib/deployment-mode';
import { mixedPaymentsNote } from '../../lib/payment-providers';
import { isPublicBetaOpen } from '../../lib/public-beta';
import { StatusClient } from './status-client';

export const metadata: Metadata = { title: 'What Works Today' };

/**
 * The public status page. The page itself is a server component so it can name itself and word
 * the notice about this version (decided here, never in the browser); the live checks run in the
 * browser (`status-client.tsx`).
 */
export default function StatusPage() {
  return (
    <StatusClient
      versionNotice={versionNoticeCopy(getDeploymentMode(), isPublicBetaOpen())}
      paymentsNote={mixedPaymentsNote(process.env)}
    />
  );
}
