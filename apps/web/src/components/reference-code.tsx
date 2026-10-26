'use client';

import { useState } from 'react';

/**
 * A record's visible reference code (ADR 0018), for example `C-7K2Q9M`, with
 * a Copy button. Shown in even-width figures with a little space between
 * characters so it reads aloud cleanly; the text stays selectable, so when
 * the browser refuses the clipboard the person can copy it by hand. The
 * result is announced through a polite live region. Renders nothing without
 * a code (a record created before migration 0091 ran, while it runs): never
 * a placeholder.
 */
export function ReferenceCode({
  code,
  label = 'Reference',
}: {
  readonly code: string | null | undefined;
  readonly label?: string;
}) {
  const [status, setStatus] = useState('');
  if (!code) return null;

  async function copy() {
    setStatus('');
    if (!navigator.clipboard?.writeText) {
      setStatus('Copying is blocked here. Select the reference and copy it with your keyboard.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code as string);
      setStatus('Copied');
    } catch {
      setStatus('Copying is blocked here. Select the reference and copy it with your keyboard.');
    }
  }

  return (
    <span className="reference-code">
      <span className="reference-code-label">{label}</span>{' '}
      <span className="reference-code-value" translate="no">
        {code}
      </span>
      <button
        type="button"
        className="btn btn-secondary u-btn-sm reference-code-copy"
        aria-label={`Copy Reference ${code}`}
        onClick={copy}
      >
        Copy
      </button>
      <output aria-live="polite" className="reference-code-status">
        {status}
      </output>
    </span>
  );
}
