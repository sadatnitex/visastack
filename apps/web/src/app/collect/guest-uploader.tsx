'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useT } from '../../components/i18n-provider';
import { collectCatalog } from '../../i18n/collect';
import { formatFileSize } from '../../lib/format-size';
import { captureDrop, readChosenFiles, readDrop } from '../../lib/import/folder-entries';
import {
  type ImportItem,
  ImportQueue,
  canTryAgain,
  countItems,
} from '../../lib/import/import-queue';
import { useDropZone } from '../../lib/import/use-drop-zone';
import { sendGuestFile } from './guest-upload-client';

const LIMIT_BYTES = 4 * 1024 * 1024;

/** What one line says about its file while it is on its way. */
export function guestLine(item: ImportItem): string {
  switch (item.state) {
    case 'queued':
      return item.waitingToRetry
        ? 'Busy just now. Trying again in a moment.'
        : 'Waiting to upload.';
    case 'paused':
      return 'Paused.';
    case 'uploading':
      return `Uploading, ${item.progress}%.`;
    case 'added':
    case 'duplicate':
      return 'Added and checked.';
    case 'refused':
    case 'unsupported':
      return item.message || 'This file cannot be added.';
    case 'unknown':
      return 'We could not confirm this file arrived. Choose Try Again: it will not be added twice.';
    case 'held':
      return 'Not added yet: too many files were added just now. Try again later.';
    case 'skipped':
      return item.skipReason === 'hidden'
        ? 'Hidden and system files are left out.'
        : item.skipReason === 'repeat'
          ? 'Already in this batch, so it was not sent twice.'
          : 'Not sent.';
    default:
      return '';
  }
}

/** The counts, in words. */
export function guestCountsText(items: Iterable<ImportItem>): string {
  const counts = countItems(items);
  if (counts.total === 0) return 'No files chosen yet.';
  const parts = [
    `${counts.added} Added`,
    counts.needLook + counts.notSupported > 0
      ? `${counts.needLook + counts.notSupported} Need a Look`
      : '',
    counts.waiting > 0 ? `${counts.waiting} Waiting` : '',
  ].filter(Boolean);
  return `${counts.waiting > 0 ? 'Uploading' : 'Finished'}: ${parts.join(', ')}.`;
}

/**
 * Add files to the request (UMPE P9): many at once, a whole folder where the browser allows, or a
 * drop. Each file goes in its own request through the guest upload route by the same P2 queue the
 * vault import uses (two at a time, a state for every file, waits on busy answers, never a hidden
 * second copy: the server keeps each file's upload id). The list of kept files below is the
 * server's, refreshed as files settle.
 */
export function GuestUploader({ pdfAccepted }: { readonly pdfAccepted: boolean }) {
  const t = useT(collectCatalog);
  const router = useRouter();
  const inputId = useId();
  const statusId = useId();
  const filesRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Settled files show in the server's list below; one refresh covers a burst of them.
  const refreshSoon = useRef(() => {});
  refreshSoon.current = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, 800);
  };
  const [queue] = useState(
    () =>
      new ImportQueue({
        applicantId: '',
        rules: { limitBytes: LIMIT_BYTES, limitLabel: '4 MB', pdfAccepted },
        send: (request) => sendGuestFile(request),
        retryUnknown: true,
        onSettled: () => refreshSoon.current(),
      }),
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const items = snapshot.order.flatMap((id) => {
    const item = snapshot.byId.get(id);
    return item ? [item] : [];
  });
  const pending = items.filter((item) => item.state !== 'added' && item.state !== 'duplicate');

  const addFiles = useCallback(
    (files: readonly File[]) => {
      const read = readChosenFiles(files);
      void queue.add(read.files, read.skipped);
    },
    [queue],
  );
  const drop = useDropZone((transfer) => {
    const captured = captureDrop(transfer);
    void readDrop(captured).then((read) => queue.add(read.files, read.skipped));
  });

  return (
    <section className="collect-upload" aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="collect-step-title">
        {t('collect.collectGuestUploader.addYourFiles')}
      </h2>
      <div
        className={`collect-drop${drop.dragging ? ' collect-drop-active' : ''}`}
        {...drop.handlers}
      >
        <p>{t('collect.collectGuestUploader.dropFilesOrAFolderHere')}</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => filesRef.current?.click()}
        >
          {t('collect.collectGuestUploader.chooseFiles')}
        </button>
        <input
          ref={filesRef}
          className="sr-only"
          type="file"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          aria-label={t('collect.collectGuestUploader.filesToAdd')}
          accept={`${pdfAccepted ? 'application/pdf,' : ''}image/jpeg,image/png,image/heic,image/heif`}
          onChange={(event) => {
            addFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = '';
          }}
        />
        <p className="muted u-fs-085">
          {pdfAccepted ? 'PDF, JPG or PNG' : 'JPG or PNG'}, up to 4 MB each. Each file is checked
          before it can be sent.
        </p>
      </div>
      <output id={statusId} className="collect-upload-status">
        {guestCountsText(items)}
      </output>
      {pending.length > 0 ? (
        <ul className="collect-upload-lines">
          {pending.map((item) => (
            <li key={item.id} className="collect-upload-line">
              <span className="collect-file-name">{item.name}</span>
              <span className="muted u-fs-085">
                {item.size !== null ? `${formatFileSize(item.size)} · ` : ''}
                {guestLine(item)}
              </span>
              {canTryAgain(item) ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => queue.retry(item.id)}
                >
                  {t('collect.collectGuestUploader.tryAgainForName', { name: item.name })}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
