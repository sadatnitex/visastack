'use client';

import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { usePageLanguage, useT } from '../../../../../components/i18n-provider';
import { Icon } from '../../../../../components/icons';
import { UndoStatus } from '../../../../../components/lifecycle/undo-status';
import { UpgradeLine } from '../../../../../components/upgrade-line';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
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
import { shrunkNotice } from '../../../../../lib/photo-shrink';
import { batchHref, canFollowBatch } from '../../../../../lib/upload-batch';
import { uploadLimitsText } from '../../../../../lib/upload-rules';
import { UPLOAD_UNKNOWN_OUTCOME } from '../document-uploader';
import { deleteDuplicateAction, restoreDeletedAction } from '../documents/manage/delete/actions';
import { deletedLine } from '../documents/manage/delete/messages';
import {
  type RefusalLine,
  REMOVAL_WORDS as W,
  refusalNode,
  said,
} from '../documents/manage/removal-words';

/** Lines drawn before Show All, so a long import stays quick to read and to scroll past. */
export const LINES_SHOWN_FIRST = 50;

const DEFAULT_LIMIT_BYTES = 4 * 1024 * 1024;

/** How long "files are saved" stays on screen before the page moves on to What We Found. */
const AUTO_CONTINUE_MS = 1800;

/** The choice that sends files to the family route, where each waits for Which Person?. */
const NOT_SURE = '__not_sure';

/** The person a send is for: the chosen one, or this page's own when "not sure" is chosen. */
function personFor(target: string, own: string): string {
  return target === NOT_SURE ? own : target;
}

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
      if (item.preparing) return { flag: '', text: 'Making this photo smaller to fit.' };
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

type Removal = 'busy' | { readonly days: number } | { readonly problem: RefusalLine };

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
  const t = useT(appApplicantCatalog);
  const pageLang = usePageLanguage();
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
      {folder ? (
        <p className="import-item-path">
          {t.node('appApplicant.appApplicantIdImportImportPanel.inFolder', { folder })}
        </p>
      ) : null}
      {item.state === 'uploading' ? (
        <progress
          className="upload-progress"
          max={100}
          value={item.progress}
          aria-label={t('appApplicant.appApplicantIdDocumentUploader.uploadOfName', {
            name: item.name,
          })}
          {...t.lang('appApplicant.appApplicantIdDocumentUploader.uploadOfName')}
        />
      ) : null}
      {item.shrunkTo !== null && item.size !== null ? (
        <p className="upload-item-status">{shrunkNotice(item.size, item.shrunkTo)}</p>
      ) : null}
      {(item.state === 'added' || item.state === 'duplicate') && item.title ? (
        <p className="upload-item-title">
          {t.node('appApplicant.appApplicantIdDocumentUploader.addedAsTitle', {
            title: item.title,
          })}
        </p>
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
            <p className="lc-new-copy-line">
              {t.node('appApplicant.appApplicantIdDocumentUploader.youAlreadyKeepAnIdenticalCopy')}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              aria-disabled={removal === 'busy' || undefined}
              aria-label={t('appApplicant.appApplicantIdDocumentUploader.removeThisNewCopyName', {
                name: item.name,
              })}
              onClick={removal === 'busy' ? undefined : keepFocusThen(() => actions.onRemove(item))}
            >
              {removal === 'busy'
                ? t.node('appApplicant.appApplicantIdDocumentUploader.removing')
                : t.node('appApplicant.appApplicantIdDocumentUploader.removeThisNewCopy')}
            </button>
            {removal && typeof removal === 'object' && 'problem' in removal ? (
              <p className="field-msg-err" role="alert">
                {refusalNode(t, removal.problem, pageLang)}
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {canTryAgain(item) ? (
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={t('appApplicant.appApplicantIdDocumentUploader.tryAgainName', {
            name: item.name,
          })}
          onClick={keepFocusThen(() => actions.onRetry(item.id))}
        >
          {t.node('appApplicant.appApplicantIdDocumentUploader.tryAgain')}
        </button>
      ) : null}
      {canSendAgain(item) ? (
        <button
          type="button"
          className="btn btn-secondary"
          aria-label={t('appApplicant.appApplicantIdImportImportPanel.sendAgainName', {
            name: item.name,
          })}
          onClick={keepFocusThen(() => actions.onSendAgain(item.id))}
        >
          {t.node('appApplicant.appApplicantIdImportImportPanel.sendAgain')}
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
  people = [],
  readingOn = false,
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
  /**
   * The people this account keeps records for (this person first). With more than one, the panel
   * asks who the files are for and files each one straight under that person; "Not Sure" then
   * uses the family route when it is ready.
   */
  readonly people?: readonly { readonly id: string; readonly name: string }[];
  /**
   * Whether a file added now will really be read automatically. When it will not, the closing
   * line never says files are "sorted on their own". Default false: a page that does not say reading is on never claims it.
   */
  readonly readingOn?: boolean;
}) {
  const t = useT(appApplicantCatalog);
  const router = useRouter();
  const forId = useId();
  // Who the next files are for: one of this account's people, or "not sure" (the family route).
  const [target, setTarget] = useState<string>(applicantId);
  const targetRef = useRef<string>(applicantId);
  targetRef.current = target;
  const choosePerson = people.length > 1;
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const family = useRef(false);
  family.current = familyBatch && choosePerson && target === NOT_SURE;
  const sentToFamily = useRef(false);
  // The people other than this page's person that files were actually sent for.
  const sentFor = useRef<ReadonlyMap<string, string>>(new Map());
  /** Whom each stored document is for, so What We Found opens on the right person's page. */
  const personOfDocument = useRef(new Map<string, string>());
  const limitsId = useId();
  const dropTitleId = useId();
  const dropHintId = useId();
  const listId = useId();
  const personManifest = useRef<ImportManifest | null>(null);
  // UMPE G1: files sent for several people are remembered apart, so one mode never tells the other
  // that a file was already added.
  const familyManifest = useRef<ImportManifest | null>(null);
  // A person other than this page's own is remembered apart too, so a file added for one person is
  // never reported as "added earlier" when it is chosen again for another.
  const otherManifests = useRef(new Map<string, ImportManifest>());
  const manifest = {
    get current(): ImportManifest | null {
      if (family.current) return familyManifest.current;
      const forPerson = targetRef.current;
      if (forPerson === applicantId || forPerson === NOT_SURE) return personManifest.current;
      let saved = otherManifests.current.get(forPerson);
      if (!saved) {
        saved = new ImportManifest(forPerson);
        otherManifests.current.set(forPerson, saved);
      }
      return saved;
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
        scopeFor: () => (family.current ? 'family' : personFor(targetRef.current, applicantId)),
        rules: { limitBytes, limitLabel, pdfAccepted, shrinkPhotos: true },
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
              `${family.current ? 'family' : personFor(targetRef.current, applicantId)}\u0000${fingerprintOf(file)}`,
            ),
          ) ?? newUploadId(),
        // The choice in force when each file is sent: one person's documents, or Which Person?.
        send: (request) => {
          if (family.current) {
            sentToFamily.current = true;
            return sendThroughHoldRoute(request);
          }
          const forPerson = personFor(targetRef.current, applicantId);
          if (forPerson !== applicantId) {
            const name = peopleRef.current.find((person) => person.id === forPerson)?.name;
            if (name) sentFor.current = new Map(sentFor.current).set(forPerson, name);
          }
          return sendThroughUploadRoute({ ...request, applicantId: forPerson }).then((outcome) => {
            if (outcome.kind === 'added' && outcome.documentId) {
              personOfDocument.current.set(outcome.documentId, forPerson);
            }
            return outcome;
          });
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
  // The files the server confirmed, by id and by person: the next screen follows these one by one.
  // When every file in the list was added cleanly, for one person, and one address can follow
  // them all, the page moves there by itself after a short pause that says the files are saved.
  // With anything else to look at, a button per person does it.
  const addedByPerson = new Map<string, string[]>();
  for (const item of items) {
    if (item.state !== 'added' || !item.documentId) continue;
    const person = personOfDocument.current.get(item.documentId) ?? applicantId;
    addedByPerson.set(person, [...(addedByPerson.get(person) ?? []), item.documentId]);
  }
  const addedCount = [...addedByPerson.values()].reduce((sum, ids) => sum + ids.length, 0);
  const onlyPerson = addedByPerson.size === 1 ? [...addedByPerson][0] : undefined;
  const goTo =
    onlyPerson &&
    addedCount === counts.total &&
    canFollowBatch(addedCount) &&
    !pending &&
    !sentToFamily.current
      ? batchHref(onlyPerson[0], onlyPerson[1])
      : null;
  useEffect(() => {
    if (!goTo) return;
    const timer = setTimeout(() => router.push(goTo), AUTO_CONTINUE_MS);
    return () => clearTimeout(timer);
  }, [goTo, router]);

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
      for (const other of otherManifests.current.values()) other.flush();
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
    for (const other of otherManifests.current.values()) other.flush();
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
            setRemoval(item.id, { problem: removed });
            return;
          }
          setRemoval(item.id, { days: removed.days });
          router.refresh();
        })
        .catch(() =>
          setRemoval(item.id, {
            problem: said(W.couldNotRemoveIt),
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
        {t.node('appApplicant.appApplicantIdImportImportPanel.uploadlimitstextUpToMaxImportFiles', {
          uploadLimitsText: uploadLimitsText(limitLabel, pdfAccepted, true),
          MAX_IMPORT_FILES: MAX_IMPORT_FILES,
        })}
      </p>
      {remembered > 0 ? (
        <div className="import-earlier">
          <p className="field-hint">
            {t.node(
              'appApplicant.appApplicantIdImportImportPanel.thisBrowserRemembersWhichFilesEarlier',
            )}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fromHeading(() => {
              personManifest.current?.clear();
              familyManifest.current?.clear();
              for (const other of otherManifests.current.values()) other.clear();
              setRemembered(0);
            })}
          >
            {t.node('appApplicant.appApplicantIdImportImportPanel.forgetEarlierImports')}
          </button>
        </div>
      ) : null}

      {choosePerson ? (
        <div className="field-stack umpe-g1-import-for">
          <label className="field-label" htmlFor={`${forId}-person`}>
            {t.node('appApplicant.appApplicantIdImportImportPanel.whoAreTheseFilesFor')}
          </label>
          <select
            id={`${forId}-person`}
            className="input"
            value={target}
            aria-describedby={`${forId}-person-hint`}
            aria-disabled={busy || undefined}
            onChange={(event) => {
              if (!busy) setTarget(event.currentTarget.value);
            }}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.id === applicantId
                  ? t('appApplicant.appApplicantIdImportImportPanel.nameThisPerson', {
                      name: person.name,
                    })
                  : person.name}
              </option>
            ))}
            {familyBatch ? (
              <option
                {...t.lang('appApplicant.appApplicantIdImportImportPanel.notSureHelpMeDecide')}
                value={NOT_SURE}
              >
                {t('appApplicant.appApplicantIdImportImportPanel.notSureHelpMeDecide')}
              </option>
            ) : null}
          </select>
          <p className="field-hint" id={`${forId}-person-hint`}>
            {target === NOT_SURE
              ? t.node('appApplicant.appApplicantIdImportImportPanel.eachFileWaitsInNeedsOne')
              : t.node('appApplicant.appApplicantIdImportImportPanel.everyFileYouAddNowIs')}
          </p>
        </div>
      ) : null}

      <section
        className="upload-drop"
        data-dragging={dragging ? 'true' : undefined}
        aria-labelledby={dropTitleId}
        aria-describedby={dropHintId}
        {...dropHandlers}
      >
        <span className="upload-drop-icon" aria-hidden="true">
          <Icon name="upload" size={44} />
        </span>
        <p className="upload-drop-title" id={dropTitleId}>
          {t.node('appApplicant.appApplicantIdImportImportPanel.dropFilesOrAFolderHere')}
        </p>
        <p className="upload-drop-hint" id={dropHintId}>
          {t.node('appApplicant.appApplicantIdImportImportPanel.foldersInsideItAreIncludedYou')}
        </p>
        <div className="upload-drop-actions">
          <button
            type="button"
            className="btn btn-primary"
            aria-describedby={limitsId}
            onClick={() => filesRef.current?.click()}
          >
            {t.node('appApplicant.appApplicantIdDocumentUploader.chooseFiles')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-describedby={limitsId}
            onClick={chooseFolder}
          >
            {t.node('appApplicant.appApplicantIdImportImportPanel.addAFolder')}
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
        aria-label={t('appApplicant.appApplicantIdImportImportPanel.folderToImport')}
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
        aria-label={t('appApplicant.appApplicantIdImportImportPanel.filesToImport')}
        data-testid="import-files"
        onChange={(event) => {
          take(readChosenFiles(Array.from(event.currentTarget.files ?? [])));
          event.currentTarget.value = '';
        }}
      />

      <h3 className="import-summary-title" ref={headingRef} tabIndex={-1}>
        {t.node('appApplicant.appApplicantIdImportImportPanel.yourFiles')}
      </h3>
      <p className="upload-summary import-counts">{importCountsText(counts, snapshot.paused)}</p>
      <output className="sr-only import-announce">{announcement}</output>
      {truncated ? (
        <p className="field-hint">
          {t.node(
            'appApplicant.appApplicantIdImportImportPanel.thisFolderHoldsMoreThanTolocalestring',
            {
              toLocaleString: MAX_ENTRIES_LOOKED_AT.toLocaleString('en-GB'),
              MAX_IMPORT_FILES: MAX_IMPORT_FILES,
            },
          )}
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
            {snapshot.paused
              ? t.node('appApplicant.appApplicantIdImportImportPanel.resume')
              : t.node('appApplicant.appApplicantIdImportImportPanel.pause')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fromHeading(() => {
              stopped.current = true;
              queue.stop();
            })}
          >
            {t.node('appApplicant.appApplicantIdImportImportPanel.stop')}
          </button>
        </div>
      ) : null}
      {counts.held > 0 ? (
        <div className="import-controls">
          <p className="field-hint">
            {t.node('appApplicant.appApplicantIdImportImportPanel.theHourlyUploadLimitWasReached', {
              held: counts.held,
            })}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fromHeading(() => queue.retryHeld())}
          >
            {t.node('appApplicant.appApplicantIdImportImportPanel.tryAgainForAllPausedFiles')}
          </button>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul
          className="upload-list"
          id={listId}
          aria-label={t('appApplicant.appApplicantIdImportImportPanel.filesInThisImport')}
        >
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
          {showAll
            ? t.node('appApplicant.appApplicantIdImportImportPanel.showFewer')
            : t.node('appApplicant.appApplicantIdImportImportPanel.showAllLength', {
                length: items.length,
              })}
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
          {t.node('appApplicant.appApplicantIdDocumentUploader.clearTheList')}
        </button>
      ) : null}
      {counts.total > 0 && !pending ? (
        <nav
          className="umpe-g1-import-next"
          aria-label={t('appApplicant.appApplicantIdImportImportPanel.afterThisImport')}
        >
          {addedCount > 0 ? (
            <output className="notice notice-ok">
              <strong>
                {addedCount === 1 ? '1 file is saved.' : `${addedCount} files are saved.`}
              </strong>{' '}
              {goTo
                ? 'Taking you to what we found.'
                : 'Open What We Found to follow them, or stay here to add more.'}
            </output>
          ) : null}
          {[...sentFor.current].map(([personId, name]) => (
            <p className="field-hint" key={personId}>
              Files for {name} were saved under {name}.{' '}
              <a href={`/app/applicant/${personId}/documents`}>Open {name}&apos;s Documents</a>
            </p>
          ))}
          <p className="field-hint">
            {sentToFamily.current
              ? t.node('appApplicant.appApplicantIdImportImportPanel.filesForSeveralPeopleWaitIn')
              : readingOn
                ? t.node('appApplicant.appApplicantIdImportImportPanel.mostFilesAreSortedOnTheir')
                : t.node(
                    'appApplicant.appApplicantIdImportImportPanel.yourFilesAreSavedAndChecked',
                  )}
          </p>
          {addedCount > 0 || showNext || sentToFamily.current ? (
            <div className="upload-drop-actions">
              {[...addedByPerson].map(([person, ids]) => {
                const name =
                  person === applicantId
                    ? null
                    : peopleRef.current.find((p) => p.id === person)?.name;
                return (
                  <a key={person} className="btn btn-primary" href={batchHref(person, ids)}>
                    {name
                      ? t.node(
                          'appApplicant.appApplicantIdImportImportPanel.seeWhatWeFoundForName',
                          {
                            name,
                          },
                        )
                      : t.node('appApplicant.appApplicantIdImportImportPanel.seeWhatWeFound')}
                  </a>
                );
              })}
              <a
                className={`btn ${addedCount > 0 ? 'btn-secondary' : 'btn-primary'}`}
                href={`/app/applicant/${applicantId}/documents#needs-decision`}
              >
                {sentToFamily.current
                  ? t.node('appApplicant.appApplicantIdImportImportPanel.chooseWhichPerson')
                  : t.node('appApplicant.appApplicantIdImportImportPanel.openNeedsOneDecision')}
              </a>
              {showNext ? (
                <a className="btn btn-secondary" href={`/app/applicant/${applicantId}`}>
                  {t.node('appApplicant.appApplicantIdImportImportPanel.reviewSuggestedDetails')}
                </a>
              ) : null}
            </div>
          ) : null}
        </nav>
      ) : null}
      <p className="muted uploader-note">
        {t.node('appApplicant.appApplicantIdImportImportPanel.eachFileIsStoredPrivatelyAnd')}
      </p>
    </div>
  );
}
