'use client';

import { useActionState, useEffect, useRef } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { Icon } from '../../../../../components/icons';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { withArticle } from '../../../../../lib/indefinite-article';
import { type RelationDecisionState, needsDecisionAction } from './needs-decision-actions';

/** One file needing one decision, as the documents page passes it (UMPE P3). */
export type NeedsDecisionItem =
  | {
      readonly kind: 'relation';
      readonly proposalId: string;
      readonly documentId: string;
      readonly title: string;
      readonly relatedDocumentId: string;
      readonly relatedTitle: string;
      readonly relation: 'EXACT_DUPLICATE' | 'CORRECTED_SCAN' | 'NEW_PERIOD' | 'RENEWED';
      readonly labels: { readonly newDocument: string; readonly relatedDocument: string };
    }
  | {
      readonly kind: 'unknown_type' | 'low_confidence';
      readonly documentId: string;
      readonly title: string;
    }
  /** UMPE G1: a kind the AI suggested in the background, waiting for the person. */
  | {
      readonly kind: 'suggested_kind';
      readonly documentId: string;
      readonly title: string;
      readonly suggestedLabel: string;
    }
  /** UMPE G1: found when the file was read. */
  | {
      readonly kind: 'expired_on_arrival' | 'no_readable_text';
      readonly exceptionId: string;
      readonly documentId: string;
      readonly title: string;
    };

/** UMPE G1: a file from a family batch waiting for Which Person? (private to this account). */
export interface HeldFileItem {
  readonly holdId: string;
  /** The file's own name, or null when it gave none. */
  readonly fileName: string | null;
  readonly basis: 'NAME_AND_BIRTH_DATE' | 'CLOSE_MATCHES' | 'NO_MATCH' | 'NOT_READ';
  readonly proposedApplicantId: string | null;
  /**
   * The one person the file's own name points to, when reading named nobody. A suggestion the
   * person confirms with one tap; nothing is filed from it.
   */
  readonly nameSuggestionApplicantId?: string | null;
  /** When it was added, already written for people ("3 Nov 2026"). */
  readonly addedOn: string;
}

/** UMPE G4: something placed automatically, listed with its one-step Change for 30 days. */
export interface AutoPlacementItem {
  readonly placementId: string;
  readonly documentId: string;
  readonly placement: 'KIND' | 'PERSON';
  readonly title: string;
  /** The kind applied, for a recognised kind. */
  readonly kindLabel: string | null;
}

export interface PersonChoice {
  readonly applicantId: string;
  readonly displayName: string;
}

export interface LinkedCopy {
  readonly documentId: string;
  readonly title: string;
  readonly relatedDocumentId: string;
  readonly relatedTitle: string;
  readonly labels: { readonly newDocument: string; readonly relatedDocument: string };
}

const INITIAL: RelationDecisionState = { ok: true, message: '' };

/** What the suggestion says, in plain words. */
function relationLine(item: Extract<NeedsDecisionItem, { kind: 'relation' }>): string {
  switch (item.relation) {
    case 'EXACT_DUPLICATE':
      return `${item.title} is the same file as ${item.relatedTitle}.`;
    case 'CORRECTED_SCAN':
      return `${item.title} looks like a new copy of ${item.relatedTitle}.`;
    case 'RENEWED':
      return `${item.title} looks like a renewal of ${item.relatedTitle}.`;
    case 'NEW_PERIOD':
      return `${item.title} looks like another period of ${item.relatedTitle}.`;
  }
}

/** What Confirm will do, so nobody has to guess. */
function confirmLine(item: Extract<NeedsDecisionItem, { kind: 'relation' }>): string {
  if (item.relation === 'EXACT_DUPLICATE') {
    return 'Confirm only notes that they are the same. Both files are kept.';
  }
  if (item.relation === 'NEW_PERIOD') {
    return 'Confirm links them as statements for different periods. Both stay in use.';
  }
  return 'Confirm keeps both files and marks the older one as the Earlier Copy.';
}

/** Confirm or Keep Separate for one suggested link between two files. */
export function RelationDecisionForm({
  applicantId,
  proposalId,
  title,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly proposalId: string;
  /** The new file's name, so each button says which file it is about. */
  readonly title: string;
  /** The list's own action, so its answer outlives this form (the item goes once decided). */
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const t = useT(appApplicantCatalog);
  return (
    <form action={action} className="umpe-p3-decision-form">
      <input type="hidden" name="intent" value="relation" />
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          name="decision"
          value="CONFIRM"
          idle="Confirm"
          busy="Saving"
          label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.confirmTitle', { title })}
          className="btn btn-primary"
        />
        <SubmitButton
          pending={pending}
          name="decision"
          value="KEEP_SEPARATE"
          idle="Keep Separate"
          busy="Saving"
          label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.keepSeparateTitle', {
            title,
          })}
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}

/** The link to one document's own card, where its kind or details are decided. */
function documentHref(applicantId: string, documentId: string): string {
  return `/app/applicant/${applicantId}/documents?document=${documentId}#wallet-selected-document`;
}

/** UMPE G4: Change for one automatic placement; one step puts the file back as it was. */
function ChangePlacementForm({
  applicantId,
  item,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly item: AutoPlacementItem;
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const t = useT(appApplicantCatalog);
  return (
    <form action={action} className="umpe-p3-decision-form">
      <input
        type="hidden"
        name="intent"
        value={item.placement === 'KIND' ? 'change-kind' : 'change-person'}
      />
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="placementId" value={item.placementId} />
      <input type="hidden" name="documentId" value={item.documentId} />
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          idle="Change"
          busy="Changing"
          label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.changeTitle', {
            title: item.title,
          })}
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}

/** One line for an automatic placement, in plain words. */
function placementLine(item: AutoPlacementItem, personName: string): string {
  if (item.placement === 'PERSON') {
    return `${item.title} matched ${personName} by name and date of birth, so we filed it for you.`;
  }
  return `We recognised ${item.title} as ${withArticle(item.kindLabel ?? 'Document')} and filed it.`;
}

/** Keep As It Is for one finding raised when a file was read (UMPE G1). */
function KeepForm({
  applicantId,
  exceptionId,
  title,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly exceptionId: string;
  readonly title: string;
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const t = useT(appApplicantCatalog);
  return (
    <form action={action} className="umpe-p3-decision-form">
      <input type="hidden" name="intent" value="keep" />
      <input type="hidden" name="applicantId" value={applicantId} />
      <input type="hidden" name="exceptionId" value={exceptionId} />
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          idle="Keep As It Is"
          busy="Saving"
          label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.keepAsItIsTitle', { title })}
          className="btn btn-secondary"
        />
      </div>
    </form>
  );
}

/** What we could tell about who a held file belongs to, in plain words. */
function basisLine(file: HeldFileItem, people: readonly PersonChoice[]): string {
  const proposed = people.find((person) => person.applicantId === file.proposedApplicantId);
  if (file.basis === 'NAME_AND_BIRTH_DATE' && proposed) {
    return `The name and date of birth in this file match ${proposed.displayName}. Check before you file it.`;
  }
  const named = people.find((person) => person.applicantId === file.nameSuggestionApplicantId);
  if (named && !proposed) {
    return `The file name says ${named.displayName}, so we think this is theirs. Check before you file it.`;
  }
  if (file.basis === 'NAME_AND_BIRTH_DATE') {
    // UMPE G4: filed automatically and moved back by the person, so nobody is chosen for them.
    return 'Choose who this file belongs to.';
  }
  if (file.basis === 'CLOSE_MATCHES') {
    return 'This file could belong to more than one of your people, so we did not choose for you.';
  }
  if (file.basis === 'NO_MATCH') {
    return 'We read this file, but it does not match any of your people by name and date of birth.';
  }
  return 'We have not read anything from this file, so we cannot tell who it belongs to.';
}

/**
 * Which Person? for one held file (UMPE G1): choose a person and File It, or Remove This File.
 * The suggested person, when there is exactly one, is chosen to start with; nothing is filed until
 * the button is pressed.
 */
function WhichPersonForm({
  applicantId,
  file,
  people,
  action,
  pending,
}: {
  readonly applicantId: string;
  readonly file: HeldFileItem;
  readonly people: readonly PersonChoice[];
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
}) {
  const t = useT(appApplicantCatalog);
  const label = file.fileName ?? `File Added ${file.addedOn}`;
  const groupId = `which-person-${file.holdId}`;
  const suggestedId = file.proposedApplicantId ?? file.nameSuggestionApplicantId ?? null;
  const suggested = people.find((person) => person.applicantId === suggestedId);
  const choices = (
    <>
      <fieldset className="umpe-g1-person-choices" aria-describedby={`${groupId}-basis`}>
        <legend>
          {t('appApplicant.appApplicantIdDocumentsNeedsDecision.whichPersonIsLabelFor', { label })}
        </legend>
        {suggested ? null : (
          <p className="muted" id={`${groupId}-basis`}>
            {basisLine(file, people)}
          </p>
        )}
        {people.map((person) => (
          <label key={person.applicantId} className="umpe-g1-person-choice">
            <input type="radio" name="personId" value={person.applicantId} />
            <span>{person.displayName}</span>
          </label>
        ))}
      </fieldset>
      <div className="umpe-p3-decision-actions">
        <SubmitButton
          pending={pending}
          name="intent"
          value="file"
          idle="File It"
          busy="Saving"
          label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.fileItLabel', { label })}
          className="btn btn-primary"
        />
        <SubmitButton
          pending={pending}
          name="intent"
          value="discard"
          idle="Remove This File"
          busy="Saving"
          label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.removeThisFileLabel', {
            label,
          })}
          className="btn btn-secondary"
        />
      </div>
    </>
  );
  if (!suggested) {
    return (
      <form action={action} className="umpe-g1-person-form">
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="holdId" value={file.holdId} />
        {choices}
      </form>
    );
  }
  // One tap: the suggested person is filed with one button; everyone else is behind one quiet line.
  return (
    <div className="umpe-g1-person-form">
      <p>
        <strong>{label}</strong>
      </p>
      <p className="muted" id={`${groupId}-basis`}>
        {basisLine(file, people)}
      </p>
      <form action={action}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="holdId" value={file.holdId} />
        <input type="hidden" name="personId" value={suggested.applicantId} />
        <div className="umpe-p3-decision-actions">
          <SubmitButton
            pending={pending}
            name="intent"
            value="file"
            idle={`File Under ${suggested.displayName}`}
            busy="Saving"
            label={t(
              'appApplicant.appApplicantIdDocumentsNeedsDecision.fileUnderDisplaynameLabel',
              { displayName: suggested.displayName, label },
            )}
            className="btn btn-primary"
          />
          <SubmitButton
            pending={pending}
            name="intent"
            value="discard"
            idle="Remove This File"
            busy="Saving"
            label={t('appApplicant.appApplicantIdDocumentsNeedsDecision.removeThisFileLabel', {
              label,
            })}
            className="btn btn-secondary"
          />
        </div>
      </form>
      <details className="add-more">
        <summary className="add-more-summary">
          {t('appApplicant.appApplicantIdDocumentsNeedsDecision.chooseSomeoneElse')}
        </summary>
        <form action={action} className="umpe-g1-person-form">
          <input type="hidden" name="applicantId" value={applicantId} />
          <input type="hidden" name="holdId" value={file.holdId} />
          {choices}
        </form>
      </details>
    </div>
  );
}

/**
 * The person's files that need one decision (ledger I07, I11), and the files already linked.
 * Routine files never appear here. The answer to a decision is shown for the whole list, so it
 * stays on screen (and is announced, with focus moved to it) after the decided item goes.
 * Renders nothing when there is nothing to decide, show or report.
 */
export function NeedsDecision({
  applicantId,
  items,
  linked,
  held = [],
  people = [],
  automatic = [],
  personName = '',
}: {
  readonly applicantId: string;
  readonly items: readonly NeedsDecisionItem[];
  readonly linked: readonly LinkedCopy[];
  /** UMPE G1: this account's files waiting for Which Person?. */
  readonly held?: readonly HeldFileItem[];
  /** UMPE G1: the account's own people, to choose from. */
  readonly people?: readonly PersonChoice[];
  /** UMPE G4: what was placed automatically for this person recently, each with its Change. */
  readonly automatic?: readonly AutoPlacementItem[];
  /** UMPE G4: this person's name, for Filed Under. */
  readonly personName?: string;
}) {
  const t = useT(appApplicantCatalog);
  const [state, formAction, pending] = useActionState(needsDecisionAction, INITIAL);
  const statusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.message) statusRef.current?.focus();
  }, [state]);
  const grouped = {
    unknown: items.filter((item) => item.kind === 'unknown_type'),
    unsure: items.filter((item) => item.kind === 'low_confidence'),
    suggested: items.filter((item) => item.kind === 'suggested_kind'),
    others: items.filter(
      (item) =>
        item.kind === 'relation' ||
        item.kind === 'expired_on_arrival' ||
        item.kind === 'no_readable_text',
    ),
  };
  const deciding = items.length > 0 || held.length > 0 || Boolean(state.message);
  if (!deciding && linked.length === 0 && automatic.length === 0) return null;
  return (
    <>
      {deciding ? (
        <section className="card u-mb-150 umpe-p3-needs-decision" aria-labelledby="needs-decision">
          <h2 className="card-title" id="needs-decision">
            {t('appApplicant.appApplicantIdDocumentsNeedsDecision.needsOneDecision')}
          </h2>
          <div ref={statusRef} tabIndex={-1} className="umpe-p3-decision-status">
            <FormMessage result={state} />
          </div>
          {held.length > 0 ? (
            <>
              <h3 className="umpe-p3-linked-title">
                {t('appApplicant.appApplicantIdDocumentsNeedsDecision.whichPerson')}
              </h3>
              <ul className="umpe-p3-decision-list">
                {held.map((file) => (
                  <li key={file.holdId} className="umpe-p3-decision-item">
                    <WhichPersonForm
                      applicantId={applicantId}
                      file={file}
                      people={people}
                      action={formAction}
                      pending={pending}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <ChooseGroup
            applicantId={applicantId}
            heading={['We Could Not Tell What This Is', 'We Could Not Tell What These Are']}
            items={grouped.unknown}
          />
          <ChooseGroup
            applicantId={applicantId}
            heading={['We Are Not Sure What This Is', 'We Are Not Sure What These Are']}
            items={grouped.unsure}
          />
          <ChooseGroup
            applicantId={applicantId}
            heading={['Check This Suggestion', 'Check These Suggestions']}
            items={grouped.suggested}
          />
          {grouped.others.length > 0 ? (
            <ul className="umpe-p3-decision-list">
              {grouped.others.map((item) =>
                item.kind === 'relation' ? (
                  <li key={item.proposalId} className="umpe-p3-decision-item">
                    <p className="umpe-p3-decision-badges">
                      <span className="badge badge-neutral">{item.labels.newDocument}</span>
                    </p>
                    <p>{relationLine(item)}</p>
                    <details className="docs-more">
                      <summary>
                        {t('appApplicant.appApplicantIdDocumentsAddPage.whatHappensNext')}
                      </summary>
                      <p className="muted">{confirmLine(item)}</p>
                    </details>
                    <RelationDecisionForm
                      applicantId={applicantId}
                      proposalId={item.proposalId}
                      title={item.title}
                      action={formAction}
                      pending={pending}
                    />
                  </li>
                ) : item.kind === 'expired_on_arrival' || item.kind === 'no_readable_text' ? (
                  <li key={item.exceptionId} className="umpe-p3-decision-item">
                    <p>
                      {item.kind === 'expired_on_arrival'
                        ? t(
                            'appApplicant.appApplicantIdDocumentsNeedsDecision.titleHadAlreadyExpiredOnThe',
                            { title: item.title },
                          )
                        : t(
                            'appApplicant.appApplicantIdDocumentsNeedsDecision.weCouldNotFindAnyReadable',
                            { title: item.title },
                          )}
                    </p>
                    <details className="docs-more">
                      <summary>
                        {t('appApplicant.appApplicantIdDocumentsNeedsDecision.whatYouCanDo')}
                      </summary>
                      <p className="muted">
                        {item.kind === 'expired_on_arrival'
                          ? t(
                              'appApplicant.appApplicantIdDocumentsNeedsDecision.addANewerCopyIfYou',
                            )
                          : t(
                              'appApplicant.appApplicantIdDocumentsNeedsDecision.addAClearerCopyIfYou',
                            )}
                      </p>
                    </details>
                    <div className="umpe-p3-decision-actions">
                      <a
                        className="btn btn-secondary"
                        href={documentHref(applicantId, item.documentId)}
                        aria-label={t(
                          'appApplicant.appApplicantIdDocumentsNeedsDecision.openDocumentTitle',
                          { title: item.title },
                        )}
                      >
                        {t('appApplicant.appApplicantIdDocumentsNeedsDecision.openDocument')}
                      </a>
                    </div>
                    <KeepForm
                      applicantId={applicantId}
                      exceptionId={item.exceptionId}
                      title={item.title}
                      action={formAction}
                      pending={pending}
                    />
                  </li>
                ) : null,
              )}
            </ul>
          ) : null}
          {items.length > 0 || held.length > 0 ? (
            <details className="docs-more docs-decision-about">
              <summary>
                {t('appApplicant.appApplicantIdDocumentsNeedsDecision.aboutTheseChoices')}
              </summary>
              {items.length > 0 ? (
                <p className="card-body">
                  {t('appApplicant.appApplicantIdDocumentsNeedsDecision.mostFilesAreSortedOnTheir')}
                </p>
              ) : null}
              {grouped.suggested.length > 0 ? (
                <p className="card-body">
                  {t('appApplicant.appApplicantIdDocumentsNeedsDecision.aSuggestionIsOnlyAGuess')}
                </p>
              ) : null}
              {held.length > 0 ? (
                <p className="card-body">
                  {t(
                    'appApplicant.appApplicantIdDocumentsNeedsDecision.theseFilesWereAddedForSeveral',
                  )}
                </p>
              ) : null}
            </details>
          ) : null}
        </section>
      ) : null}
      {automatic.length > 0 ? (
        <details className="card u-mb-150 docs-sorted">
          <summary className="docs-sorted-summary">
            <h2 className="docs-sorted-title">
              {t('appApplicant.appApplicantIdDocumentsNeedsDecision.sortedForYou')}{' '}
              <span className="docs-count">({automatic.length})</span>
            </h2>
          </summary>
          <p className="card-body">
            {t('appApplicant.appApplicantIdDocumentsNeedsDecision.theseWereSortedForYouIf')}
          </p>
          <ul className="umpe-p3-decision-list">
            {automatic.map((item) => (
              <li key={item.placementId} className="umpe-p3-decision-item">
                <p className="umpe-p3-decision-badges">
                  <span className="badge badge-neutral">
                    {item.placement === 'KIND'
                      ? t(
                          'appApplicant.appApplicantIdDocumentsNeedsDecision.recognisedAutomatically',
                        )
                      : t(
                          'appApplicant.appApplicantIdDocumentsNeedsDecision.filedUnderPersonname',
                          { personName },
                        )}
                  </span>
                </p>
                <p>{placementLine(item, personName)}</p>
                <ChangePlacementForm
                  applicantId={applicantId}
                  item={item}
                  action={formAction}
                  pending={pending}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {linked.length > 0 ? (
        <section className="card u-mb-150" aria-labelledby="linked-copies">
          <h2 className="docs-sorted-title" id="linked-copies">
            {t('appApplicant.appApplicantIdDocumentsNeedsDecision.linkedCopies')}
          </h2>
          <ul className="umpe-p3-linked-list">
            {linked.map((link) => (
              <li key={`${link.documentId}-${link.relatedDocumentId}`}>
                {link.title}: <span className="badge badge-neutral">{link.labels.newDocument}</span>
                {' · '}
                {link.relatedTitle}:{' '}
                <span className="badge badge-neutral">{link.labels.relatedDocument}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * Files that share one question ("we could not tell what this is"), as one short list: a file
 * icon, the file's name, and one button each. The question is said once, in the heading.
 */
function ChooseGroup({
  applicantId,
  heading,
  items,
}: {
  readonly applicantId: string;
  /** The heading for one file and for several. */
  readonly heading: readonly [string, string];
  readonly items: readonly NeedsDecisionItem[];
}) {
  const t = useT(appApplicantCatalog);
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="umpe-p3-linked-title">{items.length === 1 ? heading[0] : heading[1]}</h3>
      <ul className="docs-choose-list">
        {items.map((item) => {
          if (
            item.kind !== 'unknown_type' &&
            item.kind !== 'low_confidence' &&
            item.kind !== 'suggested_kind'
          ) {
            return null;
          }
          const label = item.kind === 'suggested_kind' ? 'Review Suggestion' : 'Choose What It Is';
          return (
            <li key={item.documentId} className="docs-choose-row">
              <span className="docs-choose-icon" aria-hidden="true">
                <Icon name="file" size={18} />
              </span>
              <span className="docs-choose-name" data-value="name">
                {item.title}
              </span>
              {item.kind === 'suggested_kind' ? (
                <span className="docs-choose-kind" data-value="kind">
                  {t('appApplicant.appApplicantIdDocumentsNeedsDecision.looksLikeWitharticle', {
                    withArticle: withArticle(item.suggestedLabel),
                  })}
                </span>
              ) : null}
              <a
                className="btn btn-secondary u-btn-xs"
                href={documentHref(applicantId, item.documentId)}
                aria-label={`${label}: ${item.title}`}
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}
