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
  type SharedFile,
  type SharedInbox,
  parseInbox,
  sharedFileUrl,
} from '../../../lib/pwa/share-target';
import { importLine } from '../applicant/[id]/import/import-panel';

type Phase = 'loading' | 'empty' | 'ready' | 'sending' | 'cancelled';

/** Asks the service worker for the files waiting on this phone. Anything else is "nothing". */
export async function readSharedInbox(ownerKey: string | null): Promise<SharedInbox> {
  if (!ownerKey || typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) {
    return parseInbox(null);
  }
  try {
    // The key goes in a header, never in the address, so no server log can ever hold it.
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

/** Empties the inbox on this phone. A failure leaves it to the 15-minute limit. */
export async function clearSharedInbox(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;
  try {
    await fetch(SHARE_CLEAR_PATH, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    // Left to the time limit.
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
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [inbox, setInbox] = useState<SharedInbox>(parseInbox(null));
  const [personId, setPersonId] = useState<string>(people[0]?.id ?? '');
  const [unreadable, setUnreadable] = useState(0);
  // True once every waiting file has been read back and handed to the queue.
  const [handedOver, setHandedOver] = useState(false);
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
      }),
    [personId, limitBytes, limitLabel, pdfAccepted, retryUnknown],
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const items = snapshot.order.flatMap((id) => {
    const item = snapshot.byId.get(id);
    return item ? [item] : [];
  });
  const counts = countItems(items);
  const finished =
    phase === 'sending' && handedOver && items.every((item) => FINAL_STATES.has(item.state));

  // Every file has an answer: the copies on this phone are no longer needed.
  useEffect(() => {
    if (finished) void clearSharedInbox();
  }, [finished]);

  const addThem = useCallback(async () => {
    if (!ownerKey || phase !== 'ready') return;
    setPhase('sending');
    const read = await Promise.all(
      inbox.files.map((file) => candidateFor(file, inbox.token, inbox.at + file.n)),
    );
    const candidates = read.filter((c): c is ImportCandidate => c !== null);
    setUnreadable(read.length - candidates.length);
    await queue.add(candidates);
    setHandedOver(true);
  }, [ownerKey, phase, inbox, queue]);

  const cancel = useCallback(async () => {
    await clearSharedInbox();
    setInbox(parseInbox(null));
    setPhase('cancelled');
  }, []);

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
              <h2 id={titleId}>Shared Files Removed</h2>
              <p>Nothing was sent. The originals are still in the app you shared them from.</p>
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
  const waiting = phase === 'ready';

  return (
    <article className="card incoming-card" aria-labelledby={titleId}>
      <div className="card-body">
        <h2 id={titleId}>Shared Just Now</h2>
        <p>
          {waiting
            ? `${fileWord(inbox.files.length)} from another app. They are still only on this phone: nothing is sent until you choose Add These Files. Only add files you shared yourself just now.`
            : `Adding ${fileWord(inbox.files.length)} for ${chosen?.name ?? 'this person'}. Please keep this page open.`}
        </p>
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
                Add These Files
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void cancel()}>
                Cancel
              </button>
            </p>
          </>
        ) : (
          <>
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
                  {`Finished: ${counts.added} added${counts.total > counts.added ? `, ${counts.total - counts.added} need a look` : ''}. The shared copies kept on this phone are removed; your originals are untouched.`}
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
                  <Link className="btn btn-primary" href={`/app/applicant/${personId}/documents`}>
                    Open Documents
                  </Link>
                  <Link
                    className="btn btn-secondary"
                    href={`/app/applicant/${personId}/documents/add`}
                  >
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
