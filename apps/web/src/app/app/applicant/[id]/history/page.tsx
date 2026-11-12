import {
  accountPrincipal,
  listApplicantProfile,
  listMissionsUsingField,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ActivityLogEntry } from '../../../../../components/activity-log';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import {
  REPLACED_WORD,
  fieldMethodWords,
  fieldStatusWords,
} from '../../../../../lib/field-state-words';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { evidenceFieldGroups, fieldLabel } from '../../../../../lib/master-profile';
import {
  type SearchParamsRecord,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { HISTORY_LOG_ID, HistoryLog } from './history-log';

export const metadata: Metadata = { title: 'History' };

export const dynamic = 'force-dynamic';

/** How many saved versions one load shows (the log budget: 50 per load, older ones on request). */
const HISTORY_PAGE_SIZE = 50;

/** Why a version was saved, in words a person reads. A stored code that is not listed is left out, never shown raw. */
const REASON_LABELS: Record<string, string> = {
  ai_proposal_approved: 'You Approved a Suggestion',
  ai_app_suggestion_approved: 'You Approved an App Suggestion',
};

function reasonWords(reason: string | null): string | null {
  if (!reason) return null;
  if (/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(reason)) return REASON_LABELS[reason] ?? null;
  return reason;
}

const ACTOR_LABELS = {
  owner: 'You',
  someone_else: 'Someone Else',
  not_recorded: 'Not Recorded',
} as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The parts of the profile a person can narrow the history to, in the order the profile uses. */
function profileParts(): readonly { readonly key: string; readonly label: string }[] {
  return evidenceFieldGroups().map((group) => ({ key: group.key, label: group.label }));
}

/**
 * Profile History (WP-SB1): every saved version of every detail, newest first, in one log that
 * stays the same height. Fifty versions load at a time; Show Older Entries asks the server for the
 * next fifty. A part of the profile can be chosen on the server, and the log filters what is loaded
 * by detail, by who saved it and by when. Owner only.
 */
export default async function HistoryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams?: Promise<
    SearchParamsRecord & {
      readonly section?: string | string[];
      readonly before?: string | string[];
    }
  >;
}) {
  await primeLocale();
  const t = getServerT(appApplicantCatalog);
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const parts = profileParts();
  const wanted = firstParam(query.section);
  const section = parts.some((part) => part.key === wanted) ? wanted : undefined;
  const before = parseCursor(query.before);

  const data = await withSession(async ({ db, accountId }) => {
    const gate = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'profile_view' },
    );
    if (!gate.ok) return null;
    // The service lets only the owner read the history; anyone else is refused.
    const read = await listApplicantProfile(db, gate.value, {
      history: {
        limit: HISTORY_PAGE_SIZE,
        ...(before ? { before } : {}),
        ...(section ? { pack: section } : {}),
      },
    });
    if (!read.ok) return null;
    const page = read.value;

    // Where each detail that is in use now is used, read once per detail on this page.
    const currentKeys = [...new Set(page.items.filter((v) => v.isCurrent).map((v) => v.fieldKey))];
    const usedBy = new Map<string, readonly string[]>();
    await Promise.all(
      currentKeys.map(async (fieldKey) => {
        const result = await listMissionsUsingField(db, accountId, id, fieldKey);
        usedBy.set(fieldKey, result.ok ? result.value.map((m) => m.title) : []);
      }),
    );

    return {
      total: page.total,
      nextCursor: page.nextCursor,
      entries: page.items.map((v): ActivityLogEntry => {
        const at = v.createdAt.toISOString();
        const value =
          v.value ?? (v.isProtected ? 'Protected Detail (Hidden Here)' : 'No Value Recorded');
        const record = v.repeatingRecordKey ? ` (record ${v.repeatingRecordKey.slice(0, 8)})` : '';
        const uses = v.isCurrent ? (usedBy.get(v.fieldKey) ?? []) : [];
        const detail = [
          value,
          fieldStatusWords(v.status),
          fieldMethodWords(v.method) ?? 'Recorded Update',
          reasonWords(v.reason),
          uses.length > 0 ? `Used by ${uses.join(', ')}` : null,
        ].filter((part): part is string => Boolean(part));
        return {
          id: v.id,
          what: `${fieldLabel(v.fieldKey) ?? v.fieldKey}${record}`,
          detail: detail.join(' · '),
          who: ACTOR_LABELS[v.actor],
          outcome: v.isCurrent
            ? { label: 'Current', tone: 'success' }
            : { label: REPLACED_WORD, tone: 'neutral' },
          at,
          when: formatDateTime(at),
        };
      }),
    };
  });

  if (!data) notFound();

  const pathname = `/app/applicant/${id}/history`;
  const nothingSaved = data.total === 0 && !section;
  const partLabel = parts.find((part) => part.key === section)?.label;

  return (
    <>
      <PageHeader
        eyebrow={t('appApplicant.appApplicantIdExpiryPage.record')}
        title={t('appApplicant.appApplicantIdHistoryPage.history')}
        description={t('appApplicant.appApplicantIdHistoryPage.everySavedValueIsKeptAnd')}
      />

      {nothingSaved ? (
        <article className="card">
          <EmptyState
            icon="activity"
            title={t('appApplicant.appApplicantIdHistoryPage.nothingSavedToThisProfileYet')}
            action={{ href: `/app/applicant/${id}/profile`, label: 'Add Your Essentials' }}
          >
            {t('appApplicant.appApplicantIdHistoryPage.historyListsEverySavedVersionOf')}
          </EmptyState>
        </article>
      ) : (
        <HistoryLog
          pathname={pathname}
          parts={parts}
          section={section}
          partLabel={partLabel}
          entries={data.entries}
          total={data.total}
          {...(data.nextCursor
            ? {
                olderHref: pagingHref(pathname, query, { before: data.nextCursor }, HISTORY_LOG_ID),
              }
            : {})}
          {...(before
            ? { newestHref: pagingHref(pathname, query, { before: null }, HISTORY_LOG_ID) }
            : {})}
        />
      )}
    </>
  );
}
