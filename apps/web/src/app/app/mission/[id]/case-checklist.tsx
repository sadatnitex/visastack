import {
  ANY_OF_LABEL,
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  groupByRequirementCategory,
} from '@visastack/core';
import { isFillerCitation, safeHttpUrl } from '@visastack/services';
import type { ComponentProps, ReactNode } from 'react';
import { Icon } from '../../../../components/icons';
import { ChecklistRow, SectionCard } from '../../../../components/ui-lift';
import { bookingReminderFor } from '../../../../lib/booking-reminder';
import { formatDateOnly } from '../../../../lib/format-date';
import {
  CHECKLIST_GROUP_TONE,
  CHECKLIST_ID_PREFIX,
  CHECKLIST_ROWS_SHOWN,
  type CaseSourceRow,
  type ExpiringDocumentRow,
  REQUIREMENT_STATE_META,
  type RequirementDetailRow,
  buildChecklistGroups,
  categoryProgress,
  plural,
  requirementLabel,
  toneOfBadge,
} from './case-model';
import { OpenGroupOnLink } from './open-group-on-link';
import { ExplainGapButton } from './readiness-gap-explain';
import { SuggestCorrection } from './suggest-correction';

/** Why Gap Explanations is off, when it is (S28); undefined when it is on. */
export type GapExplanationOff = ComponentProps<typeof ExplainGapButton>['off'];

/** What the checklist needs to offer an AI explanation of a gap. */
export interface ChecklistExplanations {
  /** An AI provider is set up, so the Explain button may show. */
  readonly configured: boolean;
  /** Set (possibly with no reason) when Gap Explanations is switched off; undefined when on. */
  readonly off: GapExplanationOff;
  /** The newest explanation on file per checklist item (`packRequirementId`). */
  readonly byRequirement: ReadonlyMap<string, string | null>;
}

export interface CaseChecklistProps {
  readonly missionId: string;
  readonly applicantId: string;
  /** Every checklist row of the case, in checklist order (`requirementDetails`). */
  readonly rows: readonly RequirementDetailRow[];
  /** The chosen document names per checklist item (`evidenceLifecycle.chosenByRequirement`). */
  readonly chosenByRequirement: Readonly<Record<string, readonly string[] | undefined>>;
  readonly explanations: ChecklistExplanations;
  /** The checklist the rows come from, named beside the heading; null when it could not be read. */
  readonly packName: string | null;
}

/**
 * The Evidence Checklist, the heart of the case page: one group per state (Needs You, Needs a
 * Check, Done), each group's first rows shown and the rest folded, with the category headings and
 * how far each category is when the checklist has categories. Each row says what it is, what to do
 * in one sentence and gives one action; the rest of what is known about it is folded under "More
 * About This Item". A finished row is one line. The anchor `#readiness` points at this block.
 */
export function CaseChecklist({
  missionId,
  applicantId,
  rows,
  chosenByRequirement,
  explanations,
  packName,
}: CaseChecklistProps) {
  /** One checklist row (WP-SB2 moved it out of the group so a group can show its first rows). */
  const requirementRow = (r: RequirementDetailRow) => {
    const meta = REQUIREMENT_STATE_META[r.state];
    const label = requirementLabel(r);
    const done = r.state === 'SATISFIED' || r.state === 'ATTENTION' || r.state === 'NOT_APPLICABLE';
    // UMPE P1: the other items any one of which would meet the same requirement.
    // A member whose rule says it does not apply to this case is no alternative.
    const alternatives =
      r.groupKey && r.state !== 'NOT_APPLICABLE'
        ? rows
            .filter(
              (o) =>
                o.groupKey === r.groupKey &&
                o.packRequirementId !== r.packRequirementId &&
                o.state !== 'NOT_APPLICABLE',
            )
            .map(requirementLabel)
        : [];
    const sourceLine = [r.publisher, r.sourceTitle].filter(Boolean).join(' · ');
    const sourceHref = safeHttpUrl(r.sourceUrl);
    // A citation that only fills the box ("Yes", "n/a") is not a source, so it is not shown as one.
    const citationText = r.citation && !isFillerCitation(r.citation) ? r.citation : '';
    const bookingReminder =
      r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION'
        ? bookingReminderFor(r.kind, r.key)
        : null;
    const chosen = chosenByRequirement[r.packRequirementId];
    const necessity = r.coveredByAlternative
      ? '· met by an alternative'
      : r.necessity
        ? `· ${NECESSITY_LABELS[r.necessity]}`
        : r.optional
          ? '· optional'
          : undefined;
    // The one thing to do about the item: add it, or settle the two values on the profile.
    const action =
      r.state === 'CONFLICTING'
        ? { label: 'Resolve on Profile', href: `/app/applicant/${applicantId}/profile` }
        : r.state === 'CRITICAL_GAP' || r.state === 'EXPIRING_STALE'
          ? { label: 'Provide Evidence', href: '#evidence' }
          : undefined;
    // Short facts that change what to do stay under the sentence; a finished row folds them away.
    const facts: ReactNode[] = [
      r.provenance && r.provenance !== 'OFFICIAL' ? (
        <p key="provenance">{PROVENANCE_LABELS[r.provenance]}</p>
      ) : null,
      alternatives.length > 0 ? (
        <p key="alternatives">
          {ANY_OF_LABEL}: {[label, ...alternatives].join(' or ')}
        </p>
      ) : null,
      chosen ? <p key="chosen">Chosen document: {chosen.join(', ')}</p> : null,
      r.sourceInaccessible ? (
        <p key="unreachable">
          <span className="badge badge-danger">Source Currently Unreachable - Under Review</span>
        </p>
      ) : null,
    ].filter(Boolean);
    const source =
      sourceLine || sourceHref || citationText ? (
        <p className="lift-check-aside lift-check-source">
          Source{sourceLine || citationText ? `: ${sourceLine || citationText}` : ''}
          {r.observedDate ? ` · reviewed ${formatDateOnly(r.observedDate)}` : ''}
          {sourceHref ? (
            <>
              {' · '}
              <a href={sourceHref} target="_blank" rel="noreferrer">
                View Source
              </a>
            </>
          ) : null}
        </p>
      ) : null;
    const more = (
      <>
        {done ? facts : null}
        {source}
        {bookingReminder ? <p className="lift-check-aside">{bookingReminder}</p> : null}
        {explanations.configured && (r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION') ? (
          <ExplainGapButton
            missionId={missionId}
            packRequirementId={r.packRequirementId}
            explanation={explanations.byRequirement.get(r.packRequirementId) ?? null}
            {...(explanations.off !== undefined ? { off: explanations.off } : {})}
          />
        ) : null}
        <SuggestCorrection
          missionId={missionId}
          packRequirementId={r.packRequirementId}
          itemName={label || 'This Item'}
        />
      </>
    );
    return (
      <ChecklistRow
        key={r.packRequirementId}
        name={label || '(unnamed)'}
        tone={toneOfBadge(meta.tone)}
        status={meta.label}
        necessity={necessity}
        next={meta.next || undefined}
        action={action}
        context={!done && facts.length > 0 ? facts : undefined}
        compact={done}
        more={more}
      />
    );
  };
  const groups = buildChecklistGroups(rows);
  const progress = categoryProgress(rows);
  // UMPE G2 (R02): category headings show only when the checklist gives categories at all.
  const hasCategories = rows.some((r) => r.category !== null);
  const checklistRows = (part: readonly RequirementDetailRow[]) =>
    hasCategories
      ? groupByRequirementCategory(part, (r) => r.category).map((category) => {
          const reached = progress.get(category.category ?? 'other');
          return (
            <div className="case-category" key={category.category ?? 'other'}>
              <div className="lift-category-head">
                <h5 className="case-category-heading">{category.label}</h5>
                {reached ? (
                  <span className="lift-group-count">
                    {reached.onFile} of {reached.total} on file
                  </span>
                ) : null}
              </div>
              {category.rows.map(requirementRow)}
            </div>
          );
        })
      : part.map(requirementRow);
  return (
    <div id="readiness">
      <SectionCard
        heading="Evidence Checklist"
        level={3}
        action={packName ? <span className="lift-card-note">From {packName}</span> : undefined}
      >
        {/* WP-SB2: each group opens and closes; the first one with rows (what is
            missing, when anything is) starts open. Its heading stays a real heading
            inside the opener, so heading navigation still finds every group. */}
        <OpenGroupOnLink scopeId="readiness" />
        <div className="collapsible-groups lift-groups">
          {groups.map((group, index) => (
            <details
              className={`collapsible-group lift-group lift-group-${CHECKLIST_GROUP_TONE[group.key] ?? 'success'}`}
              id={`${CHECKLIST_ID_PREFIX}-${group.key}`}
              key={group.key}
              open={index === 0}
            >
              <summary className="collapsible-group-summary">
                <h4 className="case-group-heading collapsible-group-title">
                  {group.heading}{' '}
                  <span className="muted lift-state-count">{group.rows.length}</span>
                </h4>
              </summary>
              <div className="collapsible-group-body">
                <div className="rows">
                  {checklistRows(group.rows.slice(0, CHECKLIST_ROWS_SHOWN))}
                </div>
                {group.rows.length > CHECKLIST_ROWS_SHOWN ? (
                  <details className="case-checklist-rest">
                    <summary>
                      {plural(group.rows.length - CHECKLIST_ROWS_SHOWN, 'More Item', 'More Items')}
                    </summary>
                    <div className="rows">
                      {checklistRows(group.rows.slice(CHECKLIST_ROWS_SHOWN))}
                    </div>
                  </details>
                ) : null}
              </div>
            </details>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/** Chosen documents that will not last the trip, each with when it expires and what it must cover. */
export function CaseExpiringDocuments({
  documents,
}: {
  readonly documents: readonly ExpiringDocumentRow[];
}) {
  return (
    <section
      className="case-expiring lift-card lift-expiring"
      id="expiring-documents"
      aria-labelledby="case-expiring-heading"
    >
      <h3 id="case-expiring-heading" className="case-checklist-heading lift-card-title">
        Documents That Expire Before Your Trip Ends
      </h3>
      <ul className="case-sources-list lift-expiring-list">
        {documents.map((doc) => (
          <li key={doc.documentId} className="lift-expiring-row">
            <span className="lift-expiring-icon" aria-hidden="true">
              <Icon name="calendar" size={16} />
            </span>
            <span className="lift-expiring-name">{doc.name}</span>
            <span className="muted lift-expiring-dates">
              {' · '}Expires: <strong>{formatDateOnly(doc.expiresAt)}</strong>
              {' · '}Needed Until: <strong>{formatDateOnly(doc.neededUntil)}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The official pages the checklist cites, with when each was last read. */
export function CaseSources({ sources }: { readonly sources: readonly CaseSourceRow[] }) {
  return (
    <section className="case-sources" aria-labelledby="case-sources-heading">
      <h3 id="case-sources-heading" className="case-checklist-heading">
        Sources for This Checklist
      </h3>
      <ul className="case-sources-list">
        {sources.map((source) => (
          <li key={source.href}>
            <a href={source.href} target="_blank" rel="noreferrer">
              {source.name}
            </a>
            <span className="muted u-fs-085">
              {' · '}Checked:{' '}
              {source.checkedAt ? formatDateOnly(source.checkedAt) : 'Not Checked Yet'}
              {' · '}In Effect Since:{' '}
              {source.inEffectSince ? formatDateOnly(source.inEffectSince) : 'Not Stated'}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted u-fs-085">
        Checked is when VisaStack last read the page. Always confirm the final requirements with the
        official authority or your agency.
      </p>
    </section>
  );
}
