import {
  ANY_OF_LABEL,
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  groupByRequirementCategory,
} from '@visastack/core';
import { isFillerCitation, safeHttpUrl } from '@visastack/services';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { atLevel } from '../../../../components/depth';
import { bookingReminderFor } from '../../../../lib/booking-reminder';
import { formatDateOnly } from '../../../../lib/format-date';
import {
  CHECKLIST_ID_PREFIX,
  CHECKLIST_ROWS_SHOWN,
  type CaseSourceRow,
  type ExpiringDocumentRow,
  REQUIREMENT_STATE_META,
  type RequirementDetailRow,
  buildChecklistGroups,
  plural,
  requirementLabel,
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
}

/**
 * The Evidence Checklist: one group per state (Needs You, Needs a Check, Done), each group's first
 * rows shown and the rest folded, with the category headings when the checklist has categories.
 * The anchor `#readiness` points at this block.
 */
export function CaseChecklist({
  missionId,
  applicantId,
  rows,
  chosenByRequirement,
  explanations,
}: CaseChecklistProps) {
  /** One checklist row (WP-SB2 moved it out of the group so a group can show its first rows). */
  const requirementRow = (r: RequirementDetailRow) => {
    const meta = REQUIREMENT_STATE_META[r.state];
    const label = requirementLabel(r);
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
    return (
      <div className="row lift-row-stack" key={r.packRequirementId}>
        <div className="lift-line-between">
          <span className="row-key">
            {label || '(unnamed)'}
            {r.coveredByAlternative
              ? ' · met by an alternative'
              : r.necessity
                ? ` · ${NECESSITY_LABELS[r.necessity]}`
                : r.optional
                  ? ' · optional'
                  : ''}
          </span>
          <span className={`badge ${meta.tone}`}>{meta.label}</span>
        </div>
        {r.provenance && r.provenance !== 'OFFICIAL' ? (
          <span className="muted u-fs-085">{PROVENANCE_LABELS[r.provenance]}</span>
        ) : null}
        {alternatives.length > 0 ? (
          <span className="muted u-fs-085">
            {ANY_OF_LABEL}: {[label, ...alternatives].join(' or ')}
          </span>
        ) : null}
        {meta.next ? (
          <span className="muted u-fs-085">
            {meta.next}
            {r.state === 'CONFLICTING' ? (
              <>
                {' '}
                <Link href={`/app/applicant/${applicantId}/profile`}>Resolve on Profile →</Link>
              </>
            ) : null}
            {r.state === 'CRITICAL_GAP' || r.state === 'EXPIRING_STALE' ? (
              <>
                {' '}
                <a href="#evidence">Provide Evidence ↓</a>
              </>
            ) : null}
          </span>
        ) : null}
        {bookingReminder ? <span className="muted u-fs-085">{bookingReminder}</span> : null}
        {chosenByRequirement[r.packRequirementId] ? (
          <span className="muted u-fs-085">
            Chosen document: {chosenByRequirement[r.packRequirementId]?.join(', ')}
          </span>
        ) : null}
        {sourceLine || sourceHref || citationText ? (
          <span className="muted u-fs-075">
            Source{sourceLine || citationText ? `: ${sourceLine || citationText}` : ''}
            {r.observedDate ? ` · reviewed ${formatDateOnly(r.observedDate)}` : ''}
            {sourceHref ? (
              <>
                {' · '}
                <a href={sourceHref} target="_blank" rel="noreferrer">
                  source
                </a>
              </>
            ) : null}
          </span>
        ) : null}
        {r.sourceInaccessible ? (
          <span className="badge badge-danger lift-self-start">
            Source Currently Unreachable - Under Review
          </span>
        ) : null}
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
      </div>
    );
  };
  const groups = buildChecklistGroups(rows);
  // UMPE G2 (R02): category headings show only when the checklist gives categories at all.
  const hasCategories = rows.some((r) => r.category !== null);
  const checklistRows = (part: readonly RequirementDetailRow[]) =>
    hasCategories
      ? groupByRequirementCategory(part, (r) => r.category).map((category) => (
          <div className="case-category" key={category.category ?? 'other'}>
            <h5 className="case-category-heading">{category.label}</h5>
            {category.rows.map(requirementRow)}
          </div>
        ))
      : part.map(requirementRow);
  return (
    <div id="readiness" {...atLevel('browse')}>
      <h3 className="case-checklist-heading">Evidence Checklist</h3>
      {/* WP-SB2: each group opens and closes; the first one with rows (what is
          missing, when anything is) starts open. Its heading stays a real heading
          inside the opener, so heading navigation still finds every group. */}
      <OpenGroupOnLink scopeId="readiness" />
      <div className="collapsible-groups">
        {groups.map((group, index) => (
          <details
            className="collapsible-group"
            id={`${CHECKLIST_ID_PREFIX}-${group.key}`}
            key={group.key}
            open={index === 0}
          >
            <summary className="collapsible-group-summary">
              <h4 className="case-group-heading collapsible-group-title">
                {group.heading} <span className="muted">{group.rows.length}</span>
              </h4>
            </summary>
            <div className="collapsible-group-body">
              <div className="rows">{checklistRows(group.rows.slice(0, CHECKLIST_ROWS_SHOWN))}</div>
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
      className="case-expiring"
      id="expiring-documents"
      aria-labelledby="case-expiring-heading"
    >
      <h3 id="case-expiring-heading" className="case-checklist-heading">
        Documents That Expire Before Your Trip Ends
      </h3>
      <ul className="case-sources-list">
        {documents.map((doc) => (
          <li key={doc.documentId}>
            {doc.name}
            <span className="muted u-fs-085">
              {' · '}Expires: {formatDateOnly(doc.expiresAt)}
              {' · '}Needed Until: {formatDateOnly(doc.neededUntil)}
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

/** The one-line reminder that readiness is completeness, never a likelihood of approval. */
export function CaseReadinessNote() {
  return (
    <p className="muted lift-small-mt-100">
      Readiness is completeness only - never an approval likelihood.
    </p>
  );
}
