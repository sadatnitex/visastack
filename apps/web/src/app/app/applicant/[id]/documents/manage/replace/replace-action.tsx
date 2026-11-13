'use client';
import type { ChangeImpact } from '@visastack/services';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useT } from '../../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
import { changeImpactCatalog } from '../../../../../../../i18n/change-impact';
import { formatTimestampDate } from '../../../../../../../lib/format-date';
import { acceptAttribute } from '../../../../../../../lib/upload-rules';
import { uploadDocumentAction } from '../../../actions';
import { ChangeImpactReview } from '../../../change-impact/change-impact-review';
import { changeImpactHref } from '../../../change-impact/impact-words';
import type { ManageActionProps } from '../registry';
import {
  type ReplaceCandidateView,
  type ReplaceOptionsResult,
  previewReplaceImpactAction,
  replaceDocumentAction,
  replaceOptionsAction,
} from './actions';
import { confirmMessage } from './messages';

type Options = Extract<ReplaceOptionsResult, { ok: true }>;
type Step = 'choose' | 'confirm' | 'done';

/** How often, and how many times, the list is read again while a document is being checked. */
export const RECHECK_EVERY_MS = 3000;
export const RECHECK_TIMES = 10;

const STATUS_WORDS: Record<ReplaceCandidateView['status'], string> = {
  READY: '',
  CHECKING: '. Still being checked',
  CANNOT_USE: '. Cannot be used',
};

/**
 * What the confirm step knows about what the replacement would affect: still being worked out,
 * the review itself, or not available this time (the plain list of cases is shown instead).
 */
type Preview = 'loading' | 'unavailable' | ChangeImpact;

/**
 * Replace with a Newer Document (lane LC-B), opened from the Manage menu or a reminder's
 * "Replace It" link. Three steps: choose the newer document (one already kept, or add it now),
 * confirm with What This Change Affects shown for that choice, then the result line with the
 * same review as recorded. The review only informs: if it cannot be read, the cases that will be
 * updated are named as before and the replacement stays possible. Focus moves to each
 * step's heading so a keyboard or screen reader user always knows where they are. Buttons stay
 * focusable while work runs (aria-disabled), so focus is never lost.
 */
export function ReplaceAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const t = useT(appApplicantCatalog);
  const impactT = useT(changeImpactCatalog);
  const locale = useLocale();
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>('loading');
  const [recorded, setRecorded] = useState<ChangeImpact | null>(null);
  /** The newer document the latest preview was asked for, so a slow answer for another is dropped. */
  const previewFor = useRef<string | null>(null);
  const [rechecks, setRechecks] = useState(0);
  const [stillChecking, setStillChecking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const moveFocus = useRef(false);
  const headingId = useId();
  const choiceHintId = useId();
  const fileId = useId();
  const fileHintId = useId();
  const impactId = useId();

  const load = useCallback(async () => {
    try {
      const loaded = await replaceOptionsAction(applicantId, documentId);
      if (!loaded.ok) {
        setProblem(loaded.message);
        return null;
      }
      setProblem(null);
      setOptions(loaded);
      return loaded;
    } catch {
      setProblem('We could not load your documents. Close this and try again.');
      return null;
    }
  }, [applicantId, documentId]);

  const watchChecks = useCallback(() => {
    setStillChecking(false);
    setRechecks(RECHECK_TIMES);
  }, []);

  // First load. A document still being checked starts the short watch below.
  useEffect(() => {
    void load().then((loaded) => {
      if (loaded?.candidates.some((c) => c.status === 'CHECKING')) watchChecks();
    });
  }, [load, watchChecks]);

  // Opened straight from a reminder's link, nothing has focus here yet: take it and come into
  // view. Opened from the Manage menu, the menu has already moved focus into the panel.
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  // While a document is being checked, read the list again a few times, then offer Check Again.
  useEffect(() => {
    if (rechecks <= 0) return;
    const timer = setTimeout(async () => {
      const loaded = await load();
      const waiting = loaded?.candidates.some((c) => c.status === 'CHECKING') ?? false;
      setRechecks(waiting ? rechecks - 1 : 0);
      if (waiting && rechecks === 1) setStillChecking(true);
    }, RECHECK_EVERY_MS);
    return () => clearTimeout(timer);
  }, [rechecks, load]);

  // Each new step takes focus on its heading, once that step has rendered.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    heading.current?.focus();
  });
  const goTo = (next: Step) => {
    moveFocus.current = true;
    setStep(next);
  };

  const chosenCandidate = options?.candidates.find(
    (c) => c.documentId === chosen && c.status === 'READY',
  );
  const checking = options?.candidates.some((c) => c.status === 'CHECKING') ?? false;

  /** Asks what replacing with `newDocumentId` would affect. Never blocks the Replace button. */
  function loadPreview(newDocumentId: string) {
    previewFor.current = newDocumentId;
    setPreview('loading');
    const settle = (next: Preview) => {
      if (previewFor.current === newDocumentId) setPreview(next);
    };
    void (async () => {
      try {
        settle(
          (await previewReplaceImpactAction(applicantId, documentId, newDocumentId)) ??
            'unavailable',
        );
      } catch {
        settle('unavailable');
      }
    })();
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const file = fileRef.current?.files?.[0];
    if (!file || !options) {
      setUploadNote('Choose the file of the newer document first.');
      return;
    }
    setBusy(true);
    setUploadNote(null);
    try {
      const formData = new FormData();
      formData.set('applicantId', applicantId);
      formData.set('file', file);
      if (options.docType) formData.set('docType', options.docType);
      const uploaded = await uploadDocumentAction({ ok: true, message: '' }, formData);
      if (!uploaded.ok) {
        setUploadNote(uploaded.message || 'The file could not be added. Try again.');
        return;
      }
      if (fileRef.current) fileRef.current.value = '';
      setUploadNote('Added. We are checking it now; you can choose it in a moment.');
      await load();
      watchChecks();
    } catch {
      setUploadNote('The file could not be added. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!chosenCandidate || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const replaced = await replaceDocumentAction(
        applicantId,
        documentId,
        chosenCandidate.documentId,
      );
      if (!replaced.ok) {
        setProblem(replaced.message);
        return;
      }
      setResult(replaced.message);
      setRecorded(replaced.impact ?? null);
      goTo('done');
    } catch {
      setProblem('We could not replace it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const problemLine = problem ? (
    <p className="lc-replace-problem" role="alert">
      {problem}
    </p>
  ) : null;

  if (step === 'done') {
    return (
      <div ref={root} className="lc-replace" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-replace-heading">
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.documentReplaced',
          )}
        </h3>
        <output className="lc-replace-result">{result}</output>
        {recorded ? (
          <>
            <ChangeImpactReview
              impact={recorded}
              applicantId={applicantId}
              t={impactT}
              locale={locale}
              titleLevel={4}
              idPrefix={`${impactId}recorded`}
            />
            <Link
              className="ci-step"
              href={changeImpactHref(applicantId, { kind: 'DOCUMENT', id: documentId })}
            >
              {impactT.node('changeImpact.review.openPage')}
            </Link>
          </>
        ) : (
          <p className="lc-replace-note">{impactT.node('changeImpact.review.recordedFailed')}</p>
        )}
        <div className="lc-replace-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              // The documents list and the cases change only now, so the line above was read.
              router.refresh();
            }}
          >
            {t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.done')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && chosenCandidate && options) {
    // The review stands in for the plain list of cases only once it is whole. While it is still
    // being worked out, could not be read, or is missing a part, the list the app already knows
    // stays, with its count, so the person never confirms without seeing which cases change.
    const reviewDrawn = typeof preview !== 'string' && preview.complete;
    const showCases = !reviewDrawn;
    return (
      <div ref={root} className="lc-replace" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-replace-heading">
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replaceDocumentname',
            {
              documentName,
            },
          )}
        </h3>
        <p>
          The newer document is <strong>{chosenCandidate.name}</strong>.
          {showCases ? <> {confirmMessage(options.cases.length)}</> : null}
        </p>
        {showCases && options.cases.length > 0 ? (
          <ul className="lc-replace-cases">
            {options.cases.map((c) => (
              <li key={c.missionId}>{c.title}</li>
            ))}
          </ul>
        ) : null}
        {/* One polite line that changes in place, so the review arriving is announced. */}
        <output className={reviewDrawn ? 'sr-only' : 'lc-replace-note'}>
          {impactT.node(
            preview === 'loading'
              ? 'changeImpact.review.loading'
              : preview === 'unavailable'
                ? 'changeImpact.review.previewFailed'
                : 'changeImpact.review.ready',
          )}
        </output>
        {typeof preview === 'string' ? null : (
          <ChangeImpactReview
            impact={preview}
            applicantId={applicantId}
            t={impactT}
            locale={locale}
            titleLevel={4}
            idPrefix={`${impactId}preview`}
          />
        )}
        <p className="lc-replace-note">
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.theOldDocumentStaysInYour',
          )}
        </p>
        {problemLine}
        <div className="lc-replace-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-disabled={busy || undefined}
            onClick={replace}
          >
            {busy
              ? t.node('appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replacing')
              : t.node('appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replace')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              setProblem(null);
              goTo('choose');
            }}
          >
            {t.node('appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="lc-replace" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-replace-heading">
        {t.node(
          'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replaceWithANewerDocument',
        )}
      </h3>
      {problemLine}
      {!options && !problem ? (
        <output>
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.loadingYourDocuments',
          )}
        </output>
      ) : null}
      {options ? (
        <>
          <fieldset className="lc-replace-choices" aria-describedby={choiceHintId}>
            <legend className="lc-replace-legend">
              {t.node(
                'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.chooseTheNewerDocument',
              )}
            </legend>
            <p id={choiceHintId} className="lc-replace-note">
              {t.node(
                'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.itTakesThePlaceOfDocumentname',
                { documentName },
              )}
            </p>
            {options.candidates.length === 0 ? (
              <p className="lc-replace-note">
                {t.node(
                  'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.youHaveNoOtherDocumentOf',
                )}
              </p>
            ) : (
              options.candidates.map((candidate) => (
                <label
                  key={candidate.documentId}
                  className="lc-replace-choice"
                  data-status={candidate.status}
                >
                  <input
                    type="radio"
                    name={`replace-${documentId}`}
                    value={candidate.documentId}
                    checked={chosen === candidate.documentId}
                    disabled={candidate.status !== 'READY'}
                    onChange={() => setChosen(candidate.documentId)}
                  />
                  <span className="lc-replace-choice-text">
                    <span className="lc-replace-choice-name">{candidate.name}</span>
                    <span className="lc-replace-choice-meta">
                      {t.node(
                        'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addedFormattimestampdateStatusWords',
                        {
                          formatTimestampDate: formatTimestampDate(candidate.uploadedAt, locale),
                          STATUS_WORDS: STATUS_WORDS[candidate.status],
                        },
                      )}
                    </span>
                  </span>
                </label>
              ))
            )}
            {checking && stillChecking ? (
              <div className="lc-replace-recheck">
                <p className="lc-replace-note">
                  {t.node(
                    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.aCheckCanTakeAFew',
                  )}
                </p>
                <button type="button" className="btn btn-secondary" onClick={watchChecks}>
                  {t.node(
                    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.checkAgain',
                  )}
                </button>
              </div>
            ) : null}
          </fieldset>
          <form className="lc-replace-upload" onSubmit={upload}>
            <label htmlFor={fileId} className="lc-replace-legend">
              {t.node(
                'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addTheNewerDocument',
              )}
            </label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              name="file"
              accept={acceptAttribute(options.pdfAccepted)}
              aria-describedby={fileHintId}
            />
            <p id={fileHintId} className="lc-replace-note">
              It is filed as {options.kindLabel ?? 'the same kind'} and checked before you can
              choose it.
            </p>
            <button type="submit" className="btn btn-secondary" aria-disabled={busy || undefined}>
              {busy
                ? t.node('appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.adding')
                : t.node(
                    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addTheDocument',
                  )}
            </button>
            {uploadNote ? <output className="lc-replace-upload-note">{uploadNote}</output> : null}
          </form>
          <div className="lc-replace-actions">
            <button
              type="button"
              className="btn btn-primary"
              aria-disabled={!chosenCandidate || busy || undefined}
              onClick={() => {
                if (!chosenCandidate || busy) return;
                loadPreview(chosenCandidate.documentId);
                goTo('confirm');
              }}
            >
              {t.node('appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.continue')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t.node('appApplicant.appApplicantIdDocumentSuggestionCard.cancel')}
            </button>
          </div>
        </>
      ) : null}
      {problem && !options ? (
        <div className="lc-replace-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.node('appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
