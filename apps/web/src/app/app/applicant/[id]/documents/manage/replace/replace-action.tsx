'use client';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { formatTimestampDate } from '../../../../../../../lib/format-date';
import { acceptAttribute } from '../../../../../../../lib/upload-rules';
import { uploadDocumentAction } from '../../../actions';
import type { ManageActionProps } from '../registry';
import { type ReplaceOptionsResult, replaceDocumentAction, replaceOptionsAction } from './actions';
import { confirmMessage } from './messages';

type Options = Extract<ReplaceOptionsResult, { ok: true }>;

/** How often, and how many times, the list is read again while a new upload is being checked. */
export const RECHECK_EVERY_MS = 3000;
export const RECHECK_TIMES = 10;

/**
 * Replace With a Newer Document (lane LC-B), opened from the Manage menu or a reminder's
 * "Replace It" link. Three steps: choose the newer document (one already kept, or add it now),
 * confirm with the cases that will be updated named, then the result line. Focus moves to each
 * step's heading so a keyboard or screen reader user always knows where they are.
 */
export function ReplaceAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [step, setStep] = useState<'choose' | 'confirm' | 'done'>('choose');
  const [busy, setBusy] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [rechecks, setRechecks] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const fileId = useId();
  const fileHintId = useId();
  const moveFocus = useRef(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  // A just-added document is checked before it can be chosen: read the list again a few times.
  useEffect(() => {
    if (rechecks <= 0) return;
    const timer = setTimeout(async () => {
      const loaded = await load();
      const waiting = loaded?.candidates.some((c) => !c.ready) ?? false;
      setRechecks(waiting ? rechecks - 1 : 0);
    }, RECHECK_EVERY_MS);
    return () => clearTimeout(timer);
  }, [rechecks, load]);

  // Each new step takes focus on its heading (not the first one: the menu already focused the
  // panel). Set by `goTo`, applied once the new step has rendered.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    heading.current?.focus();
  });
  const goTo = (next: 'choose' | 'confirm' | 'done') => {
    moveFocus.current = true;
    setStep(next);
  };

  const kind = options?.kindLabel ?? 'document';
  const readyCandidates = options?.candidates.filter((c) => c.ready) ?? [];
  const chosenCandidate = options?.candidates.find((c) => c.documentId === chosen && c.ready);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setRechecks(RECHECK_TIMES);
      router.refresh();
    } catch {
      setUploadNote('The file could not be added. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (!chosenCandidate) return;
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
      goTo('done');
      router.refresh();
    } catch {
      setProblem('We could not replace it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="lc-replace" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-replace-heading">
          Document Replaced
        </h3>
        <output className="lc-replace-result">{result}</output>
        <div className="lc-replace-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm' && chosenCandidate && options) {
    return (
      <div className="lc-replace" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-replace-heading">
          Replace {documentName}?
        </h3>
        <p>
          The newer document is <strong>{chosenCandidate.name}</strong>.{' '}
          {confirmMessage(options.cases.length)}
        </p>
        {options.cases.length > 0 ? (
          <ul className="lc-replace-cases">
            {options.cases.map((c) => (
              <li key={c.missionId}>{c.title}</li>
            ))}
          </ul>
        ) : null}
        <p className="lc-replace-note">
          The old document stays in your records, marked Replaced. Nothing you already sent or
          confirmed is changed.
        </p>
        {problem ? (
          <p className="lc-replace-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="lc-replace-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={replace}>
            {busy ? 'Replacing' : 'Replace'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              setProblem(null);
              goTo('choose');
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lc-replace" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-replace-heading">
        Replace With a Newer Document
      </h3>
      {problem ? (
        <p className="lc-replace-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {!options && !problem ? <output>Loading your documents</output> : null}
      {options ? (
        <>
          <fieldset className="lc-replace-choices">
            <legend>
              Choose the newer {kind.toLowerCase()} to use instead of {documentName}
            </legend>
            {options.candidates.length === 0 ? (
              <p className="lc-replace-note">
                You have no other {kind.toLowerCase()} yet. Add the new one below.
              </p>
            ) : (
              options.candidates.map((candidate) => (
                <label
                  key={candidate.documentId}
                  className="lc-replace-choice"
                  data-ready={candidate.ready ? 'true' : 'false'}
                >
                  <input
                    type="radio"
                    name={`replace-${documentId}`}
                    value={candidate.documentId}
                    checked={chosen === candidate.documentId}
                    disabled={!candidate.ready || busy}
                    onChange={() => setChosen(candidate.documentId)}
                  />
                  <span className="lc-replace-choice-text">
                    <span>{candidate.name}</span>
                    <span className="lc-replace-choice-meta">
                      Added {formatTimestampDate(candidate.uploadedAt)}
                      {candidate.ready ? '' : '. Still being checked'}
                    </span>
                  </span>
                </label>
              ))
            )}
          </fieldset>
          <form className="lc-replace-upload" onSubmit={upload}>
            <label htmlFor={fileId}>Or add the newer document now</label>
            <input
              id={fileId}
              ref={fileRef}
              type="file"
              name="file"
              accept={acceptAttribute(options.pdfAccepted)}
              aria-describedby={fileHintId}
              disabled={busy}
            />
            <p id={fileHintId} className="lc-replace-note">
              It is filed as {options.kindLabel ?? 'the same kind'} and checked before you can
              choose it.
            </p>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              {busy ? 'Adding' : 'Add the Document'}
            </button>
            {uploadNote ? <output className="lc-replace-upload-note">{uploadNote}</output> : null}
          </form>
          <div className="lc-replace-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!chosenCandidate || busy}
              onClick={() => goTo('confirm')}
            >
              Continue
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
          </div>
          {readyCandidates.length === 0 && options.candidates.length > 0 ? (
            <p className="lc-replace-note">
              A document can be chosen once its check is finished. This list updates by itself.
            </p>
          ) : null}
        </>
      ) : null}
      {problem && !options ? (
        <div className="lc-replace-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
