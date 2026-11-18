'use client';

import { useEffect, useRef } from 'react';

/**
 * Put inside the body of an Expandable Section that holds a form: when a person opens the section
 * (a press, Enter or Space on its row), focus moves to the form's first field, so typing can start
 * at once. A section drawn open, or opened by a link, keeps the focus where it is.
 */
export function FocusFirstFieldOnOpen() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const details = marker.current?.closest('details');
    const row = details?.querySelector(':scope > summary');
    if (!details || !row) return;
    const onPress = () => {
      // A press on an open section closes it: nothing to focus.
      if (details.open) return;
      window.setTimeout(() => {
        details.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')?.focus();
      });
    };
    row.addEventListener('click', onPress);
    return () => row.removeEventListener('click', onPress);
  }, []);
  return <span ref={marker} hidden />;
}
