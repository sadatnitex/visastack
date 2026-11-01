import { listRecentAuditEvents } from '@visastack/services';
import type { Metadata } from 'next';
import { ActivityLog } from '../../../../components/activity-log';
import { EmptyState } from '../../../../components/ui';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, isPlatformAdmin, staffPrincipal } from '../../../../lib/admin';
import { formatTimestamp } from '../../../../lib/format-date';
import { auditResultLabel, eventTypeLabel } from '../../../../lib/labels';
import {
  type SearchParamsRecord,
  firstParam,
  pagingHref,
  parseCursor,
} from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { tolerantReader } from '../../../../lib/tolerate';
import { AdminNotForRole, AdminRestricted } from '../admin-restricted';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Audit' };

export const dynamic = 'force-dynamic';

/** How many audit entries one load reads (the scroll budget's server limit for a log). */
const AUDIT_PAGE_SIZE = 50;
const AUDIT_PATH = '/app/admin/audit';
const LOG_ANCHOR = 'admin-audit-log';
/** The longest Who value the address may carry (the email standard's own limit). */
const WHO_MAX = 254;

/**
 * The Who search from the address, read the way the service reads it: a plausible email in lower
 * case, or empty (anything else shows the whole trail, so the page never claims a filter that the
 * read did not apply).
 */
function whoParam(value: string | readonly string[] | undefined): string {
  const raw = (firstParam(value) ?? '').trim().toLowerCase();
  if (raw.length === 0 || raw.length > WHO_MAX) return '';
  return /^[^\s@]+@[^\s@]+$/.test(raw) ? raw : '';
}

/**
 * The audit trail, every sensitive action across every tenant, 50 entries at a time by sequence
 * number (WP-SB6): Show Older Entries reads the next page from the server, and Who finds
 * everything one person did across the whole trail, not only the entries already loaded.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const search = (await searchParams) ?? {};
  const param = (name: string) => search[name];
  const before = parseCursor(param('before'));
  const who = whoParam(param('who'));
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    // The whole trail spans every traveller, so it is a security-administrator view.
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'AUDIT_TRAIL_VIEW',
    );
    if (!staff.ok) return { admin: true as const, allowed: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const page = await t(
      'audit events',
      async () => {
        const listed = await listRecentAuditEvents(db, staff.value, {
          limit: AUDIT_PAGE_SIZE,
          ...(before ? { before } : {}),
          ...(who ? { who } : {}),
        });
        if (!listed.ok) throw new Error(listed.error.message);
        return listed.value;
      },
      { items: [], nextCursor: null, whoMatched: null as boolean | null },
    );
    return {
      admin: true as const,
      allowed: true as const,
      auditEvents: page.items,
      olderCursor: page.nextCursor,
      whoMatched: page.whoMatched,
      failedSections,
    };
  });
  // Paging keeps the Who search; a new search starts again from the newest entry.
  const pagingSearch: SearchParamsRecord = who ? { who } : {};

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Audit"
        description="The platform's append-only, hash-chained audit trail."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : !data.allowed ? (
        <AdminNotForRole />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          <article className="card u-mt-150" id="admin-audit">
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title">Recent Audit Events</h2>
            <p className="card-body u-mb-100">
              The platform's append-only, hash-chained audit trail: every sensitive action across
              every tenant.
            </p>
            <form method="get" action={AUDIT_PATH} className="audit-who-search u-mb-100">
              <label className="field-label" htmlFor="audit-who">
                Find by Email
              </label>
              <input
                id="audit-who"
                className="input"
                type="email"
                name="who"
                defaultValue={who}
                maxLength={WHO_MAX}
                autoComplete="off"
                placeholder="person@example.com"
                aria-describedby="audit-who-help"
              />
              <button type="submit" className="btn btn-secondary">
                Find Entries
              </button>
              {who ? (
                <a className="btn btn-secondary" href={AUDIT_PATH}>
                  Show Everyone
                </a>
              ) : null}
              <p id="audit-who-help" className="muted u-fs-085 audit-who-help">
                {who
                  ? `Showing only what ${who} did, across the whole trail.`
                  : 'Find everything one person did, across the whole trail, by the email they sign in with.'}
              </p>
            </form>
            {data.auditEvents.length === 0 ? (
              who && data.whoMatched === false ? (
                <EmptyState title="No Account with This Email" icon="activity">
                  No account signs in with {who} now, so the trail cannot be searched by it. Entries
                  by an account that has since been removed show as Removed Account; show everyone
                  to find them.
                </EmptyState>
              ) : who ? (
                <EmptyState title="No Entries for This Person" icon="activity">
                  Nothing in the audit trail was done by {who}. Check the email, or show everyone.
                </EmptyState>
              ) : (
                <EmptyState title="No Audit Events Yet" icon="activity">
                  Sensitive actions across the platform are recorded here as they happen.
                </EmptyState>
              )
            ) : (
              <ActivityLog
                label="Audit Events"
                id={LOG_ANCHOR}
                {...(data.olderCursor
                  ? {
                      olderHref: pagingHref(
                        AUDIT_PATH,
                        pagingSearch,
                        { before: data.olderCursor },
                        LOG_ANCHOR,
                      ),
                    }
                  : {})}
                {...(before
                  ? {
                      newestHref: pagingHref(
                        AUDIT_PATH,
                        pagingSearch,
                        { before: null },
                        LOG_ANCHOR,
                      ),
                    }
                  : {})}
                entries={data.auditEvents.map((event) => ({
                  id: String(event.seq),
                  what: eventTypeLabel(event.eventType),
                  detail: [
                    `Code ${event.eventType}`,
                    event.resourceType ? `Resource ${event.resourceType}` : null,
                    event.reason ? `Reason: ${event.reason}` : null,
                  ]
                    .filter((part): part is string => part !== null)
                    .join(' \u00b7 '),
                  who: event.actorEmail ?? (event.actorAccountId ? 'Removed Account' : 'System'),
                  ...(event.result
                    ? {
                        outcome: {
                          label: auditResultLabel(event.result),
                          tone:
                            event.result === 'DENIED' ? ('danger' as const) : ('neutral' as const),
                        },
                      }
                    : {}),
                  at: event.occurredAt.toISOString(),
                  when: formatTimestamp(event.occurredAt),
                }))}
              />
            )}
          </article>
        </>
      )}
    </section>
  );
}
