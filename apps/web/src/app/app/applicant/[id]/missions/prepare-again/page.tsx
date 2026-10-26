import {
  type PrepareAgainItem,
  type PrepareAgainPlan,
  type PrepareAgainReason,
  accountPrincipal,
  hasConsent,
  planPrepareAgain,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../../components/ui';
import { humanizeCode } from '../../../../../../lib/format-code';
import { fieldLabel } from '../../../../../../lib/master-profile';
import { withSession } from '../../../../../../lib/session';
import {
  PrepareAgainForm,
  type PrepareAgainGroupView,
  type PrepareAgainItemView,
} from './prepare-again-form';

export const metadata: Metadata = { title: 'Prepare Again' };

export const dynamic = 'force-dynamic';

/** Why each requirement sits where it does, in plain words. */
const REASONS: Record<PrepareAgainReason, string> = {
  used_before: 'Used in your last case and still current.',
  only_match: 'The one current record on file that fits.',
  choose_one: 'More than one record fits. Tick the one to use, or choose later in the case.',
  needs_confirmation: 'Waiting for you to confirm or update it on your record.',
  conflict: 'Two sources disagree. Settle it on your record first.',
  too_old: 'Older than this route allows. Add a newer one.',
  not_usable: 'Still being checked, or cannot be used. Check it in Documents.',
  not_provided: 'Not on your record yet.',
};

const GROUPS: readonly Omit<PrepareAgainGroupView, 'items'>[] = [
  {
    key: 'REUSABLE',
    title: 'Reusable',
    hint: 'Current records your new case can use as they are. Untick anything you want to choose again.',
    tone: 'success',
  },
  {
    key: 'NEEDS_REVIEW',
    title: 'Needs Refreshing or Review',
    hint: 'Nothing here is reused until you check it.',
    tone: 'warning',
  },
  {
    key: 'MISSING',
    title: 'Missing',
    hint: 'Your new case still needs these.',
    tone: 'neutral',
  },
];

function requirementLabel(item: PrepareAgainItem): string {
  return item.kind === 'FIELD'
    ? (fieldLabel(item.key) ?? humanizeCode(item.key))
    : humanizeCode(item.key);
}

function itemView(item: PrepareAgainItem): PrepareAgainItemView {
  return {
    id: item.packRequirementId,
    label: requirementLabel(item),
    reason: REASONS[item.reason],
    optional: item.optional,
    records: item.records.map((record) =>
      record.kind === 'fact'
        ? {
            value: `${item.packRequirementId}|f|${record.factId}`,
            label: record.value ?? 'Protected Value',
            carriable: record.carriable,
            preselected: record.preselected,
          }
        : {
            value: `${item.packRequirementId}|d|${record.documentId}`,
            label: record.displayName,
            carriable: record.carriable,
            preselected: record.preselected,
          },
    ),
  };
}

function checklistNote(plan: PrepareAgainPlan): string {
  if (plan.checklistUnavailable) {
    return 'The checklist your last case used is no longer published. The new case starts without one; you can choose a checklist inside it.';
  }
  if (!plan.packVersion) {
    return 'Your last case had no checklist, so the new case starts without one.';
  }
  const name = `${plan.packVersion.packName} (version ${plan.packVersion.version})`;
  return plan.packVersion.changedSincePrevious
    ? `Checklist: ${name}. The rules were updated since your last case, so check the groups below.`
    : `Checklist: ${name}, the same rules as your last case.`;
}

/**
 * Prepare Again (Programme X U02): start a new case from a previous one.
 * Owner only; the plan is read through the access gate on the previous case.
 */
export default async function PrepareAgainPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<{ readonly from?: string | string[] }>;
}) {
  const { id } = await params;
  const { from } = (await searchParams) ?? {};
  const fromMissionId = typeof from === 'string' ? from : '';
  if (fromMissionId.length === 0) notFound();

  const data = await withSession(async ({ db, accountId }) => {
    const gate = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { missionId: fromMissionId },
      { purpose: 'owner_prepare_again' },
    );
    if (!gate.ok || gate.value.applicant.id !== id) return null;
    const plan = await planPrepareAgain(gate.value);
    if (!plan.ok) return null;
    return { plan: plan.value, coreGranted: await hasConsent(db, accountId, 'CORE_PROCESSING') };
  });
  if (!data) notFound();
  const { plan } = data;

  return (
    <>
      <PageHeader
        back={{ href: `/app/mission/${plan.source.id}`, label: plan.source.title }}
        eyebrow="Cases"
        title="Prepare Again"
        description="Start a new case from this one. Your current records are reused by reference. Nothing from the old case's work, notes, approvals, sign-off or sharing is copied."
        as="h2"
      />
      {data.coreGranted ? (
        <PrepareAgainForm
          applicantId={id}
          fromMissionId={plan.source.id}
          defaultTitle={plan.source.title}
          expectedPackVersionId={plan.packVersion?.id ?? ''}
          checklistNote={checklistNote(plan)}
          groups={GROUPS.map((group) => ({
            ...group,
            items: plan.items.filter((i) => i.group === group.key).map(itemView),
          }))}
          sharingQuestions={plan.sharingQuestions.map((q) => ({
            kind: q.kind,
            id: q.id,
            recipient: q.recipient.label,
            purpose: q.purpose,
            pending: q.status === 'PENDING' || q.status === 'PENDING_ACCEPTANCE',
          }))}
        />
      ) : (
        <p className="card-body">
          Turn on <strong>Let VisaStack Process My Details</strong> on <Link href="/app">Home</Link>{' '}
          to create cases.
        </p>
      )}
    </>
  );
}
