import { hasConsent, listApplicantProfile } from '@visastack/services';
import Link from 'next/link';
import { withSession } from '../../../../../lib/session';
import { ProfileEditor } from '../profile-editor';

export const dynamic = 'force-dynamic';

export default async function ApplicantProfilePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    const [profile, coreGranted] = await Promise.all([
      listApplicantProfile(db, id),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
    ]);
    return { profile, coreGranted };
  });

  const values: Record<
    string,
    { value: string | null; status: string | null; updatedAt: string | null }
  > = {};
  const repeatingValues: Record<
    string,
    Record<string, { value: string | null; status: string | null; updatedAt: string | null }>
  > = {};
  for (const entry of data.profile) {
    const v = { value: entry.value, status: entry.status, updatedAt: entry.updatedAt };
    if (entry.repeatingRecordKey === null) {
      values[entry.fieldKey] = v;
    } else {
      const byRecord = repeatingValues[entry.fieldKey] ?? {};
      byRecord[entry.repeatingRecordKey] = v;
      repeatingValues[entry.fieldKey] = byRecord;
    }
  }

  return (
    <article className="card">
      <p className="card-kicker">Master Profile</p>
      <h2 className="card-title">Structured facts</h2>
      <p className="card-body" style={{ marginBottom: '1.25rem' }}>
        Every save appends an immutable, provenance-tracked version — earlier values are never
        overwritten.
      </p>
      {data.coreGranted ? (
        <ProfileEditor applicantId={id} values={values} repeatingValues={repeatingValues} />
      ) : (
        <p className="muted">
          Grant <strong>Core processing</strong> consent from <Link href="/app">Home</Link> to edit
          this profile.
        </p>
      )}
    </article>
  );
}
