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

const STATUS_LABELS: Record<string, string> = {
  DECLARED: 'Declared',
  EXTRACTED_PENDING: 'Extracted (Pending)',
  APPLICANT_CONFIRMED: 'Confirmed',
  DOCUMENT_SUPPORTED: 'Document-supported',
  AGENCY_REVIEWED: 'Agency-reviewed',
  CONFLICTED: 'Conflicted',
  STALE: 'Stale',
  SUPERSEDED: 'Superseded',
};

const METHOD_LABELS: Record<string, string> = {
  MANUAL: 'Manual',
  DOCUMENT: 'From Document',
  API: 'API',
  SYSTEM: 'System',
};

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
          STATUS_LABELS[v.status] ?? v.status,
          METHOD_LABELS[v.method] ?? v.method,
          v.reason,
          uses.length > 0 ? `Used by ${uses.join(', ')}` : null,
        ].filter((part): part is string => Boolean(part));
        return {
          id: v.id,
          what: `${fieldLabel(v.fieldKey) ?? v.fieldKey}${record}`,
          detail: detail.join(' · '),
          who: ACTOR_LABELS[v.actor],
          outcome: v.isCurrent
            ? { label: 'Current', tone: 'success' }
            : { label: 'Superseded', tone: 'neutral' },
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
        eyebrow="Record"
        title="History"
        description="Every value is an immutable version - nothing is ever overwritten. This is the full, ordered trail with its provenance."
      />

      {nothingSaved ? (
        <article className="card">
          <EmptyState
            icon="activity"
            title="Nothing Saved to This Profile Yet"
            action={{ href: `/app/applicant/${id}/profile`, label: 'Add Your Essentials' }}
          >
            History lists every saved version of a profile detail, with when and how it was saved.
            Nothing has been saved to this profile yet, so there is nothing to list. Add a detail on
            the profile, or upload a document and approve the details it suggests. Each save then
            appears here.
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
