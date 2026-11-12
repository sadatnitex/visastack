'use client';

import type { PermissionAction } from '@visastack/core';
import { useRouter } from 'next/navigation';
import { Fragment, useActionState, useEffect, useRef, useState } from 'react';
import { FormMessage, NO_RESULT, SubmitButton } from '../../../../../components/form-feedback';
import { useT } from '../../../../../components/i18n-provider';
import { InvitationLink } from '../../../../../components/invitation-link';
import { ReceiptCard } from '../../../../../components/receipt-card';
import {
  SelectedScopeSummary,
  describeGrantScope,
} from '../../../../../components/selected-scope-summary';
import { applicantSharingCatalog } from '../../../../../i18n/applicant-sharing';
import { PERMISSION_ACTION_LABELS } from '../../../../../lib/labels';
import { permissionPhrase } from '../../../../../lib/permission-phrases';
import { PACK_LABELS, PACK_ORDER } from '../../../../../lib/profile-fields';
import { SHARE_CREATED_LINE } from '../../../../../lib/success-lines';
import { type ActionState, createGrantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** The receipt's line for a request to someone who already has an account. */
const DIRECT_RECEIPT_LINE = SHARE_CREATED_LINE.replace(/^Shared\.\s*/, '');

/** Every grant ends; with no days given the service applies its 30-day default. */
const DEFAULT_EXPIRY_DAYS = 30;
const END_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Curated, launch-safe permission set (read + collaborate; no original download / manage).
 * Names come from the one permission table (`lib/labels.ts`). A `note` is shown under its
 * box, outside the label, and tied to it with `aria-describedby`, so it is read once.
 */
const SHAREABLE_ACTIONS: ReadonlyArray<{
  value: PermissionAction;
  label: string;
  defaultOn?: boolean;
  note?: string;
}> = (
  [
    { value: 'VIEW_METADATA', defaultOn: true },
    { value: 'PREVIEW', defaultOn: true },
    {
      value: 'DOWNLOAD_REDACTED',
      note: 'Visa photo sizes, and safe copies of documents you prepare',
    },
    { value: 'COMMENT' },
    { value: 'PROPOSE_EDIT' },
  ] as const
).map((action) => ({ ...action, label: PERMISSION_ACTION_LABELS[action.value] }));

/**
 * Common reasons to share, offered as one-tap fills for the Purpose box (friction F8). Tapping one
 * only writes its words into the box; the box stays editable and required, and the server checks
 * the purpose exactly as before. The button names are Title Case; the filled words read as a sentence.
 */
const PURPOSE_SUGGESTIONS: ReadonlyArray<{ readonly name: string; readonly purpose: string }> = [
  { name: 'Review My Documents', purpose: 'Review my documents' },
  { name: 'Help with My Visa Form', purpose: 'Help with my visa form' },
  { name: 'Check My Bank Statements', purpose: 'Check my bank statements' },
];

function toggled(current: readonly string[], value: string, on: boolean): string[] {
  return on ? [...current, value] : current.filter((v) => v !== value);
}

export function GrantForm({
  applicantId,
  documents,
  extraCategories = [],
  unsortedDocuments = 0,
  initialDocumentId,
}: {
  readonly applicantId: string;
  readonly documents: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  /** New categories that already hold a saved detail, so only categories with something in them are offered. */
  readonly extraCategories?: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  /** Documents with no kind set. They belong to no category, so choosing parts of the profile leaves them out. */
  readonly unsortedDocuments?: number;
  /**
   * A document chosen before arriving, from Share on the Record (WP-V3 part 2). It only starts the
   * form on "Only the documents I choose" with that one ticked; the person still reviews and
   * confirms, and the server checks the scope as it always does.
   */
  readonly initialDocumentId?: string;
}) {
  const t = useT(applicantSharingCatalog);
  const preselected = documents.some((document) => document.id === initialDocumentId)
    ? initialDocumentId
    : undefined;
  const [state, formAction, pending] = useActionState(createGrantAction, INITIAL);
  const router = useRouter();
  const invitationUrl = state.ok ? state.invitationUrl : undefined;
  useEffect(() => {
    if (invitationUrl) router.refresh();
  }, [invitationUrl, router]);
  // The receipt (F2): built only from what the action returned plus the moment it came back and
  // the address typed. It is set in the same render the result arrives in (no flash of the old
  // line), closed with Done and replaced by the next result.
  const [receipt, setReceipt] = useState<{
    readonly at: number;
    readonly to: string;
    readonly invited: boolean;
  } | null>(null);
  const [lastResult, setLastResult] = useState<ActionState>(INITIAL);

  // Native fields remain the server action's source of truth. Review is an
  // explicit confirmation of their current scope, invalidated by any edit.
  const form = useRef<HTMLFormElement>(null);
  const review = useRef<HTMLDivElement>(null);
  const [reviewed, setReviewed] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  if (state !== lastResult) {
    setLastResult(state);
    setReceipt(
      state.ok && state.message !== ''
        ? { at: Date.now(), to: recipientEmail, invited: Boolean(state.invitationUrl) }
        : null,
    );
  }
  const [purpose, setPurpose] = useState('');
  const [actions, setActions] = useState<readonly string[]>(
    SHAREABLE_ACTIONS.filter((a) => a.defaultOn).map((a) => a.value),
  );
  const [categories, setCategories] = useState<readonly string[]>([]);
  /** Sharing everything is a visible choice, never what happens because nothing was ticked. */
  const [profileScope, setProfileScope] = useState<'all' | 'some'>('all');
  const [documentScope, setDocumentScope] = useState<'all' | 'some'>(preselected ? 'some' : 'all');
  const [selectedDocuments, setSelectedDocuments] = useState<readonly string[]>(
    preselected ? [preselected] : [],
  );
  const [expiryDays, setExpiryDays] = useState('');

  const categoryLabels = categories.map(
    (c) =>
      PACK_LABELS[c as keyof typeof PACK_LABELS] ??
      extraCategories.find((extra) => extra.key === c)?.label ??
      c,
  );
  // Owner decision 25 Oct 2026: download wording only when Preview is also
  // ticked, since without Preview no document shows to the recipient at all.
  const canDownload = actions.includes('DOWNLOAD_REDACTED') && actions.includes('PREVIEW');
  const scope = describeGrantScope({
    actions,
    caseGrant: false,
    partLabels: categoryLabels,
    documentNames: documents
      .filter((document) => selectedDocuments.includes(document.id))
      .map((document) => document.displayName),
    hasDocuments: documents.length > 0,
    partsWhen: 'now',
  });
  // The calendar date is worked out in the browser after it loads, in the
  // person's own time zone, so the server and the browser never disagree.
  const [today, setToday] = useState<number | null>(null);
  useEffect(() => setToday(Date.now()), []);
  const days = Number(expiryDays) > 0 ? Number(expiryDays) : DEFAULT_EXPIRY_DAYS;
  const endsOn =
    today === null
      ? `${days} day${days === 1 ? '' : 's'} from today`
      : END_DATE.format(new Date(today + days * 24 * 60 * 60 * 1000));
  const endsNote = expiryDays
    ? `in ${expiryDays} day${expiryDays === '1' ? '' : 's'}`
    : `in ${DEFAULT_EXPIRY_DAYS} days, the default`;

  function reviewScope() {
    if (!form.current?.reportValidity()) return;
    if (actions.length === 0) {
      setReviewError('Select at least one permission before reviewing access.');
      return;
    }
    if (profileScope === 'some' && categories.length === 0) {
      setReviewError('Choose at least one part of your profile, or choose everything.');
      return;
    }
    if (documentScope === 'some' && selectedDocuments.length === 0) {
      setReviewError('Choose at least one document, or choose every document.');
      return;
    }
    setReviewError('');
    setReviewed(true);
    review.current?.focus();
  }

  return (
    <form
      ref={form}
      action={formAction}
      className="field-list sharing-composer"
      onChange={() => {
        setReviewed(false);
        setReviewError('');
      }}
      onSubmit={(event) => {
        if (!reviewed || actions.length === 0 || pending) {
          event.preventDefault();
          if (!pending) reviewScope();
        }
      }}
      onReset={() => {
        setRecipientEmail('');
        setPurpose('');
        setActions(
          SHAREABLE_ACTIONS.filter((action) => action.defaultOn).map((action) => action.value),
        );
        setCategories([]);
        setProfileScope('all');
        setDocumentScope('all');
        setSelectedDocuments([]);
        setExpiryDays('');
        setReviewed(false);
        setReviewError('');
      }}
    >
      <input type="hidden" name="applicantId" value={applicantId} />

      <div className="field-row">
        <label className="field-label" htmlFor="recipientEmail">
          {t('applicantSharing.appApplicantIdSharingGrantForm.recipientEmail')}
        </label>
        <input
          id="recipientEmail"
          name="recipientEmail"
          type="email"
          required
          className="input"
          placeholder={t('applicantSharing.appApplicantIdSharingGrantForm.themExampleCom')}
          onChange={(e) => setRecipientEmail(e.target.value)}
        />
      </div>

      <div className="field-row">
        <label className="field-label" htmlFor="purpose">
          {t('applicantSharing.appApplicantIdSharingGrantForm.purpose')}
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          required
          className="input"
          placeholder={t('applicantSharing.appApplicantIdSharingGrantForm.eGReviewMyUkStudent')}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        />
        <fieldset className="fieldset grant-purpose-chips">
          <legend className="sr-only">
            {t('applicantSharing.appApplicantIdSharingGrantForm.commonReasons')}
          </legend>
          {PURPOSE_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.name}
              type="button"
              className="btn btn-secondary grant-purpose-chip"
              aria-pressed={purpose === suggestion.purpose}
              onClick={() => {
                setPurpose(suggestion.purpose);
                // Filling the box changes the scope the person is about to confirm.
                setReviewed(false);
                setReviewError('');
              }}
            >
              {suggestion.name}
            </button>
          ))}
        </fieldset>
      </div>

      <fieldset className="fieldset">
        <legend className="field-label">
          {t('applicantSharing.appApplicantIdSharingGrantForm.permissions')}
        </legend>
        <div className="checks">
          {SHAREABLE_ACTIONS.map((action) => {
            const noteId = action.note ? `grant-action-${action.value}-note` : undefined;
            return (
              <Fragment key={action.value}>
                <label className="check">
                  <input
                    type="checkbox"
                    name="action"
                    value={action.value}
                    defaultChecked={action.defaultOn ?? false}
                    aria-describedby={noteId}
                    onChange={(e) =>
                      setActions((prev) => toggled(prev, action.value, e.target.checked))
                    }
                  />
                  <span>{action.label}</span>
                </label>
                {/* Outside the label, so it is the description only and is not read twice. */}
                {action.note ? (
                  <p id={noteId} className="muted u-fs-075 u-m-0">
                    {action.note}
                  </p>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend className="field-label">
          {t('applicantSharing.appApplicantIdSharingGrantForm.whatShouldTheySeeFromYour')}
        </legend>
        <div className="checks">
          <label className="check">
            <input
              type="radio"
              name="profileScope"
              form="no-form"
              checked={profileScope === 'all'}
              onChange={() => {
                setProfileScope('all');
                setCategories([]);
              }}
            />
            <span>
              {t('applicantSharing.appApplicantIdSharingGrantForm.everythingInMyProfile')}
            </span>
          </label>
          <label className="check">
            <input
              type="radio"
              name="profileScope"
              form="no-form"
              checked={profileScope === 'some'}
              onChange={() => setProfileScope('some')}
            />
            <span>{t('applicantSharing.appApplicantIdSharingGrantForm.onlyThePartsIChoose')}</span>
          </label>
        </div>
        {profileScope === 'some' ? (
          <div className="checks u-mt-050">
            {PACK_ORDER.map((pack) => (
              <label className="check" key={pack}>
                <input
                  type="checkbox"
                  name="category"
                  value={pack}
                  onChange={(e) => setCategories((prev) => toggled(prev, pack, e.target.checked))}
                />
                <span>{PACK_LABELS[pack]}</span>
              </label>
            ))}
            {extraCategories.map((extra) => (
              <label className="check" key={extra.key}>
                <input
                  type="checkbox"
                  name="category"
                  value={extra.key}
                  onChange={(e) =>
                    setCategories((prev) => toggled(prev, extra.key, e.target.checked))
                  }
                />
                <span>{extra.label}</span>
              </label>
            ))}
            {unsortedDocuments > 0 ? (
              <p className="muted u-fs-075" data-testid="unsorted-documents-note">
                {unsortedDocuments} of your documents {unsortedDocuments === 1 ? 'has' : 'have'} no
                kind set, so choosing parts leaves {unsortedDocuments === 1 ? 'it' : 'them'} out.{' '}
                <a href={`/app/applicant/${applicantId}/documents`}>
                  Set the kind of each document
                </a>
                , or pick documents one by one below.
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {documents.length > 0 ? (
        <fieldset className="fieldset">
          <legend className="field-label">
            {t('applicantSharing.appApplicantIdSharingGrantForm.whichDocumentsCanTheyOpen')}
          </legend>
          <div className="checks">
            <label className="check">
              <input
                type="radio"
                name="documentScope"
                form="no-form"
                checked={documentScope === 'all'}
                onChange={() => {
                  setDocumentScope('all');
                  setSelectedDocuments([]);
                }}
              />
              <span>{t('applicantSharing.appApplicantIdSharingGrantForm.everyDocument')}</span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="documentScope"
                form="no-form"
                checked={documentScope === 'some'}
                onChange={() => setDocumentScope('some')}
              />
              <span>
                {t('applicantSharing.appApplicantIdSharingGrantForm.onlyTheDocumentsIChoose')}
              </span>
            </label>
          </div>
          {documentScope === 'some' ? (
            <div className="checks u-mt-050">
              {documents.map((doc) => (
                <label className="check" key={doc.id}>
                  <input
                    type="checkbox"
                    name="documentId"
                    value={doc.id}
                    defaultChecked={selectedDocuments.includes(doc.id)}
                    onChange={(e) =>
                      setSelectedDocuments((prev) => toggled(prev, doc.id, e.target.checked))
                    }
                  />
                  <span>{doc.displayName}</span>
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <div className="field-row">
        <label className="field-label" htmlFor="expiryDays">
          {t('applicantSharing.appApplicantIdSharingGrantForm.expiresAfterDays')}
        </label>
        <input
          id="expiryDays"
          name="expiryDays"
          type="number"
          min="1"
          max="90"
          className="input"
          placeholder={t('applicantSharing.appApplicantIdSharingGrantForm.30DefaultUpTo90')}
          onChange={(e) => setExpiryDays(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 'var(--text-caption)', margin: '0.3rem 0 0' }}>
          {t('applicantSharing.appApplicantIdSharingGrantForm.everyGrantExpiresLeaveBlankFor')}
        </p>
      </div>

      <div className="sharing-scope-review" ref={review} tabIndex={-1} aria-live="polite">
        <h3>
          {reviewed
            ? t('applicantSharing.appApplicantIdSharingGrantForm.confirmThisAccess')
            : t('applicantSharing.appApplicantIdSharingGrantForm.yourAccessSummary')}
        </h3>
        <SelectedScopeSummary
          recipient={recipientEmail || 'This recipient'}
          purpose={purpose || null}
          permissions={
            actions.length === 0
              ? ['nothing yet, select at least one permission']
              : actions
                  .filter((a) => SHAREABLE_ACTIONS.some((s) => s.value === a))
                  .map((a) => permissionPhrase(a))
          }
          profile={scope.profile}
          documents={scope.documents}
          endsOn={endsOn}
          endsNote={endsNote}
        />
        {/* One warning, not three (friction F5): that they must accept is already said above the
            form, and pausing is in the panel, so only what is included and the one limit of
            revoking are left, each said once. */}
        <p className="scope-summary-note">
          {canDownload
            ? t('applicantSharing.appApplicantIdSharingGrantForm.safeCopiesMayBeDownloadedOriginal')
            : t('applicantSharing.appApplicantIdSharingGrantForm.downloadsAreNotIncludedYouCan')}
        </p>
        {canDownload ? (
          // Owner-approved wording, 25 Oct 2026; shown only when downloads are allowed.
          <p className="scope-summary-download">
            {t('applicantSharing.appApplicantIdSharingGrantForm.revokingEndsAccessOnVisastackIt')}
          </p>
        ) : null}
      </div>

      {reviewError ? (
        <p role="alert" className="field-msg field-msg-err">
          {reviewError}
        </p>
      ) : null}
      <div className="sharing-confirm-controls">
        {/* Friction F7: the confirm button is not ready until the access has been reviewed. */}
        {reviewed || pending ? null : (
          <p className="muted u-m-0" data-testid="confirm-reason">
            {t('applicantSharing.appApplicantIdSharingGrantForm.pressReviewAndConfirmFirst')}
          </p>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            if (!pending) reviewScope();
          }}
          aria-disabled={pending || undefined}
        >
          {t('applicantSharing.appApplicantIdSharingGrantForm.reviewAndConfirm')}
        </button>
        <SubmitButton
          unavailable={!reviewed || actions.length === 0}
          pending={pending}
          idle="Confirm Sharing Request"
          busy="Sharing…"
          className="btn btn-primary"
        />
        {/* The receipt says what the line would, so it stands in for it on success (no second
            "Shared." beside "Not shared yet."); a refusal still shows its own line. */}
        <FormMessage result={receipt && state.ok ? NO_RESULT : state} toast={!receipt} />
        {receipt ? (
          <ReceiptCard
            key={receipt.at}
            title={
              receipt.invited
                ? t('applicantSharing.appApplicantIdSharingGrantForm.invitationCreated')
                : t('applicantSharing.appApplicantIdSharingGrantForm.sharingRequestCreated')
            }
            what={receipt.invited ? state.message : DIRECT_RECEIPT_LINE}
            at={receipt.at}
            to={receipt.to || undefined}
            toLabel="To"
            honestLine="Not shared yet. They see nothing until they accept."
            // An in-page link, so the sheet this form sits in on a phone closes first.
            next={{ label: 'See Who Has Access', href: '#who-has-access' }}
            onDone={() => setReceipt(null)}
            // A button, never a field, so Done does not bring up the phone's keyboard.
            returnFocusTo={() =>
              form.current?.querySelector<HTMLElement>('.sharing-confirm-controls button') ?? null
            }
          />
        ) : null}
        {state.ok && state.invitationUrl ? (
          <InvitationLink url={state.invitationUrl} purpose="sharing" />
        ) : null}
      </div>
    </form>
  );
}
