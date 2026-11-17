'use client';

import { useEffect, useState } from 'react';

/**
 * Share Progress Card (WP-PIC15, owner decision D5 of 17 Nov 2026). The picture is made on the
 * server for the record's owner (counts only) at `/api/progress-card/<case>`.
 *
 * Where the phone can share a picture through its own share sheet, one button does that. Anywhere
 * else a plain Download link saves the same picture. Nothing shows until the browser has said
 * which it can do, so no control is ever offered that cannot work. The page shows this only while
 * the owner's PROGRESS_CARD switch is on.
 */

export const SHARE_PROGRESS_CARD = 'Share Progress Card';
export const DOWNLOAD_PROGRESS_CARD = 'Download Progress Card';
export const PROGRESS_CARD_BUSY = 'Making Your Card';
export const PROGRESS_CARD_FAILED = 'The card could not be made just now. Try again in a moment.';
const FILE_NAME = 'progress-card.png';

export function progressCardHref(missionId: string): string {
  return `/api/progress-card/${encodeURIComponent(missionId)}`;
}

type Mode = 'unknown' | 'share' | 'download';

/** True when this browser can hand a PNG file to the phone's share sheet. */
export function canShareImageFiles(nav: Navigator | undefined): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array([0x89])], FILE_NAME, { type: 'image/png' });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function ProgressCardShare({ missionId }: { readonly missionId: string }) {
  const [mode, setMode] = useState<Mode>('unknown');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const href = progressCardHref(missionId);

  useEffect(() => {
    setMode(
      canShareImageFiles(typeof navigator === 'undefined' ? undefined : navigator)
        ? 'share'
        : 'download',
    );
  }, []);

  async function share() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(href, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`card ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], FILE_NAME, { type: 'image/png' });
      await navigator.share({ files: [file], title: 'Progress Card' });
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'unknown') return null;
  return (
    <div className="progress-card-share">
      {mode === 'share' ? (
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          onClick={share}
        >
          {busy ? PROGRESS_CARD_BUSY : SHARE_PROGRESS_CARD}
        </button>
      ) : (
        <a className="btn btn-primary" href={href} download={FILE_NAME}>
          {DOWNLOAD_PROGRESS_CARD}
        </a>
      )}
      <output className="progress-card-share-status" aria-live="polite">
        {failed ? PROGRESS_CARD_FAILED : ''}
      </output>
    </div>
  );
}
