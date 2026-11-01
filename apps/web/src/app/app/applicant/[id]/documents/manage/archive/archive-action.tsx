'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UNDO_WINDOW_MS, UndoStatus } from '../../../../../../../components/lifecycle/undo-status';
import type { ManageActionProps } from '../registry';
import { type ArchiveActionResult, archiveDocumentAction, restoreDocumentAction } from './actions';

type Change = (applicantId: string, documentId: string) => Promise<ArchiveActionResult>;

const NOT_THROUGH = 'That did not go through. Check your connection and try again.';

interface Wording {
  readonly working: string;
  readonly done: (documentName: string) => string;
  readonly undone: string;
}

const ARCHIVE_WORDING: Wording = {
  working: 'Moving to Archived.',
  done: (name) => `${name} moved to Archived. Cases that chose it still use it.`,
  undone: 'Undone. It is back in your current documents.',
};

const RESTORE_WORDING: Wording = {
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

/**
 * Runs one archive change as soon as it is chosen from the Manage menu, then offers Undo for ten
 * seconds. The list refreshes only after that (or right after Undo), so the document stays in
 * view, with its Undo, until the person has had the chance to take it back.
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
  const [phase, setPhase] = useState<
    | { readonly kind: 'working' }
    | { readonly kind: 'done' }
    | { readonly kind: 'failed'; readonly message: string }
  >({ kind: 'working' });
  const started = useRef(false);
  const refreshTimer = useRef<number | undefined>(undefined);
  const failure = useRef<HTMLParagraphElement>(null);

  const refreshLater = useCallback(
    (delay: number) => {
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => router.refresh(), delay);
    },
    [router],
  );

  const perform = useCallback(async () => {
    setPhase({ kind: 'working' });
    const result = await attempt(change, applicantId, documentId);
    if (result.ok) {
      setPhase({ kind: 'done' });
      refreshLater(UNDO_WINDOW_MS);
    } else {
      setPhase({ kind: 'failed', message: result.message });
    }
  }, [applicantId, change, documentId, refreshLater]);

  useEffect(() => {
    // Once per choice, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    void perform();
  }, [perform]);

  useEffect(() => () => window.clearTimeout(refreshTimer.current), []);

  useEffect(() => {
    if (phase.kind === 'failed') failure.current?.focus();
  }, [phase]);

  if (phase.kind === 'working') {
    return (
      <output className="lc-archive-working" aria-live="polite">
        {wording.working}
      </output>
    );
  }
  if (phase.kind === 'failed') {
    return (
      <div className="lc-archive-failed">
        <p ref={failure} role="alert" tabIndex={-1}>
          {phase.message}
        </p>
        <div className="lc-archive-buttons">
          <button type="button" className="btn btn-primary" onClick={() => void perform()}>
            Try Again
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
  return (
    <UndoStatus
      message={wording.done(documentName)}
      undoneMessage={wording.undone}
      onUndo={async () => {
        window.clearTimeout(refreshTimer.current);
        const result = await attempt(undo, applicantId, documentId);
        if (!result.ok) {
          // UndoStatus says it failed and keeps its button for another ten seconds.
          refreshLater(UNDO_WINDOW_MS);
          throw new Error(result.message);
        }
        router.refresh();
      }}
    />
  );
}

/** Manage menu: Archive (LC-A1). Runs at once; Undo restores it. */
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

/** Manage menu on the Archived list: Restore (LC-A1). Runs at once; Undo archives it again. */
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
