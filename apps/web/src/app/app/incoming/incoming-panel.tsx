'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { newUploadId } from '../../../lib/document-upload-client-id';
import { sha256Hex } from '../../../lib/import/import-manifest';
import {
  FINAL_STATES,
  type ImportCandidate,
  ImportQueue,
  countItems,
  fingerprintOf,
  sendThroughUploadRoute,
  uploadIdFromHash,
} from '../../../lib/import/import-queue';
import {
  SHARE_CLEAR_PATH,
  SHARE_KEY_HEADER,
  SHARE_LIST_PATH,
  SHARE_MAX_FILES,
  SHARE_PICTURE_TYPES,
  SHARE_TOKEN_HEADER,
  type SharedFile,
  type SharedInbox,
  parseInbox,
  sharedFileUrl,
} from '../../../lib/pwa/share-target';
import { useUploadConnection, useUploadResume } from '../../../lib/pwa/upload-sync-hooks';
import {
  OFFLINE_LINE,
  confirmUploadAccount,
  importLine,
} from '../applicant/[id]/import/import-panel';

type Phase = 'loading' | 'empty' | 'ready' | 'sending' | 'cancelled';

/** Asks the service worker for the files waiting on this phone. Anything else is "nothing". */
export async function readSharedInbox(ownerKey: string | null): Promise<SharedInbox> {
  if (!ownerKey || typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
    return parseInbox(null);
  }
  try {
    // The key (a prop of this page, not a secret) goes in a header, never in the address, so no
    // server log holds it.
    const response = await fetch(SHARE_LIST_PATH, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { [SHARE_KEY_HEADER]: ownerKey },
    });
    if (!response.ok) return parseInbox(null);
    return parseInbox(await response.json());
  } catch {
    return parseInbox(null);
  }
}

/**
 * Empties this share from the phone, named by its token so a page left open from an earlier share
 * never empties a newer one. True only when the worker removed it; anything else is left to the
 * 15-minute limit.
 */
export async function clearSharedInbox(token: string): Promise<boolean> {
  if (!token || typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
    return false;
  }
  try {
    const response = await fetch(SHARE_CLEAR_PATH, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { [SHARE_TOKEN_HEADER]: token },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * One waiting file read back from the inbox as a File the upload queue takes. `lastModified` is the
 * share time plus the file's place, so two files with the same name and size stay two files.
 */
async function candidateFor(
  file: SharedFile,
  token: string,
  at: number,
): Promise<ImportCandidate | null> {
  try {
    const response = await fetch(sharedFileUrl(file.n, token), { cache: 'no-store' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return {
      file: new File([blob], file.name, { type: file.type, lastModified: at }),
      path: '',
    };
  } catch {
    return null;
  }
}

const fileWord = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * The shared files as pictures, the choice of who they are for, and one confirm. Nothing is sent
 * before Add These Files; then each file goes through the same queue and upload route as the
 * import on Add Documents, so every server check is the one a normal upload gets.
 */
export function IncomingPanel({
  ownerKey,
  notice,
  people,
  limitBytes,
  limitLabel,
  pdfAccepted,
  retryUnknown,
  backgroundSync = false,
  accountKey = null,
}: {
  /** Ties the waiting files to this account on this phone; null reads nothing. */
  readonly ownerKey: string | null;
  /**
   * Why nothing may be waiting: `missed`, the share reached the server instead of the phone's own
   * inbox; `none`, the share held no photo or PDF VisaStack takes; null, an ordinary visit.
   */
  readonly notice: 'missed' | 'none' | null;
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly limitBytes: number;
  readonly limitLabel: string;
  readonly pdfAccepted: boolean;
  readonly retryUnknown: boolean;
  /** WP-PIC17: waiting files resume when a dropped connection returns. Default off. */
  readonly backgroundSync?: boolean;
  /** WP-PIC17: who chose these files; waiting files go again only under this sign-in. */
  readonly accountKey?: string | null;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [inbox, setInbox] = useState<SharedInbox>(parseInbox(null));
  const [personId, setPersonId] = useState<string>(people[0]?.id ?? '');
  const [unreadable, setUnreadable] = useState(0);
  // True once every waiting file has been read back and handed to the queue.
  const [handedOver, setHandedOver] = useState(false);
  // Adding stopped before every file reached the queue: the person may try again or cancel.
  const [stopped, setStopped] = useState(false);
  // Whether the phone copies were removed once every file had an answer (null: not known yet).
  const [removed, setRemoved] = useState<boolean | null>(null);
  // Whether Cancel's clear was confirmed by the phone.
  const [cancelCleared, setCancelCleared] = useState(false);
  // True once any file was handed to the upload, so Cancel never claims nothing was sent.
  const [sendStarted, setSendStarted] = useState(false);
  const forId = useId();
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    readSharedInbox(ownerKey).then((found) => {
      if (cancelled) return;
      setInbox(found);
      setPhase(found.files.length > 0 ? 'ready' : 'empty');
    });
    return () => {
      cancelled = true;
    };
  }, [ownerKey]);

  const connection = useUploadConnection(backgroundSync);
  const queue = useMemo(
    () =>
      new ImportQueue({
        applicantId: personId,
        rules: { limitBytes, limitLabel, pdfAccepted, shrinkPhotos: true },
        retryUnknown,
        send: sendThroughUploadRoute,
        // The same person and file always send the same upload id, so adding again after a
        // dropped connection can never store a second copy.
        uploadIdFor: async (file) =>
          uploadIdFromHash(await sha256Hex(`${personId}\u0000${fingerprintOf(file)}`)) ??
          newUploadId(),
        newUploadId,
        ...(connection
          ? { connection, confirmResume: () => confirmUploadAccount(accountKey) }
          : {}),
      }),
    [personId, limitBytes, limitLabel, pdfAccepted, retryUnknown, connection, accountKey],
  );
  // WP-PIC17: a wake from background sync, or the browser's online event, resumes waiting files.
  useUploadResume(connection, queue);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const items = snapshot.order.flatMap((id) => {
    const item = snapshot.byId.get(id);
    return item ? [item] : [];
  });
  const counts = countItems(items);
  const finished =
    phase === 'sending' && handedOver && items.every((item) => FINAL_STATES.has(item.state));

  // Every file has an answer: the copies on this phone are no longer needed. The page says they
  // were removed only once the worker confirms it.
  useEffect(() => {
    if (!finished) return;
    let gone = false;
    clearSharedInbox(inbox.token).then((ok) => {
      if (!gone) setRemoved(ok);
    });
    return () => {
      gone = true;
    };
  }, [finished, inbox.token]);

  const addThem = useCallback(async () => {
    if (!ownerKey || phase !== 'ready') return;
    setPhase('sending');
    setStopped(false);
    try {
      const read = await Promise.all(
        inbox.files.map((file) => candidateFor(file, inbox.token, inbox.at + file.n)),
      );
      const candidates = read.filter((c): c is ImportCandidate => c !== null);
      setUnreadable(read.length - candidates.length);
      if (candidates.length > 0) setSendStarted(true);
      await queue.add(candidates);
      setHandedOver(true);
    } catch {
      // Back to the choice, with Try Again and Cancel. The same files send the same upload ids, so
      // trying again never stores a second copy of one that already arrived.
      setStopped(true);
      setPhase('ready');
    }
  }, [ownerKey, phase, inbox, queue]);

  const cancel = useCallback(async () => {
    setCancelCleared(await clearSharedInbox(inbox.token));
    setInbox(parseInbox(null));
    setPhase('cancelled');
  }, [inbox.token]);

  if (phase === 'loading') {
    return (
      <output className="card incoming-card" aria-live="polite">
        <span className="card-body">Looking for shared files on this phone.</span>
      </output>
    );
  }

  if (phase === 'empty' || phase === 'cancelled') {
    return (
      <article className="card incoming-card" aria-labelledby={titleId}>
        <div className="card-body">
          {phase === 'cancelled' ? (
            <>
              <h2 id={titleId}>{cancelCleared ? 'Shared Files Removed' : 'Cancelled'}</h2>
              <p>
                {`${sendStarted ? 'Some files may already be in Documents.' : 'Nothing was sent.'}${cancelCleared ? '' : ' The shared copies on this phone are removed on their own within 15 minutes.'} The originals are still in the app you shared them from.`}
              </p>
            </>
          ) : notice === 'none' ? (
            <>
              <h2 id={titleId}>Nothing VisaStack Can Take</h2>
              <p>
                {`VisaStack takes photos (JPEG, PNG or HEIC) and PDFs, each up to 25 MB, up to ${SHARE_MAX_FILES} at a time. Nothing was kept.`}
              </p>
            </>
          ) : notice === 'missed' ? (
            <>
              <h2 id={titleId}>That Share Did Not Come Through</h2>
              <p>
                Nothing was kept. Open VisaStack from your home screen once, then share the files
                again. You can also add them from your documents.
              </p>
            </>
          ) : (
            <>
              <h2 id={titleId}>Nothing Waiting</h2>
              <p>
                Share a photo or PDF to VisaStack from another app, such as your gallery or a chat.
                It waits here, on this phone only, for 15 minutes.
              </p>
            </>
          )}
          <p>
            <Link
              className="btn btn-secondary"
              href={`/app/applicant/${people[0]?.id}/documents/add`}
            >
              Add Documents
            </Link>
          </p>
        </div>
      </article>
    );
  }

  const chosen = people.find((person) => person.id === personId) ?? people[0];
  // Links name the person from the server's own list, escaped, never the raw value of the choice.
  const chosenPath = `/app/applicant/${encodeURIComponent(chosen?.id ?? '')}/documents`;
  const waiting = phase === 'ready';

  return (
    <article className="card incoming-card" aria-labelledby={titleId}>
      <div className="card-body">
        {notice === 'missed' ? (
          <output className="incoming-note">
            <strong>That Share Did Not Come Through.</strong> The files below are from an earlier
            share.
          </output>
        ) : null}
        <h2 id={titleId}>Shared Just Now</h2>
        <p>
          {waiting
            ? `${fileWord(inbox.files.length)} from another app. They are still only on this phone: nothing is sent until you choose Add These Files. Only add files you shared yourself just now.`
            : `Adding ${fileWord(inbox.files.length)} for ${chosen?.name ?? 'this person'}. Please keep this page open.`}
        </p>
        {stopped ? (
          <p className="incoming-note" role="alert">
            Adding stopped before it finished. Try again, or cancel to remove these files from this
            phone.
          </p>
        ) : null}
        {inbox.dropped > 0 ? (
          <p className="incoming-note">
            {`${fileWord(inbox.dropped)} not kept. VisaStack takes up to ${SHARE_MAX_FILES} photos or PDFs at a time.`}
          </p>
        ) : null}
        <ul className="incoming-grid">
          {inbox.files.map((file) => (
            <li key={file.n} className="incoming-tile">
              {SHARE_PICTURE_TYPES.includes(file.type) ? (
                <img
                  className="incoming-picture"
                  src={sharedFileUrl(file.n, inbox.token)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="incoming-file" aria-hidden="true">
                  {file.type === 'application/pdf' ? 'PDF' : 'Photo'}
                </span>
              )}
              <span className="incoming-name">{file.name}</span>
            </li>
          ))}
        </ul>
        {waiting ? (
          <>
            {people.length > 1 ? (
              <p className="incoming-person">
                <label htmlFor={forId}>Who Are These For?</label>
                <select id={forId} value={personId} onChange={(e) => setPersonId(e.target.value)}>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </p>
            ) : (
              <p className="incoming-person">{`For ${chosen?.name ?? 'this person'}.`}</p>
            )}
            <p className="incoming-actions">
              <button type="button" className="btn btn-primary" onClick={() => void addThem()}>
                {stopped ? 'Try Again' : 'Add These Files'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void cancel()}>
                Cancel
              </button>
            </p>
          </>
        ) : (
          <>
            {snapshot.waitingForConnection ? (
              <p className="field-hint" data-testid="incoming-offline">
                {OFFLINE_LINE}
              </p>
            ) : null}
            <ul className="incoming-lines" aria-live="polite">
              {items.map((item) => {
                const line = importLine(item);
                return (
                  <li key={item.id}>
                    <strong>{item.name}</strong> {line.flag}
                    {line.text}
                  </li>
                );
              })}
              {unreadable > 0 ? (
                <li>{`${fileWord(unreadable)} could no longer be read on this phone. Share again to add them.`}</li>
              ) : null}
            </ul>
            {finished ? (
              <>
                <output className="incoming-note">
                  {`Finished: ${counts.added} added${counts.total > counts.added ? `, ${counts.total - counts.added} need a look` : ''}.${removed ? ' The shared copies kept on this phone are removed; your originals are untouched.' : ''}`}
                </output>
                <p className="incoming-actions">
                  {counts.held > 0 ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => queue.retryHeld()}
                    >
                      Try Again for All Paused Files
                    </button>
                  ) : null}
                  <Link className="btn btn-primary" href={chosenPath}>
                    Open Documents
                  </Link>
                  <Link className="btn btn-secondary" href={`${chosenPath}/add`}>
                    Add More Files
                  </Link>
                </p>
              </>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
