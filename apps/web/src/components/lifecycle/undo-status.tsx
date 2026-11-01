'use client';
import { useEffect, useRef, useState } from 'react';

/** How long Undo stays offered (PROGRAMME section 3.4). */
export const UNDO_WINDOW_MS = 10_000;

/**
 * A polite status line after an action ("Moved to Archived.") with an Undo button for ten
 * seconds. Focus-safe: if the button has focus when it goes (time is up, or it was used), focus
 * moves to the status line itself instead of falling to the top of the page.
 */
export function UndoStatus({
  message,
  onUndo,
  undoneMessage = 'Undone.',
  windowMs = UNDO_WINDOW_MS,
}: {
  readonly message: string;
  readonly onUndo: () => void | Promise<void>;
  readonly undoneMessage?: string;
  readonly windowMs?: number;
}) {
  const [phase, setPhase] = useState<'offered' | 'working' | 'undone' | 'expired'>('offered');
  const status = useRef<HTMLOutputElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase !== 'offered') return;
    const timer = window.setTimeout(() => {
      if (document.activeElement === undoButton.current) status.current?.focus();
      setPhase('expired');
    }, windowMs);
    return () => window.clearTimeout(timer);
  }, [phase, windowMs]);

  const undo = async () => {
    setPhase('working');
    try {
      await onUndo();
      setPhase('undone');
    } catch {
      setPhase('expired');
    } finally {
      status.current?.focus();
    }
  };

  return (
    <output ref={status} className="lc-undo" aria-live="polite" tabIndex={-1}>
      <span>{phase === 'undone' ? undoneMessage : message}</span>
      {phase === 'offered' || phase === 'working' ? (
        <button
          ref={undoButton}
          type="button"
          className="btn btn-secondary lc-undo-button"
          disabled={phase === 'working'}
          onClick={undo}
        >
          Undo
        </button>
      ) : null}
    </output>
  );
}
