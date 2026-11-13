'use client';

import { isOtherDocumentType } from '@visastack/core';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CapturePreview } from '../../../../components/capture-preview';
import { useT } from '../../../../components/i18n-provider';
import { UndoStatus } from '../../../../components/lifecycle/undo-status';
import { ReceiptCard } from '../../../../components/receipt-card';
import { UpgradeLine, type UpgradeLineKind } from '../../../../components/upgrade-line';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import {
  type UploadOutcome,
  reportUploadProblem,
  sendDocumentFile,
} from '../../../../lib/document-upload-client';
import { newUploadId } from '../../../../lib/document-upload-client-id';
import { formatFileSize } from '../../../../lib/format-size';
import { useDropZone } from '../../../../lib/import/use-drop-zone';
import type { ChoiceGroup } from '../../../../lib/master-profile-types';
import { photoNotShrunkMessage, shrinkPhoto, shrunkNotice } from '../../../../lib/photo-shrink';
import { uploadCheckNotice } from '../../../../lib/scan-state';
import { acceptAttribute, checkChosenFile, uploadLimitsText } from '../../../../lib/upload-rules';
import { deleteDuplicateAction, restoreDeletedAction } from './documents/manage/delete/actions';
import { deletedLine } from './documents/manage/delete/messages';
import {
  type RefusalLine,
  REMOVAL_WORDS as W,
  refusalNode,
  said,
} from './documents/manage/removal-words';

/**
 * What a file's line says when its request never got an answer (a dropped connection, a tunnel,
 * a closed laptop). The file may well have arrived, so it does not say "failed"; it says where to
 * look first, so nobody uploads the same file twice just because the page went quiet.
 */
export const UPLOAD_UNKNOWN_OUTCOME =
  'We could not confirm whether this upload finished. Check the list of documents below before uploading it again. If it is not there, try again.';

/** What a file's line says when the service turned it away for now and gave no line of its own. */
export const UPLOAD_BUSY_LINE =
  'We are busy just now, so this file was not added. Try again in a few minutes.';

/** Files taken in one go; more are listed as not added, so one drop cannot queue hundreds. */
export const MAX_FILES_AT_ONCE = 20;

/** The configured per-file limit when none is passed (one request to the host carries 4 MB). */
const DEFAULT_LIMIT_BYTES = 4 * 1024 * 1024;

type ItemStatus =
  | 'waiting'
  | 'preparing'
  | 'sending'
  | 'checking'
  | 'added'
  | 'refused'
  | 'unknown'
  | 'not_sent';

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
  /** The line after a refusal a paid plan would help with (ADR 0025 section 12.2). */
  readonly upgrade: UpgradeLineKind | null;
  /** The added document, when it is an exact copy that may be removed again (LC-C). */
  readonly removableCopyId: string | null;
  /** Remove This New Copy: not asked, running, done (with Undo), or why it was refused. */
  readonly removal: 'none' | 'busy' | 'removed' | { readonly problem: RefusalLine };
  /** Days the removed copy stays in Recently Deleted. */
  readonly removedDays: number;
  /**
   * This file's upload id (UMPE P3), the same on every attempt including Try Again, so a repeat
   * after no answer came back is answered with the copy already stored, never a second one.
   */
  readonly uploadId: string;
  /** A photo over the limit, still to be made smaller before it is sent (P2). */
  readonly shrink: boolean;
  /** The photo's size before it was made smaller, once it was; the new size is `size`. */
  readonly shrunkFrom: number | null;
  /** When the server stored it (the device clock at that moment), for the receipt. */
  readonly addedAt: number | null;
  /** The receipt has been closed with Done, so it is not shown again for this file. */
  readonly receipted: boolean;
}

const ACTIVE: ReadonlySet<ItemStatus> = new Set(['waiting', 'preparing', 'sending', 'checking']);
const RETRYABLE: ReadonlySet<ItemStatus> = new Set(['refused', 'unknown']);

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;

/** The one polite announcement for the whole list: which file is going, then how the batch went. */
export function uploadSummary(items: readonly Pick<UploadItem, 'status' | 'name'>[]): string {
  if (items.length === 0) return '';
  const current = items.find(
    (item) =>
      item.status === 'preparing' || item.status === 'sending' || item.status === 'checking',
  );
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
    case 'preparing':
      return 'Making this photo smaller to fit.';
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

/** The receipt's plain sentence: what was saved, and how many were not. */
function receiptWhat(
  added: readonly Pick<UploadItem, 'title' | 'name'>[],
  notAdded: number,
): string {
  const saved =
    added.length === 1
      ? `${added[0]?.title ?? added[0]?.name ?? 'Your file'} is saved in your documents.`
      : `${added.length} files are saved in your documents.`;
  if (notAdded === 0) return saved;
  return `${saved} ${files(notAdded)} not added; the list below says why.`;
}

function outcomeToItem(outcome: UploadOutcome): Partial<UploadItem> {
  if (outcome.kind === 'added') {
    return {
      status: 'added',
      message: outcome.message,
      title: outcome.title,
      removableCopyId: outcome.removableCopyId ?? null,
    };
  }
  if (outcome.kind === 'refused') {
    return { status: 'refused', message: outcome.message, upgrade: outcome.upgrade ?? null };
  }
  // Turned away for now before anything was stored: a plain refusal, with the server's line.
  if (outcome.kind === 'busy') {
    return { status: 'refused', message: outcome.message ?? UPLOAD_BUSY_LINE, upgrade: null };
  }
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
  const t = useT(appApplicantCatalog);
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
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  // A photo just taken, shown for Use This or Retake before anything is sent (F2).
  const [photo, setPhoto] = useState<File | null>(null);
  const nextId = useRef(1);
  const running = useRef(false);
  const addedSinceRefresh = useRef(false);

  const update = useCallback((id: number, change: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const addFiles = (chosen: readonly File[]) => {
    if (chosen.length === 0) return;
    const rules = { limitBytes, limitLabel, pdfAccepted, shrinkPhotos: true };
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
        upgrade: null,
        removableCopyId: null,
        removal: 'none' as const,
        removedDays: 0,
        uploadId: newUploadId(),
        shrink: false,
        shrunkFrom: null,
        addedAt: null,
        receipted: false,
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
        ? {
            ...base,
            file,
            contentType: check.contentType,
            status: 'waiting',
            message: '',
            shrink: check.shrink === true,
          }
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
    const send = (toSend: File, contentType: string) => {
      update(next.id, { status: 'sending', progress: 0 });
      void sendDocumentFile({
        applicantId,
        file: toSend,
        contentType,
        docType: next.docType,
        subject: next.subject,
        uploadId: next.uploadId,
        fileName: toSend.name,
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
          // Once the file is stored nothing needs the copy again, so a smaller photo is let go.
          update(next.id, {
            ...outcomeToItem(outcome),
            ...(outcome.kind === 'added' ? { file: null, addedAt: Date.now() } : {}),
          });
        });
    };
    if (!next.shrink) {
      send(file, next.contentType);
      return;
    }
    // A photo over the limit is made smaller first (P2), one at a time, then sent like any file.
    update(next.id, { status: 'preparing' });
    void shrinkPhoto(file, limitBytes).then((shrunk) => {
      if (!shrunk.ok) {
        running.current = false;
        update(next.id, {
          status: 'not_sent',
          file: null,
          shrink: false,
          message: photoNotShrunkMessage(shrunk.reason, limitLabel, pdfAccepted),
        });
        if (shrunk.reason === 'unreadable') {
          reportUploadProblem({
            route: 'upload',
            reason: 'unreadable',
            status: 0,
            redirected: false,
            ms: 0,
          });
        }
        return;
      }
      update(next.id, {
        file: shrunk.file,
        size: shrunk.toBytes,
        contentType: shrunk.file.type,
        shrink: false,
        shrunkFrom: shrunk.fromBytes,
      });
      send(shrunk.file, shrunk.file.type);
    });
  }, [items, applicantId, limitBytes, limitLabel, pdfAccepted, router, update]);

  // The drop area, and the page guard against a file dropped beside it (shared with the import).
  const { dragging, handlers: dropHandlers } = useDropZone((transfer) =>
    addFiles(Array.from(transfer.files)),
  );

  const finished = items.length > 0 && !items.some((item) => ACTIVE.has(item.status));
  const unreceipted = finished
    ? items.filter(
        (item) =>
          item.status === 'added' &&
          !item.receipted &&
          // A new copy the person just removed is no longer saved, so the receipt skips it.
          item.removal !== 'removed' &&
          item.removal !== 'busy',
      )
    : [];
  // Only the files this receipt is about: failures already shown in an earlier receipt do not count.
  const notAddedCount = items.filter((item) => item.status !== 'added' && !item.receipted).length;

  return (
    <div className="uploader">
      <p className="uploader-limits" id={limitsId}>
        {uploadLimitsText(limitLabel, pdfAccepted, true)}
      </p>
      {kindGroups.length > 0 ? (
        <div className="field-stack">
          <label className="field-label" htmlFor={kindId}>
            {t.node('appApplicant.appApplicantIdDocumentUploader.kindOfDocumentOptional')}
          </label>
          <select
            id={kindId}
            name="docType"
            className="input"
            value={kind}
            aria-describedby={kindHintId}
            onChange={(event) => setKind(event.currentTarget.value)}
          >
            <option {...t.lang('appApplicant.appApplicantIdDocumentUploader.notSureYet')} value="">
              {t('appApplicant.appApplicantIdDocumentUploader.notSureYet')}
            </option>
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
                {t.node('appApplicant.appApplicantIdDocumentTypeForm.nameForAnOtherType')}
              </label>
              <input
                id={kindNameId}
                name="subject"
                type="text"
                maxLength={120}
                className="input"
                value={kindName}
                onChange={(event) => setKindName(event.currentTarget.value)}
                placeholder={t(
                  'appApplicant.appApplicantIdDocumentTypeForm.forExampleMarriageCertificate',
                )}
              />
            </>
          ) : null}
          <p className="field-hint" id={kindHintId}>
            {t.node('appApplicant.appApplicantIdDocumentUploader.appliesToTheFilesYouAdd')}
          </p>
          {originalKinds.includes(kind) ? (
            <p className="muted u-fs-075" data-testid="original-needed-note">
              {t.node(
                'appApplicant.appApplicantIdDocumentUploader.embassiesUsuallyWantThisHandedIn',
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {photo ? (
        <CapturePreview
          file={photo}
          onUse={(taken) => {
            setPhoto(null);
            addFiles([taken]);
            requestAnimationFrame(() => actionsRef.current?.querySelector('button')?.focus());
          }}
          onRetake={() => {
            setPhoto(null);
            // Pressed by the person, so the phone's camera may open again at once. Focus waits on
            // Take a Photo meanwhile, so cancelling the camera does not drop it to the page top.
            cameraRef.current?.click();
            requestAnimationFrame(() => cameraButtonRef.current?.focus());
          }}
        />
      ) : (
        <section
          className="upload-drop"
          data-dragging={dragging ? 'true' : undefined}
          aria-labelledby={dropTitleId}
          aria-describedby={dropHintId}
          {...dropHandlers}
        >
          <p className="upload-drop-title" id={dropTitleId}>
            {t.node('appApplicant.appApplicantIdDocumentUploader.dropFilesHere')}
          </p>
          <p className="upload-drop-hint" id={dropHintId}>
            <span className="upload-hint-pointer">
              Drag one or more files into this box, or use a button.
            </span>
            <span className="upload-hint-touch">
              Take a photo of the card or page, or choose files already on your phone.
            </span>{' '}
            Each file gets its own line below.
          </p>
          <div className="upload-drop-actions" ref={actionsRef}>
            {/* On a phone the camera button comes first and is the main one, by style alone
                (`@media (pointer: coarse)` in globals.css), so the page is the same for everyone
                and nothing moves after it loads. */}
            <button
              type="button"
              className="btn btn-primary"
              data-choose="true"
              aria-describedby={limitsId}
              onClick={() => pickerRef.current?.click()}
            >
              {t.node('appApplicant.appApplicantIdDocumentUploader.chooseFiles')}
            </button>
            <button
              ref={cameraButtonRef}
              type="button"
              className="btn btn-secondary"
              data-camera="true"
              onClick={() => cameraRef.current?.click()}
            >
              {t.node('appApplicant.appApplicantIdDocumentUploader.takeAPhoto')}
            </button>
          </div>
        </section>
      )}
      <input
        ref={pickerRef}
        className="sr-only"
        type="file"
        multiple
        accept={acceptAttribute(pdfAccepted)}
        tabIndex={-1}
        aria-hidden="true"
        aria-label={t('appApplicant.appApplicantIdDocumentUploader.documentFiles')}
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
        aria-label={t('appApplicant.appApplicantIdDocumentUploader.cameraPhoto')}
        data-testid="camera-photo"
        onChange={(event) => {
          // One photo, shown for a check before anything is sent (F2). The file stays valid
          // after the input is cleared, which lets the same camera be opened again at once.
          const taken = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (taken) setPhoto(taken);
        }}
      />

      <output className="upload-summary">{uploadSummary(items)}</output>
      {unreceipted.length > 0 ? (
        <ReceiptCard
          key={Math.max(...unreceipted.map((item) => item.addedAt ?? 0))}
          onlyIfIdle
          title={
            unreceipted.length === 1
              ? t('appApplicant.appApplicantIdDocumentUploader.documentSaved')
              : t('appApplicant.appApplicantIdDocumentUploader.documentsSaved')
          }
          what={receiptWhat(unreceipted, notAddedCount)}
          at={Math.max(...unreceipted.map((item) => item.addedAt ?? 0))}
          honestLine="Stored privately. Only you and the people you choose to share with can open it."
          next={{ label: 'View Your Documents', href: `/app/applicant/${applicantId}/documents` }}
          onDone={() =>
            setItems((current) =>
              current.map((item) =>
                ACTIVE.has(item.status) ? item : { ...item, receipted: true },
              ),
            )
          }
          returnFocusTo={() => actionsRef.current?.querySelector('button') ?? null}
        />
      ) : null}
      {items.length > 0 ? (
        <ul
          className="upload-list"
          aria-label={t('appApplicant.appApplicantIdDocumentUploader.filesBeingAdded')}
        >
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
                    aria-label={t('appApplicant.appApplicantIdDocumentUploader.uploadOfName', {
                      name: item.name,
                    })}
                    {...t.lang('appApplicant.appApplicantIdDocumentUploader.uploadOfName')}
                  />
                ) : null}
                {item.shrunkFrom !== null ? (
                  <output className="upload-item-status">
                    {shrunkNotice(item.shrunkFrom, item.size)}
                  </output>
                ) : null}
                {item.status === 'added' && item.title ? (
                  <p className="upload-item-title">
                    {t.node('appApplicant.appApplicantIdDocumentUploader.addedAsTitle', {
                      title: item.title,
                    })}
                  </p>
                ) : null}
                <p className={`upload-item-status${failed ? ' field-msg-err' : ''}`}>
                  {failed ? (
                    <span className="upload-item-flag">
                      {item.status === 'unknown'
                        ? t.node('appApplicant.appApplicantIdDocumentUploader.notConfirmed')
                        : t.node('appApplicant.appApplicantIdDocumentUploader.notAdded')}
                    </span>
                  ) : null}
                  {statusLine(item)}
                  {item.status === 'refused' && item.upgrade ? (
                    <>
                      {' '}
                      <UpgradeLine kind={item.upgrade} />
                    </>
                  ) : null}
                </p>
                {item.status === 'added' && item.removableCopyId ? (
                  <NewCopyRemoval
                    item={item}
                    onRemove={async () => {
                      const id = item.removableCopyId;
                      if (!id || item.removal === 'busy') return;
                      update(item.id, { removal: 'busy' });
                      try {
                        const removed = await deleteDuplicateAction(applicantId, id, true);
                        if (!removed.ok) {
                          update(item.id, { removal: { problem: removed } });
                          return;
                        }
                        update(item.id, { removal: 'removed', removedDays: removed.days });
                        router.refresh();
                      } catch {
                        update(item.id, {
                          removal: {
                            problem: said(W.couldNotRemoveIt),
                          },
                        });
                      }
                    }}
                    onUndo={async () => {
                      const id = item.removableCopyId;
                      if (!id) return;
                      const restored = await restoreDeletedAction(applicantId, id, 'UNDO');
                      if (!restored.ok) throw new Error(restored.message);
                      router.refresh();
                    }}
                  />
                ) : null}
                {RETRYABLE.has(item.status) ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={t('appApplicant.appApplicantIdDocumentUploader.tryAgainName', {
                      name: item.name,
                    })}
                    onClick={() =>
                      update(item.id, {
                        status: 'waiting',
                        progress: 0,
                        message: '',
                        upgrade: null,
                        receipted: false,
                      })
                    }
                  >
                    {t.node('appApplicant.appApplicantIdDocumentUploader.tryAgain')}
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
          {t.node('appApplicant.appApplicantIdDocumentUploader.clearTheList')}
        </button>
      ) : null}
      <p className="muted uploader-note">
        {t.node(
          'appApplicant.appApplicantIdDocumentUploader.uploadchecknoticeIphonePhotosHeicAreSaved',
          { uploadCheckNotice: uploadCheckNotice(virusScanning) },
        )}
      </p>
      <p className="muted uploader-note">
        {t.node('appApplicant.appApplicantIdDocumentUploader.storedPrivatelyOnlyYouAndThe')}
      </p>
    </div>
  );
}

/**
 * Remove This New Copy (LC-C): offered on an added file that is an exact copy of a document
 * already kept. It goes to Recently Deleted (restorable for 30 days), with Undo for ten seconds.
 * The server checks again that it is a copy and that it may go; the id alone grants nothing.
 */
function NewCopyRemoval({
  item,
  onRemove,
  onUndo,
}: {
  readonly item: UploadItem;
  readonly onRemove: () => Promise<void>;
  readonly onUndo: () => Promise<void>;
}) {
  const t = useT(appApplicantCatalog);
  if (item.removal === 'removed') {
    return (
      <UndoStatus
        message={deletedLine(item.removedDays)}
        onUndo={onUndo}
        undoneMessage="Restored. The new copy is back in your documents."
      />
    );
  }
  const busy = item.removal === 'busy';
  return (
    <div className="lc-new-copy">
      <p className="lc-new-copy-line">
        {t.node('appApplicant.appApplicantIdDocumentUploader.youAlreadyKeepAnIdenticalCopy')}
      </p>
      <button
        type="button"
        className="btn btn-secondary"
        aria-disabled={busy || undefined}
        aria-label={t('appApplicant.appApplicantIdDocumentUploader.removeThisNewCopyName', {
          name: item.name,
        })}
        onClick={busy ? undefined : () => void onRemove()}
      >
        {busy
          ? t.node('appApplicant.appApplicantIdDocumentUploader.removing')
          : t.node('appApplicant.appApplicantIdDocumentUploader.removeThisNewCopy')}
      </button>
      {typeof item.removal === 'object' ? (
        <p className="field-msg-err" role="alert">
          {refusalNode(t, item.removal.problem)}
        </p>
      ) : null}
    </div>
  );
}
