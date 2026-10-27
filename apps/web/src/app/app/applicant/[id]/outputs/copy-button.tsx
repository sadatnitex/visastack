'use client';

import { useState } from 'react';

const BLOCKED =
  'Copying is blocked here. Select the text on the page and copy it with your keyboard.';

/**
 * Copies a summary when, and only when, the person presses it: nothing is copied when the page
 * opens. Where the browser refuses the clipboard, the text stays on the page and selectable, and
 * the button says so. The result is announced through a polite live region that stays in the page
 * while empty. VisaStack cannot clear a clipboard afterwards and does not claim to.
 */
export function CopyTextButton({
  text,
  label = 'Copy All',
}: {
  readonly text: string;
  readonly label?: string;
}) {
  const [status, setStatus] = useState('');

  async function copy() {
    setStatus('');
    if (!navigator.clipboard?.writeText) {
      setStatus(BLOCKED);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied. It stays on your clipboard until you copy something else.');
    } catch {
      setStatus(BLOCKED);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-secondary output-action" onClick={copy}>
        {label}
      </button>
      <output aria-live="polite" className="output-status">
        {status}
      </output>
    </>
  );
}

/** Opens the browser's print window. The page prints without its menus (see the print rules). */
export function PrintButton({ label = 'Print This Page' }: { readonly label?: string }) {
  return (
    <button
      type="button"
      className="btn btn-secondary output-action"
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
