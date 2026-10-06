'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import {
  FormMessage,
  SubmitButton,
  fieldProblem,
  useFocusInvalidField,
} from '../../../../components/form-feedback';
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

/** A file size a person can read: "2.4 MB", "310 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
}

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

export function DocumentUploader({
  applicantId,
  limitLabel = '20 MB',
  virusScanning = false,
}: {
  readonly applicantId: string;
  /** The real per-file limit, so the help text never states a number the server does not enforce. */
  readonly limitLabel?: string;
  /** True only when a real virus scanner is switched on, so the page never claims one that is not. */
  readonly virusScanning?: boolean;
}) {
  const [state, formAction, pending] = useActionState(guardedUpload, INITIAL);
  const slow = useSlow(pending, SLOW_AFTER_MS);
  const messageId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<{ readonly name: string; readonly size: number } | null>(
    null,
  );
  useFocusInvalidField(formRef, state);

  return (
    <form ref={formRef} action={formAction} className="uploader">
      <input type="hidden" name="applicantId" value={applicantId} />
      <input
        name="file"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.md,image/png,image/jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        required
        className="input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          setPicked(file ? { name: file.name, size: file.size } : null);
        }}
        aria-label="Document file"
        {...fieldProblem(state, 'file', messageId)}
      />
      {picked ? (
        <output className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>
          Ready to upload: {picked.name} ({formatFileSize(picked.size)})
        </output>
      ) : null}
      <SubmitButton
        pending={pending}
        idle="Upload document"
        busy="Uploading…"
        className="btn btn-primary"
      />
      <FormMessage
        id={messageId}
        result={state}
        pending={pending}
        pendingText={slow ? UPLOADING_SLOW_TEXT : UPLOADING_TEXT}
      />
      <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        PDF, PNG, JPEG, DOCX, TXT or MD · up to {limitLabel} ·{' '}
        {virusScanning
          ? 'scanned for viruses on upload.'
          : 'file type and structure are checked on upload.'}
      </p>
      <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
        Stored privately. Only you and the people you choose to share with can open it.
      </p>
    </form>
  );
}
