'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { FormMessage, SubmitButton } from '../../../../../components/form-feedback';
import { InvitationLink } from '../../../../../components/invitation-link';
import {
  SelectedScopeSummary,
  describeGrantScope,
} from '../../../../../components/selected-scope-summary';
import { PACK_LABELS, PACK_ORDER } from '../../../../../lib/profile-fields';
import { type ActionState, createGrantAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/** Every grant ends; with no days given the service applies its 30-day default. */
const DEFAULT_EXPIRY_DAYS = 30;
const END_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Curated, launch-safe permission set (read + collaborate; no original download / manage). */
const SHAREABLE_ACTIONS: ReadonlyArray<{ value: string; label: string; defaultOn?: boolean }> = [
  { value: 'VIEW_METADATA', label: 'See document details', defaultOn: true },
  { value: 'PREVIEW', label: 'Preview documents', defaultOn: true },
  { value: 'DOWNLOAD_REDACTED', label: 'Download redacted copies' },
  { value: 'COMMENT', label: 'Comment' },
  { value: 'PROPOSE_EDIT', label: 'Propose edits' },
];

function toggled(current: readonly string[], value: string, on: boolean): string[] {
  return on ? [...current, value] : current.filter((v) => v !== value);
}

export function GrantForm({
  applicantId,
  documents,
  extraCategories = [],
  unsortedDocuments = 0,
}: {
  readonly applicantId: string;
  readonly documents: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  /** New categories that already hold a saved detail, so only categories with something in them are offered. */
  readonly extraCategories?: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  /** Documents with no kind set. They belong to no category, so choosing parts of the profile leaves them out. */
  readonly unsortedDocuments?: number;
}) {
  const [state, formAction, pending] = useActionState(createGrantAction, INITIAL);
  const router = useRouter();
  const invitationUrl = state.ok ? state.invitationUrl : undefined;
  useEffect(() => {
    if (invitationUrl) router.refresh();
  }, [invitationUrl, router]);

  // Native fields remain the server action's source of truth. Review is an
  // explicit confirmation of their current scope, invalidated by any edit.
  const form = useRef<HTMLFormElement>(null);
  const review = useRef<HTMLDivElement>(null);
  const [reviewed, setReviewed] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [actions, setActions] = useState<readonly string[]>(
    SHAREABLE_ACTIONS.filter((a) => a.defaultOn).map((a) => a.value),
  );
  const [categories, setCategories] = useState<readonly string[]>([]);
  /** Sharing everything is a visible choice, never what happens because nothing was ticked. */
  const [profileScope, setProfileScope] = useState<'all' | 'some'>('all');
  const [documentScope, setDocumentScope] = useState<'all' | 'some'>('all');
  const [selectedDocuments, setSelectedDocuments] = useState<readonly string[]>([]);
  const [expiryDays, setExpiryDays] = useState('');

  const categoryLabels = categories.map(
    (c) =>
      PACK_LABELS[c as keyof typeof PACK_LABELS] ??
      extraCategories.find((extra) => extra.key === c)?.label ??
      c,
  );
  const canDownload = actions.includes('DOWNLOAD_REDACTED');
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
          Recipient email
        </label>
        <input
          id="recipientEmail"
          name="recipientEmail"
          type="email"
          required
          className="input"
          placeholder="them@example.com"
          onChange={(e) => setRecipientEmail(e.target.value)}
        />
      </div>

      <div className="field-row">
        <label className="field-label" htmlFor="purpose">
          Purpose
        </label>
        <input
          id="purpose"
          name="purpose"
          type="text"
          required
          className="input"
          placeholder="e.g. Review my UK student visa documents"
          onChange={(e) => setPurpose(e.target.value)}
        />
      </div>

      <fieldset className="fieldset">
        <legend className="field-label">Permissions</legend>
        <div className="checks">
          {SHAREABLE_ACTIONS.map((action) => (
            <label className="check" key={action.value}>
              <input
                type="checkbox"
                name="action"
                value={action.value}
                defaultChecked={action.defaultOn ?? false}
                onChange={(e) =>
                  setActions((prev) => toggled(prev, action.value, e.target.checked))
                }
              />
              <span>{action.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="fieldset">
        <legend className="field-label">What should they see from your profile?</legend>
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
            <span>Everything in my profile</span>
          </label>
          <label className="check">
            <input
              type="radio"
              name="profileScope"
              form="no-form"
              checked={profileScope === 'some'}
              onChange={() => setProfileScope('some')}
            />
            <span>Only the parts I choose</span>
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
          <legend className="field-label">Which documents can they open?</legend>
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
              <span>Every document</span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="documentScope"
                form="no-form"
                checked={documentScope === 'some'}
                onChange={() => setDocumentScope('some')}
              />
              <span>Only the documents I choose</span>
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
          Expires after (days)
        </label>
        <input
          id="expiryDays"
          name="expiryDays"
          type="number"
          min="1"
          max="90"
          className="input"
          placeholder="30 (default), up to 90"
          onChange={(e) => setExpiryDays(e.target.value)}
        />
        <p className="muted" style={{ fontSize: 'var(--text-caption)', margin: '0.3rem 0 0' }}>
          Every grant expires. Leave blank for the 30-day default; the maximum is 90 days.
        </p>
      </div>

      <div className="sharing-scope-review" ref={review} tabIndex={-1} aria-live="polite">
        <h3>{reviewed ? 'Confirm this access' : 'Your access summary'}</h3>
        <SelectedScopeSummary
          recipient={recipientEmail || 'This recipient'}
          purpose={purpose || null}
          permissions={
            actions.length === 0
              ? ['nothing yet - select at least one permission']
              : actions
                  .map((a) => SHAREABLE_ACTIONS.find((s) => s.value === a)?.label.toLowerCase())
                  .filter((label): label is string => Boolean(label))
          }
          profile={scope.profile}
          documents={scope.documents}
          endsOn={endsOn}
          endsNote={endsNote}
        />
        <p className="scope-summary-note">
          {canDownload
            ? 'Redacted copies may be downloaded; original downloads are not included. '
            : 'Downloads are not included. '}
          They must accept before anything is visible to them.{' '}
          {canDownload
            ? 'You can pause or revoke access at any time.'
            : 'You can pause or revoke future access at any time; copies already downloaded cannot be recalled.'}
        </p>
        {canDownload ? (
          // Owner-approved wording, 25 Oct 2026; shown only when downloads are allowed.
          <p className="scope-summary-download">
            Revoking ends access on VisaStack. It cannot take back copies someone already
            downloaded.
          </p>
        ) : null}
      </div>

      {reviewError ? (
        <p role="alert" className="field-msg field-msg-err">
          {reviewError}
        </p>
      ) : null}
      <div className="sharing-confirm-controls">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            if (!pending) reviewScope();
          }}
          aria-disabled={pending || undefined}
        >
          Review and confirm
        </button>
        <SubmitButton
          unavailable={!reviewed || actions.length === 0}
          pending={pending}
          idle="Confirm sharing request"
          busy="Sharing…"
          className="btn btn-primary"
        />
        <FormMessage result={state} />
        {state.ok && state.invitationUrl ? <InvitationLink url={state.invitationUrl} /> : null}
      </div>
    </form>
  );
}
