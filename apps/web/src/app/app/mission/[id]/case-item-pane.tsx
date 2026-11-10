import { ANY_OF_LABEL } from '@visastack/core';
import { isFillerCitation, safeHttpUrl } from '@visastack/services';
import type { PackageItem } from '@visastack/services';
import { StatusPill } from '../../../../components/ui-lift/status-pill';
import { bookingReminderFor } from '../../../../lib/booking-reminder';
import { formatDateOnly } from '../../../../lib/format-date';
import { provenanceLine } from '../../../../lib/pack-labels';
import type { ChecklistExplanations } from './case-checklist';
import { itemAction, itemAlternatives, itemNecessity, itemStatus } from './case-item-view';
import {
  REQUIREMENT_STATE_META,
  type RequirementDetailRow,
  officialLabel,
  requirementLabel,
} from './case-model';
import { type CandidateView, EvidenceItemChoices } from './collaboration-panels';
import { hasSeveralToChoose } from './evidence-several';
import { PackageItemChoiceForm } from './package-forms';
import { choiceOptions, copyName, usingLine } from './package-item-model';
import { ExplainGapButton } from './readiness-gap-explain';
import { SuggestCorrection } from './suggest-correction';
import { WordingEditor } from './wording-editor';

/** The chosen files or answers in plain words, for a case that is closed. */
function chosenNames(c: CandidateView): string {
  const names = [
    ...c.documentCandidates
      .filter((d) => c.selectedDocumentIds.includes(d.documentId))
      .map((d) => d.displayName),
    ...c.factCandidates
      .filter((f) => c.selectedFactIds.includes(f.factId))
      .map((f) => f.value ?? ''),
  ].filter(Boolean);
  return names.length > 0
    ? `Chosen: ${names.join(', ')}`
    : 'None chosen. Any eligible one counted.';
}

export interface CaseItemPaneProps {
  readonly missionId: string;
  readonly applicantId: string;
  readonly row: RequirementDetailRow;
  /** Every row of the checklist, to name the alternatives. */
  readonly rows: readonly RequirementDetailRow[];
  /** The chosen document names for this item. */
  readonly chosen: readonly string[] | undefined;
  /** How the document must be provided (format rules), when the checklist states any. */
  readonly formatLines: readonly string[] | undefined;
  /** The files and answers on file for this item, when the case has read them. */
  readonly candidate: CandidateView | undefined;
  /** The case is open, so the choice of which file counts can still change (the same open-case rule as the wording). */
  readonly evidenceEditable: boolean;
  /** The package item for this row, when the case has a package. */
  readonly packageItem: PackageItem | undefined;
  /** The traveller may still change what the package uses: the package is open. */
  readonly packageEditable: boolean;
  readonly explanations: ChecklistExplanations;
  readonly wordingEditable: boolean;
  readonly wordingMax: number;
  readonly selfReviewed: boolean;
}

/**
 * Everything about one checklist item, in the panel its row opens: the full sentence, who it is
 * for, where the rule comes from, how to provide it, which file it uses (and the choice of file for
 * the handoff package), and the item's own actions. The same forms the page always had, moved here
 * from under each row, so a row can stay one line.
 */
export function CaseItemPane({
  missionId,
  applicantId,
  row: r,
  rows,
  chosen,
  formatLines,
  candidate,
  evidenceEditable,
  packageItem,
  packageEditable,
  explanations,
  wordingEditable,
  wordingMax,
  selfReviewed,
}: CaseItemPaneProps) {
  const meta = REQUIREMENT_STATE_META[r.state];
  const status = itemStatus(r);
  const label = requirementLabel(r);
  const officialName = officialLabel(r);
  const necessity = itemNecessity(r);
  const action = itemAction(r, applicantId);
  const alternatives = itemAlternatives(r, rows);
  const provenance = provenanceLine(r.provenance, {
    starter: r.fromStarter === true,
    selfReviewed,
  });
  const sourceLine = [r.publisher, r.sourceTitle].filter(Boolean).join(' · ');
  const sourceHref = safeHttpUrl(r.sourceUrl);
  // A citation that only fills the box ("Yes", "n/a") is not a source, so it is not shown as one.
  const citationText = r.citation && !isFillerCitation(r.citation) ? r.citation : '';
  const bookingReminder =
    r.state === 'CRITICAL_GAP' || r.state === 'ATTENTION'
      ? bookingReminderFor(r.kind, r.key)
      : null;
  const choice = packageItem && packageEditable ? choiceOptions(packageItem) : null;
  return (
    <div className="lp-pane-content">
      <h3 className="lp-pane-title">{label || '(unnamed)'}</h3>
      <p className="lp-pane-line">
        <StatusPill tone={status.tone} size="md">
          {status.word}
        </StatusPill>
        {necessity ? <span className="lift-check-tag">{necessity}</span> : null}
      </p>
      {meta.next ? <p className="lift-check-next">{meta.next}</p> : null}
      {r.myWording ? <p className="lift-check-aside">Original: {officialName}</p> : null}
      {r.myWording ? <p>Your Wording</p> : null}
      {provenance ? <p>{provenance}</p> : null}
      {r.appliesWhen && r.appliesWhen.toLowerCase() !== 'all applicants' ? (
        <p>For: {r.appliesWhen}</p>
      ) : null}
      {alternatives.length > 0 ? (
        <p>
          {ANY_OF_LABEL}: {[label, ...alternatives].join(' or ')}
        </p>
      ) : null}
      {chosen && chosen.length > 0 ? <p>Chosen document: {chosen.join(', ')}</p> : null}
      {formatLines && formatLines.length > 0 ? (
        <p className="package-item-format">How to Provide It: {formatLines.join(' · ')}</p>
      ) : null}
      {r.sourceInaccessible ? (
        <p>
          <span className="badge badge-danger">Source Currently Unreachable - Under Review</span>
        </p>
      ) : null}
      {sourceLine || sourceHref || citationText ? (
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
      ) : null}
      {bookingReminder ? <p className="lift-check-aside">{bookingReminder}</p> : null}

      {action || r.state === 'CRITICAL_GAP' || r.state === 'EXPIRING_STALE' ? (
        <div className="lp-pane-actions">
          {action ? (
            <a className="btn btn-secondary" href={action.href}>
              {action.label}
            </a>
          ) : null}
          {r.state === 'CRITICAL_GAP' || r.state === 'EXPIRING_STALE' ? (
            <a className="btn btn-secondary" href="#evidence">
              Provide Evidence
            </a>
          ) : null}
        </div>
      ) : null}

      {candidate && hasSeveralToChoose(candidate) ? (
        <section className="lp-pane-section" aria-label="Which File Counts">
          <h4 className="package-subheading">Which File Counts</h4>
          {evidenceEditable ? (
            <>
              <p className="muted u-fs-085 u-m-0">
                Several are on file. Until you pick one, any eligible one may count toward
                readiness.
              </p>
              <EvidenceItemChoices missionId={missionId} candidate={candidate} />
            </>
          ) : (
            <p className="u-fs-085 u-m-0">{chosenNames(candidate)}</p>
          )}
        </section>
      ) : null}

      {packageItem ? (
        <section className="lp-pane-section" aria-label="Which File Goes in the Handoff">
          <h4 className="package-subheading">Which File Goes in the Handoff</h4>
          <p className="muted u-fs-085 u-m-0">{usingLine(packageItem)}</p>
          {packageItem.newerCopy ? (
            <p className="u-fs-085 u-m-0">
              A newer copy is available: {copyName(packageItem.newerCopy)}. Your choice stays as it
              is until you change it.
            </p>
          ) : null}
          {packageItem.chosen?.copy && !packageItem.chosen.copy.usable ? (
            <p className="u-fs-085 u-m-0">The chosen copy can no longer be used.</p>
          ) : null}
          {choice ? (
            <PackageItemChoiceForm
              missionId={missionId}
              packRequirementId={packageItem.packRequirementId}
              itemName={label}
              options={choice.options}
              current={choice.current}
              canExclude={packageItem.canExclude}
              hasChoice={packageItem.chosen !== null}
            />
          ) : null}
        </section>
      ) : null}

      <div className="lp-pane-tools">
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
          itemName={officialName || 'This Item'}
        />
        {wordingEditable ? (
          <WordingEditor
            missionId={missionId}
            packRequirementId={r.packRequirementId}
            itemName={officialName}
            original={officialName}
            current={r.myWording ?? ''}
            maxLength={wordingMax}
          />
        ) : null}
      </div>
    </div>
  );
}
