'use client';

import { AI_FEATURE_OFF_HINT } from '@visastack/core/ai-features';
import { useEffect, useId, useRef, useState } from 'react';
import {
  AI_FILE_FIELD,
  AI_FILE_PRESENT_FIELD,
  type AiFileCandidateView,
  type AiFileChoice,
  aiFileVariantField,
} from '../lib/ai-consent-choices';
import {
  AI_FILES_KEPT_NOTE,
  AI_ORIGINAL_FILES_LABEL,
  AI_ORIGINAL_FILES_NEEDS_LIST,
  AI_ORIGINAL_FILES_NONE,
  AI_ORIGINAL_FILES_NOTE,
  AI_ORIGINAL_FILES_PROTECTED,
  AI_ORIGINAL_LABEL,
  AI_ORIGINAL_NOTE,
  AI_SAFE_COPY_LABEL,
  AI_SAFE_COPY_NOT_READY,
  AI_SHARE_FILE_FIRST,
  AI_SHARE_FILE_LABEL,
} from '../lib/ai-consent-labels';
import { CollapsibleGroup } from './collapsible-group';

export interface AiFileChoicesProps {
  /** The record's documents that may be given as files, grouped as the Documents screen groups them. */
  readonly candidates: readonly AiFileCandidateView[];
  /** What the boxes start with: the stored choices, or what the person just submitted. */
  readonly initial: readonly AiFileChoice[];
  /** What the connection has stored (Change Access only). While the feature is off only these stay open. */
  readonly stored?: readonly AiFileChoice[];
  /** Whether AI App Original Files works right now (the platform owner's switch). */
  readonly available: boolean;
  /** Points the group at the form's error message. */
  readonly invalid?: { readonly field: string; readonly messageId: string };
}

/**
 * "Original Files" (S20, ADR 0021 extension): one row per document that may be given to the app,
 * under its group. Each row has its own box, "Share This File", and a choice of "Safe Copy" (the
 * default) or "Original". Shown in warning tone, with the warning in words too, never by colour
 * alone. Protected documents are never listed, and one sentence says so.
 *
 * While the feature is off the group stays on the screen with the usual sentence: what is ticked
 * stays ticked and can be unticked, an Original can become a Safe Copy, and nothing new can be
 * added (the server enforces the same).
 */
export function AiFileChoices({
  candidates,
  initial,
  stored = [],
  available,
  invalid,
}: AiFileChoicesProps) {
  const id = useId();
  const noteId = `${id}-files-note`;
  const protectedId = `${id}-files-protected`;
  const offId = `${id}-files-off`;
  const originalNoteId = `${id}-files-original`;
  const ticked = new Map(initial.map((file) => [file.documentId, file.variant] as const));
  // Which boxes are ticked now. The two ways of giving a file are closed for an unticked document
  // only once the page is running in the browser: without scripts they stay open, and the server
  // ignores a choice for a document whose box is not ticked.
  const [shared, setShared] = useState<ReadonlySet<string>>(
    () => new Set(initial.map((file) => file.documentId)),
  );
  const [running, setRunning] = useState(false);
  const groupRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    setRunning(true);
    const group = groupRef.current;
    const form = group?.form;
    if (!group || !form) return;
    // When the form is reset after an answer, start again from the boxes as the form shows them.
    const reseed = () =>
      window.setTimeout(() => {
        const ticked = Array.from(
          group.querySelectorAll<HTMLInputElement>(`input[name="${AI_FILE_FIELD}"]`),
        )
          .filter((box) => box.checked)
          .map((box) => box.value);
        setShared(new Set(ticked));
      }, 0);
    form.addEventListener('reset', reseed);
    return () => form.removeEventListener('reset', reseed);
  }, []);
  const fileError = invalid?.field === 'file' ? invalid.messageId : undefined;
  const ids = (...parts: (string | false | undefined)[]) =>
    parts.filter((part): part is string => typeof part === 'string').join(' ') || undefined;
  const storedVariant = new Map(stored.map((file) => [file.documentId, file.variant] as const));
  const groups: { readonly label: string; readonly documents: AiFileCandidateView[] }[] = [];
  for (const candidate of candidates) {
    const group = groups.find((item) => item.label === candidate.group);
    if (group) group.documents.push(candidate);
    else groups.push({ label: candidate.group, documents: [candidate] });
  }
  const describedBy = [
    noteId,
    protectedId,
    ...(available ? [] : [offId]),
    ...(invalid?.field === 'file' ? [invalid.messageId] : []),
  ].join(' ');
  return (
    <fieldset ref={groupRef} className="fieldset ai-file-choices" aria-describedby={describedBy}>
      <legend className="field-label">{AI_ORIGINAL_FILES_LABEL}</legend>
      <input type="hidden" name={AI_FILE_PRESENT_FIELD} value="1" />
      <p className="muted u-fs-075 u-m-0 ai-consent-warning" id={noteId}>
        {AI_ORIGINAL_FILES_NOTE} {AI_ORIGINAL_FILES_NEEDS_LIST}
      </p>
      <p className="muted u-fs-075 u-m-0" id={protectedId}>
        {AI_ORIGINAL_FILES_PROTECTED}
      </p>
      <p className="muted u-fs-075 u-m-0" id={originalNoteId}>
        {AI_ORIGINAL_NOTE}
      </p>
      {available ? null : (
        <p className="muted u-fs-075 u-m-0" id={offId}>
          {stored.length > 0 ? `${AI_FEATURE_OFF_HINT} ${AI_FILES_KEPT_NOTE}` : AI_FEATURE_OFF_HINT}
        </p>
      )}
      {candidates.length === 0 ? (
        <p className="muted u-fs-075 u-m-0">{AI_ORIGINAL_FILES_NONE}</p>
      ) : (
        // Each group sits behind its own expander (WP-SB4), so a long list of documents keeps the
        // screen short. A group opens by itself when one of its files is ticked or needs a look.
        groups.map((group, groupIndex) => (
          <CollapsibleGroup
            key={group.label}
            title={group.label}
            count={group.documents.length}
            noun={{ one: 'document', other: 'documents' }}
            open={
              fileError !== undefined ||
              group.documents.some((document) => ticked.has(document.documentId))
            }
          >
            <fieldset className="fieldset ai-file-group">
              <legend className="sr-only">{group.label}</legend>
              {group.documents.map((document, index) => {
                const rowId = `${id}-file-${groupIndex}-${index}`;
                const was = storedVariant.get(document.documentId);
                const chosen = ticked.get(document.documentId);
                // Off: only what is stored stays open; an Original only where one is stored.
                const boxOpen = available || was !== undefined;
                const originalOpen = available || was === 'ORIGINAL';
                const startsTicked = chosen !== undefined && boxOpen;
                const startsOriginal = chosen === 'ORIGINAL' && originalOpen;
                const isShared = boxOpen && (!running || shared.has(document.documentId));
                const name = document.referenceCode
                  ? `${document.kind} (${document.referenceCode})`
                  : document.kind;
                const notReadyId = document.safeCopyReady ? undefined : `${rowId}-not-ready`;
                const firstId = boxOpen && !isShared ? `${rowId}-first` : undefined;
                return (
                  <fieldset key={document.documentId} className="fieldset ai-file-choice">
                    <legend className="ai-file-name">{name}</legend>
                    <label className="check output-check" htmlFor={`${rowId}-share`}>
                      <input
                        id={`${rowId}-share`}
                        type="checkbox"
                        name={AI_FILE_FIELD}
                        value={document.documentId}
                        defaultChecked={startsTicked}
                        disabled={!boxOpen}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setShared((current) => {
                            const next = new Set(current);
                            if (checked) next.add(document.documentId);
                            else next.delete(document.documentId);
                            return next;
                          });
                        }}
                        aria-describedby={ids(notReadyId, !boxOpen && offId, fileError)}
                        {...(fileError ? { 'aria-invalid': true as const } : {})}
                      />
                      <span className="output-check-text">
                        <span>{AI_SHARE_FILE_LABEL}</span>
                      </span>
                    </label>
                    <div className="ai-file-ways">
                      <label className="check output-check" htmlFor={`${rowId}-safe`}>
                        <input
                          id={`${rowId}-safe`}
                          type="radio"
                          name={aiFileVariantField(document.documentId)}
                          value="SAFE_COPY"
                          defaultChecked={!startsOriginal}
                          disabled={!isShared}
                          aria-describedby={ids(notReadyId, firstId, !boxOpen && offId)}
                        />
                        <span className="output-check-text">
                          <span>{AI_SAFE_COPY_LABEL}</span>
                        </span>
                      </label>
                      <label className="check output-check" htmlFor={`${rowId}-original`}>
                        <input
                          id={`${rowId}-original`}
                          type="radio"
                          name={aiFileVariantField(document.documentId)}
                          value="ORIGINAL"
                          defaultChecked={startsOriginal}
                          disabled={!isShared || !originalOpen}
                          aria-describedby={ids(
                            originalNoteId,
                            originalOpen && firstId,
                            !originalOpen && offId,
                          )}
                        />
                        <span className="output-check-text">
                          <span>{AI_ORIGINAL_LABEL}</span>
                        </span>
                      </label>
                    </div>
                    {firstId ? (
                      <p className="muted u-fs-075 u-m-0" id={firstId}>
                        {AI_SHARE_FILE_FIRST}
                      </p>
                    ) : null}
                    {notReadyId ? (
                      <p className="muted u-fs-075 u-m-0" id={notReadyId}>
                        {AI_SAFE_COPY_NOT_READY}
                      </p>
                    ) : null}
                  </fieldset>
                );
              })}
            </fieldset>
          </CollapsibleGroup>
        ))
      )}
    </fieldset>
  );
}
