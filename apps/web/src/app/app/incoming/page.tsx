import {
  documentUploadReceiptsReady,
  hasConsent,
  listApplicants,
  loadUploadQuotaConfig,
  mbLabel,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../components/ui';
import { primeLocale } from '../../../lib/i18n-server';
import { isShareTargetOn } from '../../../lib/pwa/service-worker';
import { withSession } from '../../../lib/session';
import { pdfUploadsAccepted, uploadLimitBytes } from '../../../lib/upload-preflight';
import { IncomingPanel } from './incoming-panel';
import { shareOwnerKey } from './owner-key';

export const metadata: Metadata = { title: 'Shared Files' };

export const dynamic = 'force-dynamic';

/**
 * Where a photo or PDF shared from another app lands (WP-PIC11). The files are still only on this
 * phone, held by the service worker; this page shows them as pictures, asks who they are for, and
 * sends them only when the person presses Add These Files, through the same upload as Add
 * Documents. It exists only while the owner's share switch and the service worker are both on;
 * a phone that still offers the old share after the switch went off lands on one plain line.
 */
export default async function IncomingPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly missed?: string | string[];
    readonly none?: string | string[];
  }>;
}) {
  await primeLocale();
  const query = await searchParams;
  const missed = query.missed === '1';
  if (!isShareTargetOn((name) => process.env[name])) {
    if (!missed) notFound();
    return (
      <section className="section container">
        <PageHeader title="Shared Files" back={{ href: '/app', label: 'Home' }} />
        <article className="card">
          <p className="card-body">
            Sharing to VisaStack from other apps is not available right now, so nothing was kept.
            Add your files from your documents instead.
          </p>
        </article>
      </section>
    );
  }
  const notice = missed ? 'missed' : query.none === '1' ? 'none' : null;

  const data = await withSession(async ({ db, accountId }) => {
    const [everyone, coreGranted, receiptsReady] = await Promise.all([
      // An extra: if the list cannot be read the page says to add a person first.
      listApplicants(db, accountId).catch(() => []),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
      documentUploadReceiptsReady(db).catch(() => false),
    ]);
    return {
      people: everyone.map((person) => ({ id: person.id, name: person.displayName })),
      coreGranted,
      receiptsReady,
      ownerKey: shareOwnerKey(accountId),
    };
  });

  const limitBytes = uploadLimitBytes(loadUploadQuotaConfig());

  return (
    <section className="section container">
      <PageHeader
        title="Shared Files"
        description="Photos and PDFs you share to VisaStack from another app wait here, on this phone only, until you add them."
        back={{ href: '/app', label: 'Home' }}
      />
      {!data.coreGranted ? (
        <article className="card">
          <p className="card-body">
            Turn on <strong>Let VisaStack Process My Details</strong> on{' '}
            <Link href="/app#permissions">Home</Link> to add new documents. Shared files wait here
            for 15 minutes.
          </p>
        </article>
      ) : data.people.length === 0 ? (
        <article className="card">
          <p className="card-body">
            Add the person these documents are for on <Link href="/app">Home</Link> first. Shared
            files wait here for 15 minutes.
          </p>
        </article>
      ) : (
        <IncomingPanel
          ownerKey={data.ownerKey}
          notice={notice}
          people={data.people}
          limitBytes={limitBytes}
          limitLabel={mbLabel(limitBytes)}
          pdfAccepted={pdfUploadsAccepted()}
          retryUnknown={data.receiptsReady}
        />
      )}
    </section>
  );
}
