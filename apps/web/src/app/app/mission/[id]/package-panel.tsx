import { NECESSITY_LABELS, PROVENANCE_LABELS } from '@visastack/core';
import {
  type CasePackage,
  type FreshnessCaveat,
  PACKAGE_CHANGE_LABELS,
  PACKAGE_PHRASE_LABELS,
  type PackageAttentionReason,
  type PackageCopy,
  type PackageItem,
  type PackagePhrase,
} from '@visastack/services';
import Link from 'next/link';
import { humanizeCode } from '../../../../lib/format-code';
import { formatTimestampDate } from '../../../../lib/format-date';
import { fieldLabel } from '../../../../lib/master-profile';
import {
  PackageChangeReviewedForm,
  type PackageChoiceOption,
  PackageHandoffForm,
  PackageItemChoiceForm,
} from './package-forms';

/**
 * UMPE P4: the case's trip package. One plain phrase (Needs Attention, Ready for Final Review,
 * Prepared for Handoff) read from the existing readiness, each item with the exact copy it uses
 * or proposes, the one thing that changed, the questions this checklist really needs, the
 * freshness check, the steps outside VisaStack, and the explicit handoff confirmation. Nothing
 * here sends, shares or submits anything.
 */

const PHRASE_TONE: Readonly<Record<PackagePhrase, string>> = {
  NEEDS_ATTENTION: 'badge-warning',
  READY_FOR_FINAL_REVIEW: 'badge-neutral',
  PREPARED_FOR_HANDOFF: 'badge-success',
};

const REASON_WORDS: Readonly<Record<PackageAttentionReason, string>> = {
  NO_CHECKLIST: 'This case has no checklist yet, so we cannot tell what is needed.',
  MANUAL_CHECK: 'This trip is checked by hand. Confirm every item with the official source.',
  REQUIRED_GAP: 'A required item is missing, too old or has a conflict.',
  NEEDS_ANSWER: 'We need an answer from you before we know whether some items apply.',
  PINNED_COPY_UNUSABLE: 'A copy you chose can no longer be used. Choose another one.',
  PINNED_COPY_REPLACED:
    'A newer copy replaced one you chose. Choose which copy to use before you prepare the handoff.',
  CHECKLIST_WITHDRAWN: 'The checklist for this trip was withdrawn.',
  CHECKLIST_REPLACED: 'A newer checklist was published for this trip.',
  SOMETHING_CHANGED: 'Something changed since you last looked. Review it below.',
};

const CAVEAT_WORDS: Readonly<Record<FreshnessCaveat, string>> = {
  CHECKLIST_WITHDRAWN: 'The checklist version used here was withdrawn.',
  CHECKLIST_REPLACED: 'A newer version of this checklist exists.',
  CHECKLIST_REVIEW_OVERDUE: 'This checklist is due for its regular review by our team.',
  SOURCE_UNAVAILABLE: 'An official page behind this checklist could not be reached recently.',
  SOURCE_CHANGING: 'An official page behind this checklist may have changed and is being checked.',
  EVIDENCE_TOO_OLD: 'A chosen document is older than this route allows.',
  SOURCES_NOT_CHECKED: 'Official pages have not been checked for this checklist yet.',
};

function itemName(item: Pick<PackageItem, 'kind' | 'key'>): string {
  return item.kind === 'FIELD'
    ? (fieldLabel(item.key) ?? humanizeCode(item.key))
    : humanizeCode(item.key);
}

function copyName(copy: PackageCopy): string {
  if (copy.kind === 'FIELD') return 'Your Saved Answer';
  const name = copy.displayName ?? 'Document';
  return copy.documentDate ? `${name} (${copy.documentDate})` : name;
}

function optionValue(copy: PackageCopy): string | null {
  if (copy.documentVersionId) return `d:${copy.documentVersionId}`;
  if (copy.factVersionId) return `f:${copy.factVersionId}`;
  return null;
}

function usingLine(item: PackageItem): string {
  const chosen = item.chosen;
  if (chosen?.choice === 'EXCLUDE') return 'Left out of this package by you.';
  if (chosen?.choice === 'LEAVE_MISSING') return 'Left missing for now.';
  if (chosen?.copy) return `Using: ${copyName(chosen.copy)}, chosen by you.`;
  if (item.proposed) return `Suggested: ${copyName(item.proposed)}.`;
  return 'Nothing on file matches yet.';
}

function choiceOptions(item: PackageItem): { options: PackageChoiceOption[]; current: string } {
  const copies: PackageCopy[] = [];
  const seen = new Set<string>();
  for (const copy of [item.chosen?.copy, item.proposed, item.newerCopy, ...item.alternatives]) {
    const value = copy ? optionValue(copy) : null;
    if (!copy || !value || seen.has(value) || !copy.usable) continue;
    seen.add(value);
    copies.push(copy);
  }
  const options = copies.map((copy) => ({
    value: optionValue(copy) as string,
    label: `Use ${copyName(copy)}`,
  }));
  const current =
    item.chosen?.choice === 'LEAVE_MISSING'
      ? 'missing'
      : item.chosen?.choice === 'EXCLUDE'
        ? 'exclude'
        : ((item.chosen?.copy ? optionValue(item.chosen.copy) : null) ??
          (item.proposed ? optionValue(item.proposed) : null) ??
          'missing');
  return { options, current };
}

export function PackagePanel({ pkg }: { readonly pkg: CasePackage }) {
  const items = pkg.items.filter((item) => item.state !== 'NOT_APPLICABLE');
  const editable = pkg.available && pkg.active;
  const caveats = pkg.freshness?.caveats ?? [];
  return (
    <div className="package-panel">
      <h2 className="card-title">Trip Package</h2>
      <p>
        <span className={`badge ${PHRASE_TONE[pkg.phrase]}`}>
          {PACKAGE_PHRASE_LABELS[pkg.phrase]}
        </span>
      </p>
      <p className="muted u-fs-085">
        This shows what you have ready. It is not a submission and nothing is sent until you share
        it yourself.
      </p>
      {pkg.reasons.length > 0 ? (
        <ul className="package-reasons">
          {pkg.reasons.map((reason) => (
            <li key={reason}>{REASON_WORDS[reason]}</li>
          ))}
        </ul>
      ) : null}

      {pkg.change ? (
        <div className="package-change" role="note">
          <p className="u-m-0">{PACKAGE_CHANGE_LABELS[pkg.change.kind]}</p>
          {editable ? <PackageChangeReviewedForm missionId={pkg.missionId} /> : null}
        </div>
      ) : null}

      {pkg.questions.length > 0 ? (
        <section aria-labelledby="package-questions-heading">
          <h3 id="package-questions-heading" className="package-subheading">
            Questions for This Checklist
          </h3>
          <ul>
            {pkg.questions.map((q) =>
              q.kind === 'TRAVEL_DATES' ? (
                <li key="dates">Add your travel dates under Edit Case Details.</li>
              ) : (
                <li key={q.fieldKey ?? ''}>
                  Add and confirm your {itemName({ kind: 'FIELD', key: q.fieldKey ?? '' })} in your
                  profile.
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {items.length > 0 ? (
        <section aria-labelledby="package-items-heading">
          <h3 id="package-items-heading" className="package-subheading">
            What This Package Uses
          </h3>
          <ul className="package-items">
            {items.map((item) => {
              const name = itemName(item);
              const { options, current } = choiceOptions(item);
              return (
                <li key={item.packRequirementId} className="package-item">
                  <p className="u-m-0">
                    <strong>{name}</strong>{' '}
                    <span className="badge badge-neutral">{NECESSITY_LABELS[item.necessity]}</span>
                    {item.provenance !== 'OFFICIAL' ? (
                      <>
                        {' '}
                        <span className="badge badge-neutral">
                          {PROVENANCE_LABELS[item.provenance]}
                        </span>
                      </>
                    ) : null}
                  </p>
                  <p className="muted u-fs-085 u-m-0">{usingLine(item)}</p>
                  {item.newerCopy ? (
                    <p className="u-fs-085 u-m-0">
                      A newer copy is available: {copyName(item.newerCopy)}. Your choice stays as it
                      is until you change it.
                    </p>
                  ) : null}
                  {item.chosen?.copy && !item.chosen.copy.usable ? (
                    <p className="u-fs-085 u-m-0">The chosen copy can no longer be used.</p>
                  ) : null}
                  {editable ? (
                    <PackageItemChoiceForm
                      missionId={pkg.missionId}
                      packRequirementId={item.packRequirementId}
                      itemName={name}
                      options={options}
                      current={current}
                      canExclude={item.canExclude}
                      hasChoice={item.chosen !== null}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {caveats.length > 0 ? (
        <section aria-labelledby="package-freshness-heading">
          <h3 id="package-freshness-heading" className="package-subheading">
            Freshness Check
          </h3>
          <ul>
            {caveats.map((caveat) => (
              <li key={caveat}>{CAVEAT_WORDS[caveat]}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="package-outside-heading">
        <h3 id="package-outside-heading" className="package-subheading">
          Outside VisaStack
        </h3>
        <p className="muted u-fs-085">
          VisaStack does not do these for you. Check the official source for this trip.
        </p>
        <ul>
          {pkg.outsideSteps.map((step) => (
            <li key={step.kind}>{step.label}</li>
          ))}
        </ul>
      </section>

      {pkg.latestHandoff ? (
        <p className="muted u-fs-085">
          {pkg.latestHandoff.current
            ? `Prepared for Handoff on ${formatTimestampDate(pkg.latestHandoff.confirmedAt)}.`
            : `Prepared for Handoff on ${formatTimestampDate(pkg.latestHandoff.confirmedAt)}, before a later change. That record is kept as it was.`}
        </p>
      ) : null}
      <p className="muted u-fs-085">
        Travelling with others? <Link href="/app/mission/start">Start a Trip</Link> gives each
        traveller their own case.
      </p>
      {editable && pkg.phrase === 'READY_FOR_FINAL_REVIEW' ? (
        <PackageHandoffForm missionId={pkg.missionId} />
      ) : null}
    </div>
  );
}
