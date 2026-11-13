'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { usePageLanguage, useT } from '../../../../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../../../../i18n/app-applicant';
import type { ManageActionProps } from '../registry';
import { type RefusalLine, REMOVAL_WORDS as W, refusalNode, said } from '../removal-words';
import { type SelfDeletePreviewResult, selfDeleteAction, selfDeletePreviewAction } from './actions';
import { BACKUP_NOTE, SIGN_IN_AGAIN, WHAT_HAPPENS, impactLines } from './messages';

type Preview = Extract<SelfDeletePreviewResult, { ok: true }>;

/**
 * Delete My File (owner decision of 3 Nov 2026), opened from the Manage menu. One confirmation:
 * what is lost, what it touches (only the lines that are not zero), the backup note, and a typed
 * word. The server decides again and checks the word and what the file touches; if that changed
 * since this screen was read, it is read again instead of deleting. The one filled button is the
 * danger button; buttons stay focusable while work runs (aria-disabled).
 */
export function SelfDeleteAction({
  applicantId,
  documentId,
  documentName,
  onClose,
}: ManageActionProps) {
  const t = useT(appApplicantCatalog);
  const pageLang = usePageLanguage();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<RefusalLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const fieldId = useId();
  const problemId = useId();

  const load = useCallback(async () => {
    setPreview(null);
    try {
      const loaded = await selfDeletePreviewAction(applicantId, documentId);
      if (loaded.ok) setPreview(loaded);
      else setProblem(loaded);
    } catch {
      setProblem(said(W.couldNotCheckFile));
    }
  }, [applicantId, documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opened straight from a link (after a sign-in check), nothing has focus here yet.
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'center' });
  }, []);

  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result]);

  async function remove() {
    if (busy || !preview) return;
    if (typed.trim() === '') {
      setProblem(said(W.typeTheWordToConfirm));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const done = await selfDeleteAction(applicantId, documentId, typed, preview.impact);
      if (done.ok) {
        setResult(done.message);
      } else if ('signInHref' in done) {
        window.location.assign(done.signInHref);
      } else {
        setProblem(done);
        if (done.stale) {
          setTyped('');
          await load();
        }
      }
    } catch {
      setProblem(said(W.couldNotDeleteIt));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div ref={root} className="lc-selfdelete" aria-labelledby={headingId}>
        <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-selfdelete-heading">
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.fileDeleted',
          )}
        </h3>
        <output className="lc-selfdelete-result">{result}</output>
        <div className="lc-selfdelete-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              router.refresh();
            }}
          >
            {t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.done')}
          </button>
        </div>
      </div>
    );
  }

  const lines = preview ? impactLines(preview.impact) : [];
  return (
    <div ref={root} className="lc-selfdelete" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="lc-selfdelete-heading">
        {t.node(
          'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.deleteDocumentnameNow',
          { documentName },
        )}
      </h3>
      {problem ? (
        <p id={problemId} className="lc-selfdelete-problem" role="alert">
          {refusalNode(t, problem, pageLang)}
        </p>
      ) : null}
      {!preview && !problem ? (
        <output>
          {t.node(
            'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.checkingThisFile',
          )}
        </output>
      ) : null}
      {preview ? (
        <>
          <p>{WHAT_HAPPENS}</p>
          {lines.length > 0 ? (
            <ul className="lc-selfdelete-impact">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {preview.needsFreshSignIn ? <p className="lc-selfdelete-note">{SIGN_IN_AGAIN}</p> : null}
          <p className="lc-selfdelete-note">{BACKUP_NOTE}</p>
          <div className="lc-selfdelete-field">
            <label htmlFor={fieldId}>
              {t.node(
                'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.typeDeleteToConfirm',
              )}
            </label>
            <input
              id={fieldId}
              type="text"
              className="input"
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby={problem ? problemId : undefined}
              onChange={(event) => {
                setTyped(event.target.value);
                setProblem(null);
              }}
            />
          </div>
          <div className="lc-selfdelete-actions">
            <button
              type="button"
              className="btn btn-danger"
              aria-disabled={busy || undefined}
              onClick={remove}
            >
              {busy
                ? t.node('appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleting')
                : t.node(
                    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.deleteFileNow',
                  )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) onClose();
              }}
            >
              {t.node('appApplicant.appApplicantIdDocumentSuggestionCard.cancel')}
            </button>
          </div>
        </>
      ) : null}
      {problem && !preview ? (
        <div className="lc-selfdelete-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.node('appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
