'use client';

import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { UndoStatus } from '../../../../../components/lifecycle/undo-status';
import { UpgradeLine } from '../../../../../components/upgrade-line';
import { newUploadId } from '../../../../../lib/document-upload-client-id';
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
import { ImportManifest, sha256Hex } from '../../../../../lib/import/import-manifest';
import {
  type ImportCounts,
  type ImportItem,
  ImportQueue,
  canSendAgain,
  canTryAgain,
  countItems,
  fingerprintOf,
  sendThroughHoldRoute,
  sendThroughUploadRoute,
  uploadIdFromHash,
} from '../../../../../lib/import/import-queue';
import { useDropZone } from '../../../../../lib/import/use-drop-zone';
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
export const HELD_LINE = 'Not added yet. Use Try Again for All Paused Files once the hour is up.';
export const FOLDER_FALLBACK_LINE =
  'This browser cannot choose a whole folder. Choose the files instead, or drop the folder into the box.';

const SKIP_LINES = {
  hidden: 'Hidden and system files are left out.',
  'over-limit': `One import takes up to ${MAX_IMPORT_FILES} files. Add this one in another import once this one has finished.`,
  stopped: 'The import was stopped before this file was sent.',
  unreadable: 'This file could not be read from the folder. Try adding it on its own.',
  repeat: 'Already in this import, so it was not sent twice.',
} as const;

/** The full counts, in words that stay on the page (not read out on every change). */
export function importCountsText(counts: ImportCounts, paused: boolean): string {
  if (counts.total === 0) return 'Nothing added yet.';
  const parts = [
    counts.added > 0 ? `${counts.added} Added` : '',
    counts.needLook > 0 ? `${counts.needLook} Need a Look` : '',
    counts.notSupported > 0 ? `${counts.notSupported} Not Supported` : '',
    counts.held > 0 ? `${counts.held} Paused by the Hourly Limit` : '',
    counts.skipped > 0 ? `${counts.skipped} Left Out` : '',
    counts.waiting > 0 ? `${counts.waiting} Waiting` : '',
  ].filter(Boolean);
  const lead = paused ? 'Paused' : counts.waiting > 0 ? 'Importing' : 'Import finished';
  return `${lead}: ${parts.join(', ')}.`;
}

/** Where the read-out stands: whether an import is running and the last quarter announced. */
export interface AnnounceState {
  readonly running: boolean;
  readonly milestone: number;
}

export const ANNOUNCE_START: AnnounceState = { running: false, milestone: 0 };

/**
 * What the polite read-out says next, if anything: the start, each quarter of the way, and the
 * end. Pause and Stop are said by their buttons. Nothing else, so a long import does not talk over
 * the person.
 */
export function nextAnnouncement(
  previous: AnnounceState,
  counts: ImportCounts,
  stopped: boolean,
): { readonly text: string | null; readonly state: AnnounceState } {
  const running = counts.waiting > 0;
  const done = counts.total - counts.waiting;
  const quarter = counts.total > 0 ? Math.floor((done * 4) / counts.total) : 0;
  if (running && !previous.running) {
    return {
      text: `Import started: ${counts.waiting} ${counts.waiting === 1 ? 'file' : 'files'} to send.`,
      state: { running: true, milestone: quarter },
    };
  }
  if (running) {
    if (quarter > previous.milestone && quarter >= 1 && quarter <= 3) {
      return {
        text: `Import ${quarter * 25}% done: ${done} of ${counts.total} files.`,
        state: { running: true, milestone: quarter },
      };
    }
    return { text: null, state: previous };
  }
  if (previous.running) {
    const lead = stopped
      ? 'Import stopped'
      : counts.held > 0
        ? 'Import paused by the hourly limit'
        : 'Import finished';
    const words = [
      `${counts.added} added`,
      counts.needLook > 0 ? `${counts.needLook} need a look` : '',
      counts.notSupported > 0 ? `${counts.notSupported} not supported` : '',
      counts.held > 0 ? `${counts.held} paused by the hourly limit` : '',
      counts.skipped > 0 ? `${counts.skipped} left out` : '',
    ].filter(Boolean);
    return { text: `${lead}: ${words.join(', ')}.`, state: ANNOUNCE_START };
  }
  return { text: null, state: previous };
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
    case 'held':
      return { flag: 'Paused by the Hourly Limit. ', text: HELD_LINE };
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
      return { flag: 'Not added. ', text: item.busy ? item.message || BUSY_LINE : item.message };
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
        flag:
          item.skipReason === 'hidden' || item.skipReason === 'repeat'
            ? 'Left out. '
            : 'Not added. ',
        text: SKIP_LINES[item.skipReason ?? 'stopped'],
      };
  }
}

/** The colour hook the uploader's lines already use. */
function lineStatus(item: ImportItem): string {
  if (item.state === 'added' || item.state === 'duplicate') return 'added';
  if (item.state === 'refused' || item.state === 'unsupported') return 'refused';
  if (item.state === 'unknown' || item.state === 'held') return 'unknown';
  if (item.state === 'skipped' && item.skipReason !== 'hidden' && item.skipReason !== 'repeat') {
    return 'not_sent';
  }
  return 'waiting';
}

type Removal = 'busy' | { readonly days: number } | { readonly problem: string };

interface RowActions {
  readonly onRetry: (id: number) => void;
  readonly onSendAgain: (id: number) => void;
  readonly onRemove: (item: ImportItem) => void;
  readonly onUndo: (item: ImportItem) => Promise<void>;
}

/** One file's line. Drawn again only when its own line or removal changes. */
const ImportRow = memo(function ImportRow({
  item,
  removal,
  actions,
}: {
  readonly item: ImportItem;
  readonly removal: Removal | undefined;
  readonly actions: RowActions;
}) {
  const status = useRef<HTMLParagraphElement>(null);
  // An action's button goes away once used; the line's own status takes the focus first, so a
  // keyboard user stays on this line instead of being sent back to the top of the page.
  const keepFocusThen = (run: () => void) => () => {
    status.current?.focus();
    run();
  };
  const { flag, text } = importLine(item);
  const folder = folderOf(item.path);
  return (
    <li className="upload-item" data-status={lineStatus(item)} data-state={item.state}>
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
      <p ref={status} tabIndex={-1} className={`upload-item-status${flag ? ' field-msg-err' : ''}`}>
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
            onUndo={() => actions.onUndo(item)}
            undoneMessage="Restored. The new copy is back in your documents."
          />
        ) : (
          <div className="lc-new-copy">
            <p className="lc-new-copy-line">You already keep an identical copy of this file.</p>
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={removal === 'busy' || undefined}
              aria-label={`Remove This New Copy: ${item.name}`}
              onClick={removal === 'busy' ? undefined : keepFocusThen(() => actions.onRemove(item))}
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
          onClick={keepFocusThen(() => actions.onRetry(item.id))}
        >
          Try Again
        </button>
      ) : null}
      {canSendAgain(item) ? (
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={`Send Again: ${item.name}`}
          onClick={keepFocusThen(() => actions.onSendAgain(item.id))}
        >
          Send Again
        </button>
      ) : null}
    </li>
  );
});

/**
 * Batch and folder import (UMPE P2): a whole folder (with the folders inside it, where the browser
 * allows) or many files, each with its own line and an honest state. Every file goes through the
 * same upload as a single file, a few at a time; nothing past the limit is dropped without a line
 * saying so; Pause, Resume, Stop and Try Again are always at hand.
 */
export function ImportPanel({
  applicantId,
  limitBytes = DEFAULT_LIMIT_BYTES,
  limitLabel = '4 MB',
  pdfAccepted = false,
  retryUnknown = false,
  familyBatch = false,
  showNext = true,
}: {
  readonly applicantId: string;
  /** The largest file accepted, in bytes (the same limit the single upload uses). */
  readonly limitBytes?: number;
  /** The same limit as people read it ("4 MB"). */
  readonly limitLabel?: string;
  /** True only when PDF files are admitted (they need a real virus scanner). */
  readonly pdfAccepted?: boolean;
  /**
   * True when the server keeps upload receipts (UMPE P3): a file with no answer is then sent again
   * on its own with the same upload id, which the server answers with the copy already stored.
   */
  readonly retryUnknown?: boolean;
  /**
   * Whether the two next-step buttons show after an import. A page with its own next step (Add
   * Documents) turns them off; the choice of which person still shows for files sent to a family.
   */
  readonly showNext?: boolean;
  /**
   * UMPE G1: whether files may be added for several people at once. Each such file waits, seen only
   * by this account, until its Which Person? decision in Needs One Decision.
   */
  readonly familyBatch?: boolean;
}) {
  const router = useRouter();
  const forId = useId();
  const [forFamily, setForFamily] = useState(false);
  const family = useRef(false);
  family.current = familyBatch && forFamily;
  const sentToFamily = useRef(false);
  const limitsId = useId();
  const dropTitleId = useId();
  const dropHintId = useId();
  const listId = useId();
  const personManifest = useRef<ImportManifest | null>(null);
  // UMPE G1: files sent for several people are remembered apart, so one mode never tells the other
  // that a file was already added.
  const familyManifest = useRef<ImportManifest | null>(null);
  const manifest = {
    get current(): ImportManifest | null {
      return family.current ? familyManifest.current : personManifest.current;
    },
  };
  const addedSinceRefresh = useRef(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announced = useRef<AnnounceState>(ANNOUNCE_START);
  const stopped = useRef(false);
  const [queue] = useState(
    () =>
      new ImportQueue({
        applicantId,
        rules: { limitBytes, limitLabel, pdfAccepted },
        earlierState: (file) => manifest.current?.earlierState(file) ?? null,
        beforeSend: (item) => manifest.current?.markSending(item),
        onSettled: (item) => {
          if (item.state === 'added' || item.state === 'duplicate') {
            addedSinceRefresh.current = true;
          }
          void manifest.current?.record(item);
        },
        // The same traveller and file (name, size, date) always send the same upload id, so
        // choosing the folder again after a reload can never store a file twice.
        uploadIdFor: async (file) =>
          uploadIdFromHash(
            await sha256Hex(
              `${family.current ? 'family' : applicantId}\u0000${fingerprintOf(file)}`,
            ),
          ) ?? newUploadId(),
        // The choice in force when each file is sent: one person's documents, or Which Person?.
        send: (request) => {
          if (family.current) sentToFamily.current = true;
          return (family.current ? sendThroughHoldRoute : sendThroughUploadRoute)(request);
        },
        retryUnknown,
      }),
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const [announcement, setAnnouncement] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [remembered, setRemembered] = useState(0);
  const [removals, setRemovals] = useState<ReadonlyMap<number, Removal>>(new Map());

  const items: ImportItem[] = [];
  for (const id of snapshot.order) {
    const item = snapshot.byId.get(id);
    if (item) items.push(item);
  }
  const counts = countItems(items);
  const pending = counts.waiting > 0;
  const uploading = items.some((item) => item.state === 'uploading');
  const busy = items.some((item) => item.state === 'queued' || item.state === 'uploading');

  // The saved list is read in the browser only, after the first paint, so the page is the same
  // with or without it; whatever is waiting to be saved is saved when the page is hidden.
  useEffect(() => {
    const saved = new ImportManifest(applicantId);
    const savedFamily = new ImportManifest(`family:${applicantId}`);
    personManifest.current = saved;
    familyManifest.current = savedFamily;
    setRemembered(saved.size + savedFamily.size);
    const flush = () => {
      saved.flush();
      savedFamily.flush();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [applicantId]);

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  // Leaving while a file is on its way would leave it unconfirmed: the browser asks first.
  useEffect(() => {
    if (!uploading) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [uploading]);

  useEffect(() => {
    if (busy) return;
    personManifest.current?.flush();
    familyManifest.current?.flush();
    if (addedSinceRefresh.current) {
      addedSinceRefresh.current = false;
      router.refresh();
    }
  }, [busy, router]);

  // The read-out: start, each quarter, and the end only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each change of the queue.
  useEffect(() => {
    const next = nextAnnouncement(announced.current, counts, stopped.current);
    announced.current = next.state;
    if (next.text) setAnnouncement(next.text);
    if (!next.state.running) stopped.current = false;
    setRemembered((personManifest.current?.size ?? 0) + (familyManifest.current?.size ?? 0));
  }, [snapshot.version]);

  const take = useCallback(
    (result: FolderReadResult) => {
      if (result.truncated) setTruncated(true);
      void queue.add(result.files, result.skipped);
    },
    [queue],
  );

  const { dragging, handlers: dropHandlers } = useDropZone((transfer) => {
    // Taken now: the browser empties the drop once the drop handler returns.
    const captured = captureDrop(transfer);
    setAnnouncement('Reading the folder.');
    void readDrop(captured)
      .then(take)
      .catch(() => setAnnouncement('We could not read what was dropped. Try choosing it instead.'));
  });

  const chooseFolder = () => {
    if (folderPickerSupported(folderRef.current)) {
      folderRef.current?.click();
      return;
    }
    setAnnouncement(FOLDER_FALLBACK_LINE);
    filesRef.current?.click();
  };

  /** Moves focus to the heading before a control that is about to go away does its work. */
  const fromHeading = (run: () => void) => () => {
    headingRef.current?.focus();
    run();
  };

  const setRemoval = useCallback(
    (id: number, value: Removal) => setRemovals((current) => new Map(current).set(id, value)),
    [],
  );
  const actions: RowActions = useState<RowActions>(() => ({
    onRetry: (id) => queue.retry(id),
    onSendAgain: (id) => queue.sendAgain(id),
    onRemove: (item) => {
      const id = item.removableCopyId;
      if (!id) return;
      setRemoval(item.id, 'busy');
      deleteDuplicateAction(applicantId, id, true)
        .then((removed) => {
          if (!removed.ok) {
            setRemoval(item.id, { problem: removed.message });
            return;
          }
          setRemoval(item.id, { days: removed.days });
          router.refresh();
        })
        .catch(() =>
          setRemoval(item.id, {
            problem: 'We could not remove it. Check your connection and try again.',
          }),
        );
    },
    onUndo: async (item) => {
      const id = item.removableCopyId;
      if (!id) return;
      const restored = await restoreDeletedAction(applicantId, id, 'UNDO');
      if (!restored.ok) throw new Error(restored.message);
      router.refresh();
    },
  }))[0];

  const visible = showAll ? items : items.slice(0, LINES_SHOWN_FIRST);

  return (
    <div className="uploader import-panel">
      <p className="uploader-limits" id={limitsId}>
        {uploadLimitsText(limitLabel, pdfAccepted)} Up to {MAX_IMPORT_FILES} files in one import.
      </p>
      {remembered > 0 ? (
        <div className="import-earlier">
          <p className="field-hint">
            This browser remembers which files earlier imports here added (not their names), so a
            file already added is not sent again. To finish an import, add the same folder again.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fromHeading(() => {
              personManifest.current?.clear();
              familyManifest.current?.clear();
              setRemembered(0);
            })}
          >
            Forget Earlier Imports
          </button>
        </div>
      ) : null}

      {familyBatch ? (
        <fieldset className="umpe-g1-import-for" aria-describedby={`${forId}-hint`}>
          <legend>Who Are These Files For?</legend>
          <label className="umpe-g1-person-choice">
            <input
              type="radio"
              name={`${forId}-for`}
              checked={!forFamily}
              aria-disabled={busy || undefined}
              onChange={() => {
                if (!busy) setForFamily(false);
              }}
            />
            <span>Only This Person</span>
          </label>
          <label className="umpe-g1-person-choice">
            <input
              type="radio"
              name={`${forId}-for`}
              checked={forFamily}
              aria-disabled={busy || undefined}
              onChange={() => {
                if (!busy) setForFamily(true);
              }}
            />
            <span>Several People in My Family</span>
          </label>
          <p className="field-hint" id={`${forId}-hint`}>
            {forFamily
              ? 'Each file waits in Needs One Decision, seen only by you, until you choose who it belongs to. We suggest a person only when the name and date of birth in the file match exactly one of your people.'
              : 'Every file is added to this person.'}
          </p>
        </fieldset>
      ) : null}

      <section
        className="upload-drop"
        data-dragging={dragging ? 'true' : undefined}
        aria-labelledby={dropTitleId}
        aria-describedby={dropHintId}
        {...dropHandlers}
      >
        <p className="upload-drop-title" id={dropTitleId}>
          Drop Files or a Folder Here
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
            onClick={() => filesRef.current?.click()}
          >
            Choose Files
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

      <h3 className="import-summary-title" ref={headingRef} tabIndex={-1}>
        Your Files
      </h3>
      <p className="upload-summary import-counts">{importCountsText(counts, snapshot.paused)}</p>
      <output className="sr-only import-announce">{announcement}</output>
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
            onClick={() => {
              if (snapshot.paused) {
                queue.resume();
                setAnnouncement('Import resumed.');
              } else {
                queue.pause();
                setAnnouncement('Import paused. Files already on their way will finish.');
              }
            }}
          >
            {snapshot.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fromHeading(() => {
              stopped.current = true;
              queue.stop();
            })}
          >
            Stop
          </button>
        </div>
      ) : null}
      {counts.held > 0 ? (
        <div className="import-controls">
          <p className="field-hint">
            The hourly upload limit was reached, so {counts.held}{' '}
            {counts.held === 1 ? 'file is' : 'files are'} waiting. Nothing more is sent until you
            try again.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fromHeading(() => queue.retryHeld())}
          >
            Try Again for All Paused Files
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="upload-list" id={listId} aria-label="Files in This Import">
          {visible.map((item) => (
            <ImportRow
              key={item.id}
              item={item}
              removal={removals.get(item.id)}
              actions={actions}
            />
          ))}
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
          onClick={fromHeading(() => {
            queue.clearFinished();
            sentToFamily.current = false;
            setShowAll(false);
            setTruncated(false);
            setRemovals(new Map());
          })}
        >
          Clear the List
        </button>
      ) : null}
      {counts.total > 0 && !pending ? (
        <nav className="umpe-g1-import-next" aria-label="After This Import">
          <p className="field-hint">
            {sentToFamily.current
              ? 'Files for several people wait in Needs One Decision until you choose who each one belongs to.'
              : 'Most files are sorted on their own. Anything that needs your answer is in Needs One Decision, and details read from your files wait for your approval.'}
          </p>
          {showNext || sentToFamily.current ? (
            <div className="upload-drop-actions">
              <a
                className="btn btn-primary"
                href={`/app/applicant/${applicantId}/documents#needs-decision`}
              >
                {sentToFamily.current ? 'Choose Which Person' : 'Open Needs One Decision'}
              </a>
              {showNext ? (
                <a className="btn btn-secondary" href={`/app/applicant/${applicantId}`}>
                  Review Suggested Details
                </a>
              ) : null}
            </div>
          ) : null}
        </nav>
      ) : null}
      <p className="muted uploader-note">
        Each file is stored privately and checked when it arrives, exactly as a single upload is.
        Only you and the people you choose to share with can open it.
      </p>
    </div>
  );
}
