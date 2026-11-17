'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { type ImportItem, type ImportSnapshot, canTryAgain } from '../lib/import/import-queue';
import { documentMark } from '../lib/item-icons';
import { Icon, type IconName } from './icons';
import { MarkTile } from './mark-tile';

/**
 * The files still on their way, drawn as pictures (picture-first programme, P2b): the kind of
 * paper, then one state word with its own symbol. Read-only over the import queue that already
 * exists: it never sends anything itself, and Try Again is the queue's own retry. Waiting means
 * not yet sent; nothing here says a file arrived (the import list below says that, from the
 * server's answer). Nothing is drawn when no file is waiting.
 */

export type WaitingKind = 'waiting' | 'sending' | 'trouble';

/** A file that has not reached the server, as a state; null for every file that is settled. */
export function waitingKindOf(item: Pick<ImportItem, 'state'>): WaitingKind | null {
  switch (item.state) {
    case 'queued':
    case 'paused':
    case 'held':
      return 'waiting';
    case 'uploading':
      return 'sending';
    case 'refused':
    case 'unknown':
      return 'trouble';
    default:
      return null;
  }
}

const WORD: Readonly<Record<WaitingKind, string>> = {
  waiting: 'Waiting',
  sending: 'Sending',
  trouble: 'Could Not Send',
};

const STATE_ICON: Readonly<Record<WaitingKind, IconName>> = {
  waiting: 'stateWaiting',
  sending: 'upload',
  trouble: 'alert',
};

/** The one word for a file that has no answer yet: it may or may not have arrived. */
const NOT_CONFIRMED = 'Not Confirmed';

function wordFor(item: Pick<ImportItem, 'state'>, kind: WaitingKind): string {
  return item.state === 'unknown' ? NOT_CONFIRMED : WORD[kind];
}

/** The line the polite read-out says: the counts, and nothing for an empty list. */
export function waitingSummary(items: readonly Pick<ImportItem, 'state'>[], offline: boolean) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const kind = waitingKindOf(item);
    if (!kind) continue;
    const word = wordFor(item, kind);
    counts[word] = (counts[word] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([word, n]) => `${n} ${word}`);
  if (parts.length === 0) return '';
  return `${parts.join(', ')}.${offline ? ' Offline.' : ''}`;
}

const subscribeOnline = (notify: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => undefined;
  }
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

/** Only a hint: a browser that cannot say counts as online. A send still reports its own result. */
const offlineNow = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine;

export interface WaitingSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ImportSnapshot;
}

export function WaitingUploads({
  source,
  onRetry,
}: {
  readonly source: WaitingSource;
  /** The queue's own retry for one file. */
  readonly onRetry: (id: number) => void;
}) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const offline = useSyncExternalStore(subscribeOnline, offlineNow, () => false);
  const rows: { item: ImportItem; kind: WaitingKind }[] = [];
  for (const id of snapshot.order) {
    const item = snapshot.byId.get(id);
    const kind = item ? waitingKindOf(item) : null;
    if (item && kind) rows.push({ item, kind });
  }
  const summary = waitingSummary(
    rows.map((row) => row.item),
    offline,
  );

  // The read-out changes only when the counts do (the same text sets no new state), never on
  // each progress tick.
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    setAnnounce(summary);
  }, [summary]);

  // The read-out is one element that stays mounted (and invisible) even when the list is empty,
  // so the first change is announced.
  return (
    <>
      {rows.length > 0 ? (
        <section className="waiting-uploads" aria-label="Files Waiting to Upload">
          <h3 className="waiting-uploads-title">Still Waiting to Upload</h3>
          {offline ? (
            <p className="waiting-uploads-offline" data-testid="waiting-offline">
              <Icon name="alert" size={16} /> <span>Offline</span>
            </p>
          ) : null}
          <ul className="waiting-uploads-list">
            {rows.map(({ item, kind }) => (
              <li
                key={item.id}
                className="waiting-uploads-row"
                data-kind={kind}
                data-state={item.state}
              >
                <MarkTile mark={documentMark(item.title ?? item.name)} size="lg" />
                <span className="waiting-uploads-state">
                  <Icon name={STATE_ICON[kind]} size={18} />
                  <span className="sr-only">{item.name}: </span>
                  <span className="waiting-uploads-word">{wordFor(item, kind)}</span>
                </span>
                {canTryAgain(item) ? (
                  <button
                    type="button"
                    className="btn btn-secondary waiting-uploads-retry"
                    aria-label={`Try Again: ${item.name}`}
                    onClick={() => onRetry(item.id)}
                  >
                    Try Again
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <output className="sr-only" data-testid="waiting-announce">
        {announce}
      </output>
    </>
  );
}
