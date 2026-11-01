import { accountPrincipal, listDeletionReceipts, requireAccess } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  RemovalRecordList,
  type RemovalRecordRow,
} from '../../../../../components/lifecycle/removal-record-list';
import { PageHeader } from '../../../../../components/ui';
import { withSession } from '../../../../../lib/session';
import { BACKUP_SENTENCE } from './messages';

export const metadata: Metadata = { title: 'Removal Records' };

export const dynamic = 'force-dynamic';

/** At most this many records are read; the list shows ten, then Show More. */
const RECORDS_READ_LIMIT = 200;

/**
 * Removal Records (LC-C, PROGRAMME section 5.3): what has been deleted from this traveller's
 * record and where it stands, by reference code and kind only, never a name or a title. Owner
 * only. Before migration 0113 there is nothing to show, so the page says so.
 */
export default async function RemovalRecordsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const records = await withSession(async ({ db, accountId }) => {
    const gate = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'self' },
    );
    if (!gate.ok || gate.value.actor.kind !== 'applicant_owner') return null;
    const read = await listDeletionReceipts(gate.value, { limit: RECORDS_READ_LIMIT });
    // A missing table (before migration 0113) reads as no records, never as an error page.
    return read.ok ? read.value : [];
  });
  if (records === null) notFound();

  const rows: RemovalRecordRow[] = records.map((record) => ({
    id: record.id,
    subjectKind: record.subjectKind,
    subjectCode: record.subjectCode,
    documentKind: record.documentKind,
    scheduledFor: record.scheduledFor,
    verifiedGoneAt: record.verifiedGoneAt,
    requestedAt: record.requestedAt,
    status: record.status,
    effects: {
      casesSwitched: record.effects.casesSwitched,
      casesFlagged: record.effects.casesFlagged,
    },
  }));

  return (
    <>
      <PageHeader
        title="Removal Records"
        description="What was deleted from this record, and where each removal stands. Each one shows its reference code and kind only."
        back={{ href: `/app/applicant/${id}/documents`, label: 'Documents' }}
      />
      <section className="card lc-records-page" aria-labelledby="removal-records-heading">
        <h2 id="removal-records-heading" className="sr-only">
          Records
        </h2>
        <RemovalRecordList records={rows} />
        <p className="muted lc-records-backup">{BACKUP_SENTENCE}</p>
      </section>
    </>
  );
}
