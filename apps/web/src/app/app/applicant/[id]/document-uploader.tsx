'use client';

import { isOtherDocumentType } from '@visastack/core';
import { useRouter } from 'next/navigation';
import { type DragEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { type UploadOutcome, sendDocumentFile } from '../../../../lib/document-upload-client';
import { formatFileSize } from '../../../../lib/format-size';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { acceptAttribute, checkChosenFile, uploadLimitsText } from '../../../../lib/upload-rules';

/**
 * What a file's line says when its request never got an answer (a dropped connection, a tunnel,
 * a closed laptop). The file may well have arrived, so it does not say "failed"; it says where to
 * look first, so nobody uploads the same file twice just because the page went quiet.
 */
export const UPLOAD_UNKNOWN_OUTCOME =
  'We could not confirm whether this upload finished. Check the list of documents below before uploading it again. If it is not there, try again.';

/** Files taken in one go; more are listed as not added, so one drop cannot queue hundreds. */
export const MAX_FILES_AT_ONCE = 20;

/** The configured per-file limit when none is passed (one request to the host carries 4 MB). */
const DEFAULT_LIMIT_BYTES = 4 * 1024 * 1024;

type ItemStatus = 'waiting' | 'sending' | 'checking' | 'added' | 'refused' | 'unknown' | 'not_sent';

interface UploadItem {
  readonly id: number;
  readonly file: File | null;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly docType: string;
  readonly subject: string;
  readonly status: ItemStatus;
  /** Share sent, 0 to 100, while sending. */
  readonly progress: number;
  /** The server's line, or why the file was not sent. */
  readonly message: string;
  /** The name the document is listed under, once added. */
  readonly title: string | null;
}

const ACTIVE: ReadonlySet<ItemStatus> = new Set(['waiting', 'sending', 'checking']);
const RETRYABLE: ReadonlySet<ItemStatus> = new Set(['refused', 'unknown']);

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;

/** The one polite announcement for the whole list: which file is going, then how the batch went. */
export function uploadSummary(items: readonly Pick<UploadItem, 'status' | 'name'>[]): string {
  if (items.length === 0) return '';
  const current = items.find((item) => item.status === 'sending' || item.status === 'checking');
  const active = items.filter((item) => ACTIVE.has(item.status)).length;
  if (active > 0) {
    // Counted among the files that go out; ones refused on the spot are not in the count.
    const queue = items.filter((item) => item.status !== 'not_sent');
    const position = queue.length - active + 1;
    return `Uploading ${position} of ${queue.length}${current ? `: ${current.name}` : ''}.`;
  }
  const added = items.filter((item) => item.status === 'added').length;
  const notAdded = items.length - added;
  if (notAdded === 0) return `${files(added)} added.`;
  const problem = `${files(notAdded)} not added; the list says why.`;
  return added > 0 ? `${files(added)} added. ${problem}` : problem;
}

function statusLine(item: UploadItem): string {
  switch (item.status) {
    case 'waiting':
      return 'Waiting to upload.';
    case 'sending':
      return `Uploading, ${item.progress}% sent. Please keep this page open.`;
    case 'checking':
      return 'Sent. Checking the file.';
    case 'added':
      return item.message;
    case 'unknown':
      return UPLOAD_UNKNOWN_OUTCOME;
    default:
      return item.message;
  }
}

function outcomeToItem(outcome: UploadOutcome): Partial<UploadItem> {
  if (outcome.kind === 'added') {
    return { status: 'added', message: outcome.message, title: outcome.title };
  }
  if (outcome.kind === 'refused') return { status: 'refused', message: outcome.message };
  return { status: 'unknown', message: '' };
}

export function DocumentUploader({
  applicantId,
  limitBytes = DEFAULT_LIMIT_BYTES,
  limitLabel = '4 MB',
  pdfAccepted = false,
  virusScanning = false,
  kindGroups = [],
  initialKind = '',
  originalKinds = [],
}: {
  readonly applicantId: string;
  /** The largest file accepted, in bytes: the per-file quota, never more than one request carries. */
  readonly limitBytes?: number;
  /** The same limit as people read it ("4 MB"). */
  readonly limitLabel?: string;
  /** True only when PDF files are admitted (they need a real virus scanner). */
  readonly pdfAccepted?: boolean;
  /** True only when a real virus scanner is switched on, so the page never claims one that is not. */
  readonly virusScanning?: boolean;
  /**
   * The kinds of document a person can pick, grouped as the catalogue groups them, built on the server.
   * Choosing one when uploading files the document under the right sharing category from the start.
   */
  readonly kindGroups?: readonly ChoiceGroup[];
  /** A kind chosen before the form opened, for example from a profile section's Upload link. */
  readonly initialKind?: string;
  /** Kinds embassies usually want handed in as the original. */
  readonly originalKinds?: readonly string[];
}) {
  const router = useRouter();
  const limitsId = useId();
  const dropTitleId = useId();
  const dropHintId = useId();
  const kindId = useId();
  const kindNameId = useId();
  const kindHintId = useId();
  const [kind, setKind] = useState(initialKind);
  const [kindName, setKindName] = useState('');
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const running = useRef(false);
  const addedSinceRefresh = useRef(false);

  const update = useCallback((id: number, change: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const addFiles = (chosen: readonly File[]) => {
    if (chosen.length === 0) return;
    const rules = { limitBytes, limitLabel, pdfAccepted };
    const docType = kind;
    const subject = isOtherDocumentType(kind) ? kindName.trim() : '';
    const added = chosen.map((file, index): UploadItem => {
      const check = checkChosenFile(file, rules);
      const base = {
        id: nextId.current++,
        name: file.name || 'Photo',
        size: file.size,
        docType,
        subject,
        progress: 0,
        title: null,
      };
      if (index >= MAX_FILES_AT_ONCE) {
        return {
          ...base,
          file: null,
          contentType: '',
          status: 'not_sent',
          message: `Add up to ${MAX_FILES_AT_ONCE} files at a time. Add this one again once these have finished.`,
        };
      }
      return check.ok
        ? { ...base, file, contentType: check.contentType, status: 'waiting', message: '' }
        : { ...base, file: null, contentType: '', status: 'not_sent', message: check.reason };
    });
    setItems((current) => [...current, ...added]);
    // The kind chosen applies to the files just added; the next ones start from Not Sure Yet,
    // so a second batch is never filed under the first one's kind by accident.
    setKind('');
    setKindName('');
  };

  // One file at a time, in the order they were added.
  useEffect(() => {
    if (running.current) return;
    const next = items.find((item) => item.status === 'waiting');
    if (!next?.file) {
      if (!items.some((item) => ACTIVE.has(item.status)) && addedSinceRefresh.current) {
        addedSinceRefresh.current = false;
        router.refresh();
      }
      return;
    }
    running.current = true;
    const file = next.file;
    update(next.id, { status: 'sending', progress: 0 });
    void sendDocumentFile({
      applicantId,
      file,
      contentType: next.contentType,
      docType: next.docType,
      subject: next.subject,
      onProgress: (fraction) =>
        update(
          next.id,
          fraction >= 1
            ? { status: 'checking', progress: 100 }
            : { progress: Math.min(99, Math.floor(fraction * 100)) },
        ),
    })
      .catch((): UploadOutcome => ({ kind: 'unknown' }))
      .then((outcome) => {
        if (outcome.kind === 'added') addedSinceRefresh.current = true;
        running.current = false;
        update(next.id, outcomeToItem(outcome));
      });
  }, [items, applicantId, router, update]);

  // A file dropped beside the box would make the browser leave the page and drop the list.
  useEffect(() => {
    const keep = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', keep);
    window.addEventListener('drop', keep);
    return () => {
      window.removeEventListener('dragover', keep);
      window.removeEventListener('drop', keep);
    };
  }, []);

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    setDragging(false);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const finished = items.length > 0 && !items.some((item) => ACTIVE.has(item.status));

  return (
    <div className="uploader">
      <p className="uploader-limits" id={limitsId}>
        {uploadLimitsText(limitLabel, pdfAccepted)}
      </p>
      {kindGroups.length > 0 ? (
        <div className="field-stack">
          <label className="field-label" htmlFor={kindId}>
            Kind of Document (Optional)
          </label>
          <select
            id={kindId}
            name="docType"
            className="input"
            value={kind}
            aria-describedby={kindHintId}
            onChange={(event) => setKind(event.currentTarget.value)}
          >
            <option value="">Not Sure Yet</option>
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
          {isOtherDocumentType(kind) ? (
            <>
              <label className="field-label" htmlFor={kindNameId}>
                Name for an Other Type
              </label>
              <input
                id={kindNameId}
                name="subject"
                type="text"
                maxLength={120}
                className="input"
                value={kindName}
                onChange={(event) => setKindName(event.currentTarget.value)}
                placeholder="For example: Marriage Certificate"
              />
            </>
          ) : null}
          <p className="field-hint" id={kindHintId}>
            Applies to the files you add next: it files them under the right sharing category and
            names them, for example Passport and your first name. You can change both later.
          </p>
          {originalKinds.includes(kind) ? (
            <p className="muted u-fs-075" data-testid="original-needed-note">
              Embassies usually want this handed in as the original when you apply. Upload a clear
              scan or photo here so it is ready to share, and keep the original safe.
            </p>
          ) : null}
        </div>
      ) : null}

      <section
        className="upload-drop"
        data-dragging={dragging ? 'true' : undefined}
        aria-labelledby={dropTitleId}
        aria-describedby={dropHintId}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <p className="upload-drop-title" id={dropTitleId}>
          Drop Files Here
        </p>
        <p className="upload-drop-hint" id={dropHintId}>
          Drag one or more files into this box, or use a button. Each file gets its own line below.
        </p>
        <div className="upload-drop-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-describedby={limitsId}
            onClick={() => pickerRef.current?.click()}
          >
            Choose Files
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => cameraRef.current?.click()}
          >
            Take a Photo
          </button>
        </div>
      </section>
      <input
        ref={pickerRef}
        className="sr-only"
        type="file"
        multiple
        accept={acceptAttribute(pdfAccepted)}
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Document Files"
        data-testid="document-files"
        onChange={(event) => {
          addFiles(Array.from(event.currentTarget.files ?? []));
          // Cleared so choosing the same file again (after fixing it) is noticed.
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={cameraRef}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Camera Photo"
        data-testid="camera-photo"
        onChange={(event) => {
          addFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />

      <output className="upload-summary">{uploadSummary(items)}</output>
      {items.length > 0 ? (
        <ul className="upload-list" aria-label="Files Being Added">
          {items.map((item) => {
            const failed =
              item.status === 'refused' || item.status === 'unknown' || item.status === 'not_sent';
            return (
              <li key={item.id} className="upload-item" data-status={item.status}>
                <div className="upload-item-head">
                  <span className="upload-item-name">{item.name}</span>
                  <span className="upload-item-size">{formatFileSize(item.size)}</span>
                </div>
                {item.status === 'sending' || item.status === 'checking' ? (
                  <progress
                    className="upload-progress"
                    max={100}
                    value={item.progress}
                    aria-label={`Upload of ${item.name}`}
                  />
                ) : null}
                {item.status === 'added' && item.title ? (
                  <p className="upload-item-title">Added as {item.title}</p>
                ) : null}
                <p className={`upload-item-status${failed ? ' field-msg-err' : ''}`}>
                  {failed ? (
                    <span className="upload-item-flag">
                      {item.status === 'unknown' ? 'Not confirmed. ' : 'Not added. '}
                    </span>
                  ) : null}
                  {statusLine(item)}
                </p>
                {RETRYABLE.has(item.status) ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={`Try Again: ${item.name}`}
                    onClick={() => update(item.id, { status: 'waiting', progress: 0, message: '' })}
                  >
                    Try Again
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {finished ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setItems((current) => current.filter((item) => ACTIVE.has(item.status)))}
        >
          Clear the List
        </button>
      ) : null}
      <p className="muted uploader-note">
        {virusScanning
          ? 'Each file is scanned for viruses when it arrives.'
          : 'Each file’s type and structure are checked when it arrives.'}{' '}
        iPhone photos (HEIC) are saved as JPG copies so they open anywhere.
      </p>
      <p className="muted uploader-note">
        Stored privately. Only you and the people you choose to share with can open it.
      </p>
    </div>
  );
}
