import { resolveDocumentType } from '@visastack/core/catalogue';
import {
  type FactAssuranceView,
  accountPrincipal,
  aiSuggestionsInUse,
  getApplicant,
  getProfileSectionState,
  getWalletView,
  hasConsent,
  listApplicantAssurance,
  listApplicantProfile,
  listDocumentsDetailed,
  listEndedRecords,
  listMissions,
  listPendingAppSuggestions,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { initialsOf } from '../../../../../components/profile-photo/crop';
import { ProfilePhotoControl } from '../../../../../components/profile-photo/profile-photo-control';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { caseCountriesForFamily } from '../../../../../lib/case-choices';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { confirmedValues, findingViewModel } from '../../../../../lib/document-findings';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { buildMasterProfileView, fieldLabel } from '../../../../../lib/master-profile';
import { agree, plural } from '../../../../../lib/plural';
import { ownedPhotoUrl } from '../../../../../lib/profile-photos';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { withSession } from '../../../../../lib/session';
import { AppSuggestionsSection } from '../app-suggestions';
import { type FieldAssurance, ProfileEditor } from '../profile-editor';

export const metadata: Metadata = { title: 'My Profile' };

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
  readonly searchParams?: Promise<{ for?: string | string[]; view?: string | string[] }>;
}) {
  const { id } = await params;
  const { for: suggestParam, view: viewParam } = (await searchParams) ?? {};
  const suggestFor = typeof suggestParam === 'string' && suggestParam !== '' ? suggestParam : null;
  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [
      profile,
      coreGranted,
      assurance,
      sectionChoices,
      documents,
      photoUrl,
      fromApps,
      endedRecords,
    ] = await Promise.all([
      listApplicantProfile(db, id),
      hasConsent(db, accountId, 'CORE_PROCESSING'),
      listApplicantAssurance(db, { actorAccountId: accountId, applicantId: id }),
      getProfileSectionState(db, id),
      Promise.all([
        getWalletView(db, { actorAccountId: accountId, applicantId: id }),
        listDocumentsDetailed(db, accountId, id),
      ]),
      ownedPhotoUrl(db, accountId, id),
      // Suggestions the person's own AI apps made about the profile itself, with no document
      // (S21). They stay here to decide whether or not AI App Suggestions is on.
      requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: id },
        { purpose: 'ai_app_suggestions' },
      ).then(async (gate) =>
        gate.ok
          ? {
              pending: await listPendingAppSuggestions(gate.value),
              inUse: await aiSuggestionsInUse(gate.value),
            }
          : { pending: [], inUse: false },
      ),
      // LC-G1: the list entries the person said have ended, so each shows "Ended" with its date.
      requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: id },
        { purpose: 'profile_view' },
      ).then(async (gate) =>
        gate.ok ? await listEndedRecords(gate.value) : new Map<string, string>(),
      ),
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
    // The countries of this person's own cases for the chosen purpose, so the suggestions name
    // only the country sections those cases are about.
    const cases = suggestFor !== null ? await listMissions(db, accountId, id) : null;
    const caseCountries =
      suggestFor !== null && cases?.ok
        ? caseCountriesForFamily(cases.value, suggestFor)
        : new Set<string>();
    const pending = fromApps.pending;
    // Compared with the profile only when there is something to compare, with protected values
    // read on the server first (as Documents does), so an identical value is never a difference.
    const encryption = pending.length > 0 ? createKeyManagementPort() : undefined;
    const confirmedNow =
      pending.length > 0
        ? confirmedValues(
            encryption ? await listApplicantProfile(db, id, encryption) : profile,
            encryption !== undefined,
          )
        : new Map();
    return {
      applicant,
      photoUrl,
      profile,
      appSuggestions: pending.map((reading) => findingViewModel(reading, confirmedNow)),
      // The section stays while an app may suggest more, so the last decision is still confirmed.
      appSuggestionsInUse: fromApps.inUse,
      coreGranted,
      sectionChoices,
      uploadedDocumentTypes,
      caseCountries,
      // EVI-05: per-fact assurance is owner-only, same as the profile
      // itself. A denial here (a caller who somehow isn't the owner) just
      // means no breakdown renders, never a page error.
      assurance: assurance.ok ? assurance.value : [],
      endedRecords: Object.fromEntries(endedRecords),
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
    caseCountries: data.caseCountries,
  });
  const completeness = view.percent;
  const { essentials } = view;
  const essentialsDone = essentials.done;
  const essentialsPercent = essentials.percent;
  const changes = [...data.profile]
    .filter((entry) => entry.updatedAt)
    .sort(
      (a, b) =>
        new Date(b.updatedAt as string).getTime() - new Date(a.updatedAt as string).getTime(),
    )
    .slice(0, 5);
  const confirmed = data.profile.filter((entry) => entry.status === 'APPLICANT_CONFIRMED').length;
  const supported = data.profile.filter((entry) => entry.status === 'DOCUMENT_SUPPORTED').length;
  const depth = await readDepth('profile');
  const depthWords = depthCopyFor('profile');
  return (
    <div className="master-profile">
      <PageHeader
        eyebrow="Record"
        title="My Profile"
        description="One reusable set of details. Every saved change stays in your history."
        actions={
          data.coreGranted ? (
            <a href="#profile-editor" className="btn btn-primary">
              Add Information
            </a>
          ) : (
            <Link className="btn btn-secondary" href="/app#permissions">
              Review Permissions
            </Link>
          )
        }
      />
      {data.appSuggestions.length > 0 || data.appSuggestionsInUse ? (
        <AppSuggestionsSection
          applicantId={id}
          proposals={data.appSuggestions}
          canApprove={data.coreGranted}
        />
      ) : null}
      <DepthScope family="profile" depth={depth}>
        <DepthSwitch family="profile" initial={depth} copy={depthWords} />
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
            <h2>{data.applicant.displayName}</h2>
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
          {/* Essentials lead: a new person sees "0 of 12 essentials", not the size of the whole
            profile. The full count follows once the essentials are added (and is always shown
            under Show All Sections). */}
          <div className="profile-completeness">
            <span>Essentials Added</span>
            <strong>
              {essentials.answered} of {essentials.total}
            </strong>
            <div className="meter" aria-hidden="true">
              <div className="meter-fill" style={{ width: `${essentialsPercent}%` }} />
            </div>
            <span className="muted">
              {essentialsDone
                ? `Full profile: ${completeness}% of the details in your ${plural(view.openSections, 'open section')}. `
                : 'The details most visa forms ask for first. '}
              This does not verify identity.
            </span>
          </div>
        </section>
        {conflictedCount > 0 ? (
          <p className="notice notice-warn" role="alert">
            {plural(conflictedCount, 'field')} {agree(conflictedCount, 'has', 'have')} conflicting
            proposed values. Review the fields marked <strong>Conflicted</strong> before relying on
            them.
          </p>
        ) : null}
        <div className="split profile-working-area">
          <article className="card split-main" {...atLevel('browse')}>
            {data.coreGranted ? (
              <ProfileEditor
                applicantId={id}
                values={values}
                repeatingValues={repeatingValues}
                assurance={assuranceByFactId}
                view={view}
                // A link that asks for everything, or details that disagree, open every section.
                startWithAll={viewParam === 'all' || conflictedCount > 0}
                endedRecords={data.endedRecords}
              />
            ) : (
              <EmptyState
                icon="lock"
                title="Choose Whether to Save Your Profile"
                action={{ href: '/app#permissions', label: 'Review Permissions' }}
              >
                Turn on “Let VisaStack Process My Details” on Home to edit this profile. Existing
                values are not changed.
              </EmptyState>
            )}
            <p className="muted profile-version-note">
              Every save appends an immutable version with its source. Earlier values remain in{' '}
              <Link href={`/app/applicant/${id}/history`}>History</Link>.
            </p>
          </article>
          <aside className="split-rail" aria-label="Profile health and latest changes">
            <div className="depth-item" {...atLevel('everything')}>
              <h2>Profile Health</h2>
              <article className="card rows">
                <div className="row">
                  <span>Confirmed by the traveller</span>
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
                <Link href={`/app/applicant/${id}/expiry`}>Dates &amp; Expiry →</Link>
              </article>
              <h2>Latest Changes</h2>
              <article className="card">
                {changes.length ? (
                  <ol className="traveller-activity">
                    {changes.map((entry) => (
                      <li key={entry.factId}>
                        <Link href={`/app/applicant/${id}/history`}>
                          <strong>{fieldLabel(entry.fieldKey) ?? 'Profile Detail'}</strong>
                          <span>{entry.method ?? 'Recorded Update'}</span>
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
            </div>
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
      </DepthScope>
    </div>
  );
}
