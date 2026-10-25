import { resolveDocumentType } from '@visastack/core/catalogue';
import {
  type FactAssuranceView,
  getApplicant,
  getProfileSectionState,
  getWalletView,
  hasConsent,
  listApplicantAssurance,
  listApplicantProfile,
  listDocumentsDetailed,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { initialsOf } from '../../../../../components/profile-photo/crop';
import { ProfilePhotoControl } from '../../../../../components/profile-photo/profile-photo-control';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { buildMasterProfileView, fieldLabel } from '../../../../../lib/master-profile';
import { ownedPhotoUrl } from '../../../../../lib/profile-photos';
import { withSession } from '../../../../../lib/session';
import { type FieldAssurance, ProfileEditor } from '../profile-editor';

export const metadata: Metadata = { title: 'Profile' };

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
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<{ for?: string | string[] }>;
}) {
  const { id } = await params;
  const { for: suggestParam } = (await searchParams) ?? {};
  const suggestFor = typeof suggestParam === 'string' && suggestParam !== '' ? suggestParam : null;
  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [profile, coreGranted, assurance, sectionChoices, documents, photoUrl] =
      await Promise.all([
        listApplicantProfile(db, id),
        hasConsent(db, accountId, 'CORE_PROCESSING'),
        listApplicantAssurance(db, { actorAccountId: accountId, applicantId: id }),
        getProfileSectionState(db, id),
        Promise.all([
          getWalletView(db, { actorAccountId: accountId, applicantId: id }),
          listDocumentsDetailed(db, accountId, id),
        ]),
        ownedPhotoUrl(db, accountId, id),
      ]);
    // How many usable copies of each kind are in the wallet, so each section can say what backs
    // it. Usable: shown in the wallet, not expired or replaced, and not failed or quarantined.
    // When either list cannot load, the counts stay unknown rather than reading as "none".
    const [wallet, detailed] = documents;
    let uploadedDocumentTypes: Map<string, number> | undefined;
    if (wallet.ok && detailed.ok) {
      const safety = new Map(detailed.value.map((d) => [d.id, d.safetyStatus] as const));
      uploadedDocumentTypes = new Map<string, number>();
      for (const { document, status } of wallet.value) {
        if (status === 'EXPIRED' || status === 'SUPERSEDED') continue;
        const scan = safety.get(document.id);
        if (!scan || scan === 'QUARANTINED' || scan === 'FAILED') continue;
        const kind = document.docType ? resolveDocumentType(document.docType)?.key : undefined;
        if (kind) uploadedDocumentTypes.set(kind, (uploadedDocumentTypes.get(kind) ?? 0) + 1);
      }
    }
    return {
      applicant,
      photoUrl,
      profile,
      coreGranted,
      sectionChoices,
      uploadedDocumentTypes,
      // EVI-05: per-fact assurance is owner-only, same as the profile
      // itself. A denial here (a caller who somehow isn't the owner) just
      // means no breakdown renders, never a page error.
      assurance: assurance.ok ? assurance.value : [],
    };
  });

  if (!data) notFound();

  interface EntryValue {
    readonly factId: string;
    readonly value: string | null;
    readonly status: string | null;
    readonly updatedAt: string | null;
    readonly effectiveFrom: string | null;
    readonly sourceDocumentId: string | null;
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
      sourceDocumentId: entry.sourceDocumentId,
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
  // PRO-02: "Conflict... creates review issue/task" - a mission with an
  // attached pack already surfaces this prominently (an "unresolved_conflict"
  // reason in its own missing-requirements list), but a conflict can exist
  // before any case does, or on a manual-mode/no-pack case that never
  // computes readiness at all. This banner is the one place every conflict is
  // guaranteed to be visible, independent of any particular case.
  const conflictedCount = data.profile.filter((p) => p.status === 'CONFLICTED').length;

  const { nationality } = values;
  const view = buildMasterProfileView({
    entries: data.profile,
    activated: data.sectionChoices.activated,
    notApplicable: data.sectionChoices.notApplicable,
    noneDeclared: data.sectionChoices.noneDeclared,
    suggestFor,
    uploadedDocumentTypes: data.uploadedDocumentTypes,
  });
  const completeness = view.percent;
  const changes = [...data.profile]
    .filter((entry) => entry.updatedAt)
    .sort(
      (a, b) =>
        new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
    )
    .slice(0, 5);
  const confirmed = data.profile.filter((entry) => entry.status === 'APPLICANT_CONFIRMED').length;
  const supported = data.profile.filter((entry) => entry.status === 'DOCUMENT_SUPPORTED').length;
  return (
    <div className="master-profile">
      <PageHeader
        as="h2"
        eyebrow="Your Canonical Record"
        title="My Profile"
        description="One reusable set of details. Every saved change stays in your history."
        actions={
          data.coreGranted ? (
            <a href="#profile-editor" className="btn btn-primary">
              + Add information
            </a>
          ) : (
            <Link className="btn btn-secondary" href="/app#permissions">
              Review Permissions
            </Link>
          )
        }
      />
      <section
        className="profile-identity-banner"
        aria-label="Selected traveller and profile completion"
      >
        <ProfilePhotoControl
          applicantId={data.applicant.id}
          initials={initialsOf(data.applicant.displayName)}
          photoUrl={data.photoUrl}
          avatarClassName="profile-identity-avatar"
        />
        <div className="profile-identity-copy">
          <h3>{data.applicant.displayName}</h3>
          <p className="muted">
            {nationality?.value || 'Nationality not recorded'} · Profile created{' '}
            {formatTimestampDate(data.applicant.createdAt)}
          </p>
          <p className="muted">
            {data.applicant.relationship === 'SELF'
              ? 'Personal profile'
              : 'Managed traveller profile'}
            . Fact assurance is shown beside each field.
          </p>
        </div>
        <div className="profile-completeness">
          <span>Profile completion</span>
          <strong>{completeness}%</strong>
          <div className="meter" aria-hidden="true">
            <div className="meter-fill" style={{ width: `${completeness}%` }} />
          </div>
          <span className="muted">
            {view.answered} of {view.total} details in your {view.openSections} open sections have
            values. Opening a section adds its details to this number at once. This does not verify
            identity.
          </span>
        </div>
      </section>
      <div className="split profile-working-area">
        <article className="card split-main">
          {conflictedCount > 0 ? (
            <p className="notice notice-warn" role="alert">
              {conflictedCount} field{conflictedCount === 1 ? '' : 's'} have conflicting proposed
              values. Review the fields marked <strong>Conflicted</strong> before relying on them.
            </p>
          ) : null}
          {data.coreGranted ? (
            <ProfileEditor
              applicantId={id}
              values={values}
              repeatingValues={repeatingValues}
              assurance={assuranceByFactId}
              view={view}
            />
          ) : (
            <EmptyState
              icon="lock"
              title="Choose whether to save your profile"
              action={{ href: '/app#permissions', label: 'Review Permissions' }}
            >
              Turn on “Let VisaStack process my details” on Home to edit this profile. Existing
              values are not changed.
            </EmptyState>
          )}
          <p className="muted profile-version-note">
            Every save appends an immutable version with its source. Earlier values remain in{' '}
            <Link href={`/app/applicant/${id}/history`}>History</Link>.
          </p>
        </article>
        <aside className="split-rail" aria-label="Profile health and latest changes">
          <h3>Profile Health</h3>
          <article className="card rows">
            <div className="row">
              <span>Confirmed by applicant</span>
              <strong>{confirmed}</strong>
            </div>
            <div className="row">
              <span>Document-supported fields</span>
              <strong>{supported}</strong>
            </div>
            <div className="row">
              <span>Conflicting fields</span>
              <strong>{conflictedCount}</strong>
            </div>
            <p className="muted">
              These are distinct recorded states, not an overall verification score. Check field
              details for agency reviews and issuer confirmations.
            </p>
            <Link href={`/app/applicant/${id}/expiry`}>Check Document Expiry →</Link>
          </article>
          <h3>Latest Changes</h3>
          <article className="card">
            {changes.length ? (
              <ol className="traveller-activity">
                {changes.map((entry) => (
                  <li key={entry.factId}>
                    <Link href={`/app/applicant/${id}/history`}>
                      <strong>{fieldLabel(entry.fieldKey) ?? 'Profile detail'}</strong>
                      <span>{entry.method ?? 'Recorded update'}</span>
                    </Link>
                    <time dateTime={entry.updatedAt as string}>
                      {formatTimestampDate(entry.updatedAt as string)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState icon="activity" title="No Saved Changes Yet">
                Your saved field versions will appear here.
              </EmptyState>
            )}
            <Link href={`/app/applicant/${id}/history`}>All Profile History →</Link>
          </article>
          <div className="profile-review-note">
            <strong>You Decide What Becomes a Fact</strong>
            <p>
              AI suggestions do not change your profile until you approve them. Human and issuer
              assurance remain separate.
            </p>
            <Link href={`/app/applicant/${id}/documents`}>Review Document Suggestions →</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
