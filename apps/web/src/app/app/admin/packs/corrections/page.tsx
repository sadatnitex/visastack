import {
  CORRECTION_CATEGORY_LABELS,
  CORRECTION_STATUS_LABELS,
  type CorrectionQueue,
  type CorrectionView,
  type RuleImpactRunView,
  listChecklistCorrections,
  listRuleImpactRuns,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../lib/admin';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatTimestamp } from '../../../../../lib/format-date';
import { fieldLabel } from '../../../../../lib/master-profile';
import { withSession } from '../../../../../lib/session';
import { CorrectionDecisionForm } from './correction-forms';

export const metadata: Metadata = { title: 'Checklist Corrections', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

const SUBMITTER_LABELS = { TRAVELLER: 'A Traveller', AGENCY: 'An Agency' } as const;

/** The item a suggestion is about, in plain words. */
function correctionItemName(view: Pick<CorrectionView, 'item'>): string {
  if (!view.item) return 'The Whole Checklist';
  return view.item.kind === 'FIELD'
    ? (fieldLabel(view.item.key) ?? humanizeCode(view.item.key))
    : humanizeCode(view.item.key);
}

/** The address an editor can read before opening it: the host is shown on its own. */
function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function CorrectionCard({ view }: { readonly view: CorrectionView }) {
  const name = correctionItemName(view);
  const open = view.status === 'RECEIVED' || view.status === 'IN_REVIEW';
  return (
    <article className="card correction-card" aria-label={`Suggestion about ${name}`}>
      <p className="card-kicker">
        {view.packName} · Version {view.version} · From {SUBMITTER_LABELS[view.submitterKind]} ·{' '}
        {formatTimestamp(view.createdAt)}
      </p>
      <h3 className="card-title">
        {name} <span className="badge">{CORRECTION_CATEGORY_LABELS[view.category]}</span>{' '}
        <span className="badge badge-neutral">{CORRECTION_STATUS_LABELS[view.status]}</span>
      </h3>
      {view.alsoSuggestedBy > 0 ? (
        <p className="u-fs-085 u-m-0">
          {view.alsoSuggestedBy === 1
            ? '1 other open suggestion says the same.'
            : `${view.alsoSuggestedBy} other open suggestions say the same.`}
        </p>
      ) : null}
      {view.detail ? <p className="correction-detail">{view.detail}</p> : null}
      {view.officialUrl ? (
        <p className="u-fs-085 u-m-0">
          Official Link Given ({linkHost(view.officialUrl)}):{' '}
          <a
            href={view.officialUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="correction-link"
          >
            {view.officialUrl}
          </a>
        </p>
      ) : (
        <p className="muted u-fs-085 u-m-0">No official link given.</p>
      )}
      {view.reviewNote ? <p className="muted u-fs-085 u-m-0">Note: {view.reviewNote}</p> : null}
      <p className="u-fs-085 u-mt-050">
        <Link href={`/app/admin/packs/${view.packId}`}>Open Pack Studio</Link>
      </p>
      {open ? (
        <CorrectionDecisionForm
          correctionId={view.id}
          status={view.status === 'IN_REVIEW' ? 'IN_REVIEW' : 'RECEIVED'}
          itemName={name}
        />
      ) : null}
    </article>
  );
}

function ImpactRows({ runs }: { readonly runs: readonly RuleImpactRunView[] }) {
  return (
    <div className="rows u-mt-050">
      {runs.map((run) => (
        <div className="row" key={run.packVersionId}>
          <div className="stack-sm">
            <p className="row-key u-m-0">
              {run.packName} · Version {run.version}
            </p>
            <p className="muted u-fs-085 u-m-0">
              {run.publishedAt ? `Published ${formatTimestamp(run.publishedAt)}` : 'Published'}
              {run.assessedAt ? '' : ' · Not checked yet'}
            </p>
          </div>
          <dl className="rows rows-grid u-m-0">
            <div className="row">
              <dt className="row-key">Active Cases Marked</dt>
              <dd className="row-val">{run.casesFlagged}</dd>
            </div>
            <div className="row">
              <dt className="row-key">Notes Sent</dt>
              <dd className="row-val">{run.notesQueued}</dd>
            </div>
            <div className="row">
              <dt className="row-key">Still Waiting for Review</dt>
              <dd className="row-val">{run.stillOpen}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

type PageData =
  | { readonly allowed: false }
  | {
      readonly allowed: true;
      readonly queue: CorrectionQueue | null;
      readonly runs: readonly RuleImpactRunView[];
    };

/**
 * Checklist Corrections (UMPE P11): suggestions from travellers and agencies, waiting for a pack
 * editor, and what recent publications meant for active cases. Pack management rights only. A
 * suggestion never changes a rule here: an accepted one is written as a draft in Pack Studio.
 */
export default async function ChecklistCorrectionsPage() {
  const data: PageData = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PACK_MANAGE',
    );
    if (!staff.ok) return { allowed: false as const };
    const [queue, runs] = await Promise.all([
      listChecklistCorrections(db, staff.value),
      listRuleImpactRuns(db, staff.value),
    ]);
    return {
      allowed: true as const,
      queue: queue.ok ? queue.value : null,
      runs: runs.ok ? runs.value : [],
    };
  });

  return (
    <section className="section container">
      <div className="u-mb-150">
        <Link href="/app/admin/packs" className="muted u-fs-085">
          ← Pack Studio
        </Link>{' '}
        ·{' '}
        <Link href="/app/admin/packs/sources" className="muted u-fs-085">
          Official Sources
        </Link>
      </div>
      <PageHeader
        eyebrow="Pack Studio"
        title="Checklist Corrections"
        description="Suggestions from travellers and agencies about checklist items. A suggestion is never a rule: check it against the official source, then write any change as a draft that a second person approves."
      />

      {!data.allowed ? (
        <article className="card">
          <p className="card-body">This area is restricted to people who manage packs.</p>
        </article>
      ) : !data.queue || !data.queue.ready ? (
        <article className="card">
          <p className="card-body">
            Checklist corrections can be used once the database is updated.
          </p>
        </article>
      ) : (
        <div className="grid">
          <article className="card grid-span-all">
            <p className="card-kicker">Review</p>
            <h2 className="card-title">Suggestions to Review ({data.queue.openCount})</h2>
            <p className="muted u-fs-085 u-mt-050">
              Oldest first. Who sent a suggestion is never shown. Open an official link only after
              checking its address.
            </p>
            {data.queue.open.length === 0 ? (
              <p className="card-body u-mt-050">Nothing waiting for review.</p>
            ) : (
              <div className="grid u-mt-050">
                {data.queue.open.map((view) => (
                  <CorrectionCard key={view.id} view={view} />
                ))}
              </div>
            )}
          </article>

          <article className="card grid-span-all">
            <p className="card-kicker">After Publishing</p>
            <h2 className="card-title">Active Cases Marked for Review</h2>
            <p className="muted u-fs-085 u-mt-050">
              When a newer version is published, active cases on an older version are marked for
              review and their owners get one note. Their trips are never changed.
            </p>
            {data.runs.length === 0 ? (
              <p className="card-body u-mt-050">No publications checked yet.</p>
            ) : (
              <ImpactRows runs={data.runs} />
            )}
          </article>

          {data.queue.decided.length > 0 ? (
            <article className="card grid-span-all">
              <p className="card-kicker">History</p>
              <h2 className="card-title">Recently Decided</h2>
              <div className="grid u-mt-050">
                {data.queue.decided.map((view) => (
                  <CorrectionCard key={view.id} view={view} />
                ))}
              </div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}
