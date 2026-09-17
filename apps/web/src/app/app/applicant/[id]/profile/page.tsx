import {
  type FactAssuranceView,
  hasConsent,
  listApplicantAssurance,
  listApplicantProfile,
} from '@visastack/services';
import Link from 'next/link';
import { withSession } from '../../../../../lib/session';
import { type FieldAssurance, ProfileEditor } from '../profile-editor';

/** RSC boundary: dates must cross as ISO strings, never `Date` objects. */
function toClientAssurance(view: FactAssuranceView): FieldAssurance {
  return {
    applicantDeclared: view.applicantDeclared,
    documentSupplied: view.documentSupplied,
    machineChecks: view.machineChecks.map((c) => ({
      name: c.name,
      passed: c.passed,
      detail: c.detail,
      performedAt: c.performedAt.toISOString(),
    })),
    agencyReviews: view.agencyReviews.map((r) => ({
      missionTitle: r.missionTitle,
      outcome: r.outcome,
      reason: r.reason,
      decidedAt: r.decidedAt.toISOString(),
    })),
    issuerConfirmations: view.issuerConfirmations.map((c) => ({
      issuerIdentity: c.issuerIdentity,
      exactClaim: c.exactClaim,
      response: c.response,
      validUntil: c.validUntil.toISOString(),
      expired: c.expired,
    })),
    tier: view.tier,
  };
}

export const dynamic = 'force-dynamic';

export default async function ApplicantProfilePage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    const [profile, coreGranted, assurance] = await Promise.all([
      listApplicantProfile(db, id),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
      listApplicantAssurance(db, { actorAccountId: accountId, applicantId: id }),
    ]);
    return {
      profile,
      coreGranted,
      // EVI-05: per-fact assurance is owner-only, same as the profile
      // itself. A denial here (a caller who somehow isn't the owner) just
      // means no breakdown renders, never a page error.
      assurance: assurance.ok ? assurance.value : [],
    };
  });

  interface EntryValue {
    readonly factId: string;
    readonly value: string | null;
    readonly status: string | null;
    readonly updatedAt: string | null;
    readonly effectiveFrom: string | null;
  }
  const values: Record<string, EntryValue> = {};
  const repeatingValues: Record<string, Record<string, EntryValue>> = {};
  for (const entry of data.profile) {
    const v = {
      factId: entry.factId,
      value: entry.value,
      status: entry.status,
      updatedAt: entry.updatedAt,
      effectiveFrom: entry.effectiveFrom,
    };
    if (entry.repeatingRecordKey === null) {
      values[entry.fieldKey] = v;
    } else {
      const byRecord = repeatingValues[entry.fieldKey] ?? {};
      byRecord[entry.repeatingRecordKey] = v;
      repeatingValues[entry.fieldKey] = byRecord;
    }
  }
  const assuranceByFactId = new Map(
    data.assurance.map((a) => [a.factId, toClientAssurance(a)] as const),
  );

  return (
    <article className="card">
      <p className="card-kicker">Master Profile</p>
      <h2 className="card-title">Structured facts</h2>
      <p className="card-body" style={{ marginBottom: '1.25rem' }}>
        Every save appends an immutable, provenance-tracked version — earlier values are never
        overwritten.
      </p>
      {data.coreGranted ? (
        <ProfileEditor
          applicantId={id}
          values={values}
          repeatingValues={repeatingValues}
          assurance={assuranceByFactId}
        />
      ) : (
        <p className="muted">
          Grant <strong>Core processing</strong> consent from <Link href="/app">Home</Link> to edit
          this profile.
        </p>
      )}
    </article>
  );
}
