import {
  type AgencyOwnList,
  type AgencyStartingList,
  agencyChecklistPrincipal,
  listAgencyOwnLists,
  listAgencyStartingLists,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, StatusBadge } from '../../../../../components/ui';
import { type SearchParamsRecord, firstParam } from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { CopyListButton } from './checklist-forms';

export const metadata: Metadata = { title: 'Checklists' };
export const dynamic = 'force-dynamic';

/** How many shared lists one screen shows; a search narrows the rest. */
const SHARED_LIST_LIMIT = 60;

function stateOf(list: AgencyOwnList): {
  readonly label: string;
  readonly tone: 'success' | 'warning' | 'neutral';
} {
  if (list.openDraftVersion !== null) return { label: 'Draft Open', tone: 'warning' };
  if (list.publishedVersion !== null)
    return { label: `Published, Version ${list.publishedVersion}`, tone: 'success' };
  return { label: 'Not Published', tone: 'neutral' };
}

/** The agency's own country checklists, and the shared lists it can start a copy from. */
export default async function AgencyChecklistsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const { orgId } = await params;
  const { q } = await searchParams;
  const search = (firstParam(q) ?? '').trim().slice(0, 60);
  const data = await withSession(async ({ db, accountId }) => {
    const scope = await agencyChecklistPrincipal(db, accountId, orgId);
    if (!scope.ok) return null;
    const own = await listAgencyOwnLists(db, scope.value);
    const shared = await listAgencyStartingLists(db, scope.value, { search });
    return {
      own: own.ok ? own.value : [],
      shared: shared.ok ? shared.value : ([] as AgencyStartingList[]),
    };
  });
  if (!data) notFound();
  const shown = data.shared.slice(0, SHARED_LIST_LIMIT);
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Agency Workspace"
        title="Checklists"
        description="Make a country list your own. Your cases offer your version, and the shared one stays as it is."
      />
      <section className="stack" aria-labelledby="own-lists">
        <h2 id="own-lists" className="section-title">
          Our Lists
        </h2>
        {data.own.length === 0 ? (
          <p>You have no lists of your own yet. Start from a shared list below.</p>
        ) : (
          <ul className="field-list">
            {data.own.map((list) => {
              const state = stateOf(list);
              return (
                <li key={list.packId}>
                  <Link href={`/app/agency/${orgId}/checklists/edit?pack=${list.packId}`}>
                    {list.name}
                  </Link>{' '}
                  <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="stack" aria-labelledby="shared-lists">
        <h2 id="shared-lists" className="section-title">
          Start from a Shared List
        </h2>
        <form method="get" className="form-grid">
          <div className="field-row">
            <label className="field-label" htmlFor="checklist-search">
              Country
            </label>
            <input
              id="checklist-search"
              name="q"
              type="search"
              className="input"
              defaultValue={search}
              maxLength={60}
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
        {shown.length === 0 ? (
          <p>No shared list matches.</p>
        ) : (
          <ul className="field-list">
            {shown.map((list) => (
              <li key={list.packVersionId}>
                <strong>{list.packName}</strong>{' '}
                {list.starter ? (
                  <StatusBadge tone="neutral">Starter List, Not Official</StatusBadge>
                ) : null}
                {list.ownCopyPackId ? (
                  <Link href={`/app/agency/${orgId}/checklists/edit?pack=${list.ownCopyPackId}`}>
                    Open Our Copy
                  </Link>
                ) : (
                  <CopyListButton
                    organizationId={orgId}
                    packVersionId={list.packVersionId}
                    name={list.packName}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {data.shared.length > shown.length ? (
          <p>Showing the first {shown.length}. Search by country to narrow the list.</p>
        ) : null}
      </section>
    </div>
  );
}
