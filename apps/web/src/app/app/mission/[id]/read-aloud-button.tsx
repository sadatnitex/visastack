'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readAloud, readAloudSupported } from '../../../../lib/browser-toolbox/read-aloud';

const noSubscribe = () => () => undefined;

/**
 * An optional "Read This Aloud" control for the case status line. It reads only the text that is
 * already on the page inside the element named by `sourceId`, in the page's language, with the
 * browser's own voice. It is not drawn at all when the browser cannot speak, stops when the page is
 * hidden or when pressed again, and never changes the case.
 */
export function ReadAloudButton({ sourceId }: { readonly sourceId: string }) {
  const supported = useSyncExternalStore(noSubscribe, readAloudSupported, () => false);
  const [speaking, setSpeaking] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop.current?.();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stop.current?.();
    };
  }, []);

  if (!supported) return null;

  const press = () => {
    if (stop.current) {
      stop.current();
      return;
    }
    const source = document.getElementById(sourceId);
    const raw = source ? (source.innerText ?? source.textContent ?? '') : '';
    // The dots between parts are for the eye; a voice would say them aloud.
    const text = raw.replace(/\s*\u00b7\s*/g, ', ');
    let over = false;
    setSpeaking(true);
    const halt = readAloud(text, () => {
      over = true;
      stop.current = null;
      setSpeaking(false);
    });
    if (!over) stop.current = halt;
  };

  const label = speaking ? 'Stop Reading' : 'Read This Aloud';
  return (
    <button
      type="button"
      className="read-aloud-button"
      aria-label={label}
      title={label}
      onClick={press}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        {speaking ? (
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        ) : (
          <>
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            <path
              d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
    </button>
  );
}
