'use client';

import { useRouter } from 'next/navigation';
import {
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { UndoStatus } from '../../../../../components/lifecycle/undo-status';
import { UpgradeLine } from '../../../../../components/upgrade-line';
import { formatFileSize } from '../../../../../lib/format-size';
import {
  type FolderReadResult,
  MAX_ENTRIES_LOOKED_AT,
  MAX_IMPORT_FILES,
  captureDrop,
  folderOf,
  folderPickerSupported,
  readChosenFiles,
  readDrop,
} from '../../../../../lib/import/folder-entries';
import { ImportManifest } from '../../../../../lib/import/import-manifest';
import {
  type ImportItem,
  ImportQueue,
  type ImportSnapshot,
  canTryAgain,
  countItems,
} from '../../../../../lib/import/import-queue';
import { uploadLimitsText } from '../../../../../lib/upload-rules';
import { UPLOAD_UNKNOWN_OUTCOME } from '../document-uploader';
import { deleteDuplicateAction, restoreDeletedAction } from '../documents/manage/delete/actions';
import { deletedLine } from '../documents/manage/delete/messages';

/** Lines drawn before Show All, so a long import stays quick to read and to scroll past. */
export const LINES_SHOWN_FIRST = 50;

const DEFAULT_LIMIT_BYTES = 4 * 1024 * 1024;

export const BUSY_LINE = 'We were too busy to take this file just now. Try again in a few minutes.';
export const EARLIER_ADDED_LINE = 'Already added in an earlier import, so it was not sent again.';
export const EARLIER_UNKNOWN_LINE = 'This is from an earlier import, so it was not sent again.';
export const FOLDER_FALLBACK_LINE =
  'This browser cannot choose a whole folder. Choose the files instead, or drop the folder into the box.';

const SKIP_LINES = {
  hidden: 'Hidden and system files are left out.',
  'over-limit': `One import takes up to ${MAX_IMPORT_FILES} files. Add this one in another import once this one has finished.`,
  stopped: 'The import was stopped before this file was sent.',
  unreadable: 'This file could not be read from the folder. Try adding it on its own.',
} as const;

/** The summary line: "Importing: 62 Added, 3 Need a Look, 2 Not Supported, 15 Waiting." */
export function importSummary(snapshot: ImportSnapshot): string {
  const { items, paused } = snapshot;
  if (items.length === 0) return '';
  const counts = countItems(items);
  const parts = [
    counts.added > 0 ? `${counts.added} Added` : '',
    counts.needLook > 0 ? `${counts.needLook} Need a Look` : '',
    counts.notSupported > 0 ? `${counts.notSupported} Not Supported` : '',
    counts.skipped > 0 ? `${counts.skipped} Left Out` : '',
    counts.waiting > 0 ? `${counts.waiting} Waiting` : '',
  ].filter(Boolean);
  const lead = paused ? 'Paused' : counts.waiting > 0 ? 'Importing' : 'Import finished';
  return `${lead}: ${parts.join(', ')}.`;
}

/** What a line says about its file. */
export function importLine(item: ImportItem): { readonly flag: string; readonly text: string } {
  switch (item.state) {
    case 'queued':
      return {
        flag: '',
        text: item.waitingToRetry
          ? 'Busy just now. Trying again in a moment.'
          : 'Waiting to upload.',
      };
    case 'paused':
      return { flag: '', text: 'Paused. It will upload when you resume.' };
    case 'uploading':
      return {
        flag: '',
        text:
          item.progress >= 100
            ? 'Sent. Checking the file.'
            : `Uploading, ${item.progress}% sent. Please keep this page open.`,
      };
    case 'added':
    case 'duplicate':
      return { flag: '', text: item.earlier ? EARLIER_ADDED_LINE : item.message };
    case 'refused':
      return { flag: 'Not added. ', text: item.busy ? BUSY_LINE : item.message };
    case 'unknown':
      return {
        flag: 'Not confirmed. ',
        text: item.earlier
          ? `${UPLOAD_UNKNOWN_OUTCOME} ${EARLIER_UNKNOWN_LINE}`
          : UPLOAD_UNKNOWN_OUTCOME,
      };
    case 'unsupported':
      return { flag: 'Not added. ', text: item.message };
    case 'skipped':
      return {
        flag: item.skipReason === 'hidden' ? 'Left out. ' : 'Not added. ',
        text: SKIP_LINES[item.skipReason ?? 'stopped'],
      };
  }
}

/** The colour hook the uploader's lines already use. */
function lineStatus(item: ImportItem): string {
  if (item.state === 'added' || item.state === 'duplicate') return 'added';
  if (item.state === 'refused' || item.state === 'unsupported') return 'refused';
  if (item.state === 'unknown') return 'unknown';
  if (item.state === 'skipped' && item.skipReason !== 'hidden') return 'not_sent';
  return 'waiting';
}

type Removal = 'busy' | { readonly days: number } | { readonly problem: string };

/**
 * Batch and folder import (UMPE P2): a whole folder (with the folders inside it, where the browser
 * allows) or hundreds of files, each with its own line and an honest final state. Every file goes
 * through the same upload as a single file, a few at a time; nothing past the limit is dropped
 * without a line saying so; Pause, Resume, Stop and Try Again are always at hand.
 */
export function ImportPanel({
  applicantId,
  limitBytes = DEFAULT_LIMIT_BYTES,
  limitLabel = '4 MB',
  pdfAccepted = false,
}: {
  readonly applicantId: string;
  /** The largest file accepted, in bytes (the same limit the single upload uses). */
  readonly limitBytes?: number;
  /** The same limit as people read it ("4 MB"). */
  readonly limitLabel?: string;
  /** True only when PDF files are admitted (they need a real virus scanner). */
  readonly pdfAccepted?: boolean;
}) {
  const router = useRouter();
  const limitsId = useId();
  const dropTitleId = useId();
  const dropHintId = useId();
  const listId = useId();
  const manifest = useRef<ImportManifest | null>(null);
  const addedSinceRefresh = useRef(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [queue] = useState(
    () =>
      new ImportQueue({
        applicantId,
        rules: { limitBytes, limitLabel, pdfAccepted },
        earlierState: (file) => manifest.current?.earlierState(file) ?? null,
        onSettled: (item) => {
          if (item.state === 'added' || item.state === 'duplicate') {
            addedSinceRefresh.current = true;
          }
          manifest.current?.record(item);
        },
      }),
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [earlierAdded, setEarlierAdded] = useState(0);
  const [removals, setRemovals] = useState<ReadonlyMap<number, Removal>>(new Map());

  // The saved list is read in the browser only, after the first paint, so the page is the same
  // with or without it.
  useEffect(() => {
    const saved = new ImportManifest(applicantId);
    manifest.current = saved;
    setEarlierAdded(
      saved.list().filter((entry) => entry.state === 'added' || entry.state === 'duplicate').length,
    );
  }, [applicantId]);

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const busy = snapshot.items.some((item) => item.state === 'queued' || item.state === 'uploading');
  useEffect(() => {
    if (!busy && addedSinceRefresh.current) {
      addedSinceRefresh.current = false;
      router.refresh();
    }
  }, [busy, router]);

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

  const take = useCallback(
    (result: FolderReadResult) => {
      if (result.truncated) setTruncated(true);
      queue.add(result.files, result.skipped);
    },
    [queue],
  );

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
    setNotice('');
    // Taken now: the browser empties the drop once this handler returns.
    const captured = captureDrop(event.dataTransfer);
    setReading(true);
    void readDrop(captured)
      .then(take)
      .catch(() => setNotice('We could not read what was dropped. Try choosing it instead.'))
      .finally(() => setReading(false));
  };

  const chooseFolder = () => {
    setNotice('');
    if (folderPickerSupported(folderRef.current)) {
      folderRef.current?.click();
      return;
    }
    setNotice(FOLDER_FALLBACK_LINE);
    filesRef.current?.click();
  };

  const removeCopy = async (item: ImportItem) => {
    const id = item.removableCopyId;
    if (!id || removals.get(item.id) === 'busy') return;
    const set = (value: Removal) => setRemovals((current) => new Map(current).set(item.id, value));
    set('busy');
    try {
      const removed = await deleteDuplicateAction(applicantId, id, true);
      if (!removed.ok) {
        set({ problem: removed.message });
        return;
      }
      set({ days: removed.days });
      router.refresh();
    } catch {
      set({ problem: 'We could not remove it. Check your connection and try again.' });
    }
  };

  const { items, paused } = snapshot;
  const counts = countItems(items);
  const pending = counts.waiting > 0;
  const visible = showAll ? items : items.slice(0, LINES_SHOWN_FIRST);
  const status = [notice, reading ? 'Reading the folder.' : '', importSummary(snapshot)]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="uploader import-panel">
      <p className="uploader-limits" id={limitsId}>
        {uploadLimitsText(limitLabel, pdfAccepted)} Up to {MAX_IMPORT_FILES} files in one import.
      </p>
      {earlierAdded > 0 && items.length === 0 ? (
        <div className="import-earlier">
          <p className="field-hint">
            Your last import here added {earlierAdded} {earlierAdded === 1 ? 'file' : 'files'}. To
            finish it, add the same folder again: files already added are not sent again.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              manifest.current?.clear();
              setEarlierAdded(0);
            }}
          >
            Forget the Earlier Import
          </button>
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
          Drop a Folder or Many Files Here
        </p>
        <p className="upload-drop-hint" id={dropHintId}>
          Folders inside it are included. You do not need to say what each file is first. Each file
          gets its own line below.
        </p>
        <div className="upload-drop-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-describedby={limitsId}
            onClick={chooseFolder}
          >
            Add a Folder
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-describedby={limitsId}
            onClick={() => {
              setNotice('');
              filesRef.current?.click();
            }}
          >
            Choose Many Files
          </button>
        </div>
      </section>
      <input
        ref={folderRef}
        className="sr-only"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Folder to Import"
        data-testid="import-folder"
        onChange={(event) => {
          take(readChosenFiles(Array.from(event.currentTarget.files ?? [])));
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={filesRef}
        className="sr-only"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Files to Import"
        data-testid="import-files"
        onChange={(event) => {
          take(readChosenFiles(Array.from(event.currentTarget.files ?? [])));
          event.currentTarget.value = '';
        }}
      />

      <output className="upload-summary">{status}</output>
      {truncated ? (
        <p className="field-hint">
          This folder holds more than {MAX_ENTRIES_LOOKED_AT.toLocaleString('en-GB')} files. Only
          the first {MAX_IMPORT_FILES} can be added in one import; the rest were not looked at.
        </p>
      ) : null}

      {pending ? (
        <div className="import-controls">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => (paused ? queue.resume() : queue.pause())}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => queue.stop()}>
            Stop
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="upload-list" id={listId} aria-label="Files in This Import">
          {visible.map((item) => {
            const { flag, text } = importLine(item);
            const folder = folderOf(item.path);
            const removal = removals.get(item.id);
            return (
              <li
                key={item.id}
                className="upload-item"
                data-status={lineStatus(item)}
                data-state={item.state}
              >
                <div className="upload-item-head">
                  <span className="upload-item-name">{item.name}</span>
                  {item.size !== null ? (
                    <span className="upload-item-size">{formatFileSize(item.size)}</span>
                  ) : null}
                </div>
                {folder ? <p className="import-item-path">In {folder}</p> : null}
                {item.state === 'uploading' ? (
                  <progress
                    className="upload-progress"
                    max={100}
                    value={item.progress}
                    aria-label={`Upload of ${item.name}`}
                  />
                ) : null}
                {(item.state === 'added' || item.state === 'duplicate') && item.title ? (
                  <p className="upload-item-title">Added as {item.title}</p>
                ) : null}
                <p className={`upload-item-status${flag ? ' field-msg-err' : ''}`}>
                  {flag ? <span className="upload-item-flag">{flag}</span> : null}
                  {text}
                  {item.state === 'refused' && item.upgrade ? (
                    <>
                      {' '}
                      <UpgradeLine kind={item.upgrade} />
                    </>
                  ) : null}
                </p>
                {item.state === 'duplicate' && item.removableCopyId && !item.earlier ? (
                  removal && typeof removal === 'object' && 'days' in removal ? (
                    <UndoStatus
                      message={deletedLine(removal.days)}
                      onUndo={async () => {
                        const id = item.removableCopyId;
                        if (!id) return;
                        const restored = await restoreDeletedAction(applicantId, id, 'UNDO');
                        if (!restored.ok) throw new Error(restored.message);
                        router.refresh();
                      }}
                      undoneMessage="Restored. The new copy is back in your documents."
                    />
                  ) : (
                    <div className="lc-new-copy">
                      <p className="lc-new-copy-line">
                        You already keep an identical copy of this file.
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        aria-disabled={removal === 'busy' || undefined}
                        aria-label={`Remove This New Copy: ${item.name}`}
                        onClick={removal === 'busy' ? undefined : () => void removeCopy(item)}
                      >
                        {removal === 'busy' ? 'Removing' : 'Remove This New Copy'}
                      </button>
                      {removal && typeof removal === 'object' && 'problem' in removal ? (
                        <p className="field-msg-err" role="alert">
                          {removal.problem}
                        </p>
                      ) : null}
                    </div>
                  )
                ) : null}
                {canTryAgain(item) ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={`Try Again: ${item.name}`}
                    onClick={() => queue.retry(item.id)}
                  >
                    Try Again
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {items.length > LINES_SHOWN_FIRST ? (
        <button
          type="button"
          className="btn btn-secondary"
          aria-controls={listId}
          aria-expanded={showAll}
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? 'Show Fewer' : `Show All ${items.length}`}
        </button>
      ) : null}
      {items.length > 0 && !pending ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            queue.clearFinished();
            setEarlierAdded(
              (manifest.current?.list() ?? []).filter(
                (entry) => entry.state === 'added' || entry.state === 'duplicate',
              ).length,
            );
            setShowAll(false);
            setTruncated(false);
            setRemovals(new Map());
          }}
        >
          Clear the List
        </button>
      ) : null}
      <p className="muted uploader-note">
        Each file is stored privately and checked when it arrives, exactly as a single upload is.
        Only you and the people you choose to share with can open it.
      </p>
    </div>
  );
}
