'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
import { formatFileSize } from '../../../../lib/format-size';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { SLOW_AFTER_MS, guardNetwork } from '../../../../lib/resilience';
import { type ActionState, uploadDocumentAction } from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * What the form says when the request never got an answer (a dropped connection, a
 * tunnel, a closed laptop). The file may well have arrived, so it does not say "failed";
 * it says where to look first, so nobody uploads the same file twice just because the
 * page went quiet.
 */
export const UPLOAD_UNKNOWN_OUTCOME =
  'We could not confirm whether your upload finished. Check the list of documents below before uploading again. If the file is not there, choose it again and retry.';

export const UPLOADING_TEXT =
  'Uploading. Larger files can take a minute. Please keep this page open.';
export const UPLOADING_SLOW_TEXT =
  'Still uploading. This is taking longer than usual. Please keep this page open, or check the list of documents below before trying again.';

const guardedUpload = guardNetwork(uploadDocumentAction, UPLOAD_UNKNOWN_OUTCOME);

/** True once `active` has been true for `afterMs`: how a form notices a request is slow. */
function useSlow(active: boolean, afterMs: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [active, afterMs]);
  return slow;
}

/** The catalogue's "Other ..." kinds, the only ones that carry a name written by the person. */
const isOtherKind = (key: string): boolean => key === 'OTHER' || key.startsWith('OTHER_');

export function DocumentUploader({
  applicantId,
  virusScanning = false,
  kindGroups = [],
  initialKind = '',
  originalKinds = [],
}: {
  readonly applicantId: string;
  /**
   * The kinds of document a person can pick, grouped as the catalogue groups them, built on the server.
   * Choosing one when uploading files the document under the right sharing category from the start.
   */
  readonly kindGroups?: readonly ChoiceGroup[];
  /** A kind chosen before the form opened, for example from a profile section's Upload link. */
  readonly initialKind?: string;
  /** Kinds embassies usually want handed in as the original. */
  readonly originalKinds?: readonly string[];
  /**
   * The configured per-file limit. Not shown to people for now: the website host may refuse a large
   * file before the app sees it, so a number here could be wrong. It returns once an upload test on
   * the live host has proven it.
   */
  readonly limitLabel?: string;
  /** True only when a real virus scanner is switched on, so the page never claims one that is not. */
  readonly virusScanning?: boolean;
}) {
  const [state, formAction, pending] = useActionState(guardedUpload, INITIAL);
  const slow = useSlow(pending, SLOW_AFTER_MS);
  const messageId = useId();
  const kindId = useId();
  const kindNameId = useId();
  const [kind, setKind] = useState(initialKind);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Set by the camera button so the next file picker opens the phone camera, then cleared. */
  const cameraNext = useRef(false);
  const [picked, setPicked] = useState<{ readonly name: string; readonly size: number } | null>(
    null,
  );
  useFocusInvalidField(formRef, state);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="uploader"
      onReset={() => {
        setKind('');
        setPicked(null);
      }}
    >
      <input type="hidden" name="applicantId" value={applicantId} />
      <input
        ref={fileRef}
        name="file"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.md,image/png,image/jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        required
        className="input"
        onClick={(event) => {
          // Only the camera button asks for the camera; choosing a file the usual way never does.
          if (cameraNext.current) {
            event.currentTarget.setAttribute('capture', 'environment');
            cameraNext.current = false;
          } else {
            event.currentTarget.removeAttribute('capture');
          }
        }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          setPicked(file ? { name: file.name, size: file.size } : null);
        }}
        aria-label="Document file"
        {...fieldProblem(state, 'file', messageId)}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          cameraNext.current = true;
          fileRef.current?.click();
        }}
      >
        Take a Photo
      </button>
      {picked ? (
        <output className="muted" style={{ display: 'block', fontSize: 'var(--text-small)' }}>
          Ready to upload: {picked.name} ({formatFileSize(picked.size)})
        </output>
      ) : null}
      {kindGroups.length > 0 ? (
        <div className="document-type-form">
          <label className="muted u-fs-075" htmlFor={kindId}>
            Kind of Document (Optional)
          </label>
          <select
            id={kindId}
            name="docType"
            className="input"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value)}
            {...fieldProblem(state, 'docType', messageId)}
          >
            <option value="">Not sure yet</option>
            {kindGroups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.choices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {isOtherKind(kind) ? (
            <>
              <label className="muted u-fs-075" htmlFor={kindNameId}>
                What is it?
              </label>
              <input
                id={kindNameId}
                name="subject"
                type="text"
                maxLength={120}
                className="input"
                placeholder="For example: Marriage Certificate"
              />
            </>
          ) : null}
          <p className="muted u-fs-075">
            Choosing it now files the document under the right sharing category. You can change it
            later.
          </p>
          {originalKinds.includes(kind) ? (
            <p className="muted u-fs-075" data-testid="original-needed-note">
              Embassies usually want this handed in as the original when you apply. Upload a clear
              scan or photo here so it is ready to share, and keep the original safe.
            </p>
          ) : null}
        </div>
      ) : null}
      <SubmitButton
        pending={pending}
        idle="Upload Document"
        busy="Uploading…"
        className="btn btn-primary"
      />
      <FormMessage
        id={messageId}
        result={state}
        pending={pending}
        pendingText={slow ? UPLOADING_SLOW_TEXT : UPLOADING_TEXT}
      />
      <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
        PDF, PNG, JPEG, DOCX, TXT or MD ·{' '}
        {virusScanning
          ? 'scanned for viruses on upload.'
          : 'file type and structure are checked on upload.'}
      </p>
      <p className="muted" style={{ fontSize: 'var(--text-small)', margin: 0 }}>
        Stored privately. Only you and the people you choose to share with can open it.
      </p>
    </form>
  );
}
