'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The outcome line after a decision. The decided request has left the list (and the button that
 * had focus with it), so focus comes here and the polite status is filled after it renders empty,
 * which screen readers announce reliably.
 */
export function DecisionStatus({
  id,
  message,
}: {
  readonly id: string;
  readonly message: string | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!message) return;
    setShown(message);
    box.current?.focus();
  }, [message]);
  return (
    <div id={id} ref={box} tabIndex={-1} className="lc-removal-status">
      <output className={shown ? 'notice notice-ok' : undefined}>{shown}</output>
    </div>
  );
}
