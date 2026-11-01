'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UNDO_WINDOW_MS, UndoStatus } from '../../../../../../../components/lifecycle/undo-status';
import type { ManageActionProps } from '../registry';
import { type ArchiveActionResult, archiveDocumentAction, restoreDocumentAction } from './actions';
import {
  announce,
  closeUndoWindow,
  ensureAnnouncer,
  keepFocusThroughRefresh,
  openUndoWindow,
} from './list-refresh';

type Change = (applicantId: string, documentId: string) => Promise<ArchiveActionResult>;

const NOT_THROUGH = 'That did not go through. Check your connection and try again.';

interface Wording {
  /** The deep-link action value that names this change (?manage=<id>&action=<value>). */
  readonly action: 'ARCHIVE' | 'RESTORE';
  readonly confirm: string;
  readonly working: string;
  readonly done: (documentName: string) => string;
  readonly undone: string;
}

const ARCHIVE_WORDING: Wording = {
  action: 'ARCHIVE',
  confirm: 'Archive This Document',
  working: 'Moving to Archived.',
  done: (name) =>
    `${name} moved to Archived. Cases that chose it still use it; other cases stop counting it.`,
  undone: 'Undone. It is back in your current documents.',
};

const RESTORE_WORDING: Wording = {
  action: 'RESTORE',
  confirm: 'Restore This Document',
  working: 'Restoring.',
  done: (name) => `${name} is back in your current documents.`,
  undone: 'Undone. It is back in Archived.',
};

async function attempt(change: Change, applicantId: string, documentId: string) {
  try {
    return await change(applicantId, documentId);
  } catch {
    return { ok: false, message: NOT_THROUGH } as const;
  }
}

type Phase =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * One archive change. Chosen from the Manage menu it runs at once; opened from a reminder's link
 * it waits for a click, so following a link never changes anything by itself. After the change,
 * Undo stays for ten seconds; the list refreshes only once every open Undo has had its time. A
 * successful Undo closes the panel, so the menu can be used again straight away.
 */
function ArchiveChange({
  applicantId,
  documentId,
  documentName,
  onClose,
  change,
  undo,
  wording,
}: ManageActionProps & {
  readonly change: Change;
  readonly undo: Change;
  readonly wording: Wording;
}) {
  const router = useRouter();
  // Held in a ref so the cleanup below runs only when the panel leaves, never on a new router.
  const routerRef = useRef(router);
  routerRef.current = router;
  const params = useSearchParams();
  const deepLinked =
    params?.get('manage')?.toLowerCase() === documentId.toLowerCase() &&
    params?.get('action') === wording.action;
  const [phase, setPhase] = useState<Phase>({ kind: deepLinked ? 'confirm' : 'working' });
  const started = useRef(false);
  const mounted = useRef(true);
  const window_ = useRef<symbol | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const failure = useRef<HTMLParagraphElement>(null);

  const closeWindow = useCallback((refresh: boolean) => {
    window.clearTimeout(timer.current);
    const token = window_.current;
    if (!token) return;
    window_.current = null;
    closeUndoWindow(token, refresh ? () => routerRef.current.refresh() : undefined);
  }, []);

  const startWindow = useCallback(() => {
    window.clearTimeout(timer.current);
    window_.current ??= openUndoWindow();
    timer.current = window.setTimeout(() => {
      keepFocusThroughRefresh(root.current);
      closeWindow(true);
    }, UNDO_WINDOW_MS);
  }, [closeWindow]);

  const perform = useCallback(async () => {
    setPhase({ kind: 'working' });
    const result = await attempt(change, applicantId, documentId);
    // Left the page meanwhile: nothing on screen to update, and nothing to refresh.
    if (!mounted.current) return;
    if (result.ok) {
      setPhase({ kind: 'done' });
      announce(wording.done(documentName));
      startWindow();
    } else {
      setPhase({ kind: 'failed', message: result.message });
    }
  }, [applicantId, change, documentId, documentName, startWindow, wording]);

  useEffect(() => {
    mounted.current = true;
    ensureAnnouncer();
    return () => {
      mounted.current = false;
      closeWindow(false);
    };
  }, [closeWindow]);

  useEffect(() => {
    // Once per choice, even when React runs effects twice in development; never from a link.
    if (started.current || deepLinked) return;
    started.current = true;
    void perform();
  }, [deepLinked, perform]);

  useEffect(() => {
    if (phase.kind === 'failed') failure.current?.focus();
  }, [phase]);

  const buttons = (primary: string) => (
    <div className="lc-archive-buttons">
      <button type="button" className="btn btn-primary" onClick={() => void perform()}>
        {primary}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Close
      </button>
    </div>
  );

  return (
    <div ref={root} className="lc-archive">
      {phase.kind === 'confirm' ? (
        <div className="lc-archive-confirm">{buttons(wording.confirm)}</div>
      ) : phase.kind === 'working' ? (
        <output className="lc-archive-working" aria-live="polite">
          {wording.working}
        </output>
      ) : phase.kind === 'failed' ? (
        <div className="lc-archive-failed">
          <p ref={failure} role="alert" tabIndex={-1}>
            {phase.message}
          </p>
          {buttons('Try Again')}
        </div>
      ) : (
        <UndoStatus
          message={wording.done(documentName)}
          undoneMessage={wording.undone}
          onUndo={async () => {
            window.clearTimeout(timer.current);
            const result = await attempt(undo, applicantId, documentId);
            if (!result.ok) {
              // UndoStatus says it failed and keeps its button for another ten seconds.
              if (mounted.current) startWindow();
              throw new Error(result.message);
            }
            announce(wording.undone);
            closeWindow(true);
            if (mounted.current) onClose();
          }}
        />
      )}
    </div>
  );
}

/** Manage menu: Archive (LC-A1). Undo restores it. */
export function ArchiveAction(props: ManageActionProps) {
  return (
    <ArchiveChange
      {...props}
      change={archiveDocumentAction}
      undo={restoreDocumentAction}
      wording={ARCHIVE_WORDING}
    />
  );
}

/** Manage menu on the Archived list: Restore (LC-A1). Undo archives it again. */
export function RestoreAction(props: ManageActionProps) {
  return (
    <ArchiveChange
      {...props}
      change={restoreDocumentAction}
      undo={archiveDocumentAction}
      wording={RESTORE_WORDING}
    />
  );
}
