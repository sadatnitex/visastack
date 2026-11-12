'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Download Safe Copy (ADR 0022, S23): one button that asks the server for the safe copy of one
 * document (drawn fresh with the owner's black boxes) and saves it. Shown to the owner and, on a
 * shared record, to a person or agency whose access includes safe copies. The server decides
 * everything; this only carries the request and says what happened.
 */

export interface SafeCopyDownloadProps {
  readonly documentId: string;
  /** The page to come back to after confirming identity for a restricted document. */
  readonly returnTo: string;
  /** For a shared record: which relationship the viewer acts through. */
  readonly actingFor?: string;
}

type DownloadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'done' }
  | { readonly kind: 'reauth'; readonly url: string; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export async function readMessage(
  response: Response,
): Promise<{ message: string; reauthUrl?: string }> {
  try {
    const body = (await response.json()) as { message?: unknown; reauthUrl?: unknown };
    return {
      message: typeof body.message === 'string' ? body.message : 'Something went wrong. Try again.',
      ...(typeof body.reauthUrl === 'string' ? { reauthUrl: body.reauthUrl } : {}),
    };
  } catch {
    return { message: 'Something went wrong. Try again.' };
  }
}

export function SafeCopyDownload({ documentId, returnTo, actingFor }: SafeCopyDownloadProps) {
  const [state, setState] = useState<DownloadState>({ kind: 'idle' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = async () => {
    // aria-disabled (not disabled) keeps the button focusable while it works, so a second press
    // is ignored here.
    if (state.kind === 'working') return;
    setState({ kind: 'working' });
    try {
      const response = await fetch('/api/documents/safe-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, returnTo, ...(actingFor ? { actingFor } : {}) }),
      });
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !(type === 'application/pdf' || type === 'image/png')) {
        const { message, reauthUrl } = await readMessage(response);
        if (mounted.current) {
          setState(
            reauthUrl ? { kind: 'reauth', url: reauthUrl, message } : { kind: 'error', message },
          );
        }
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = type === 'application/pdf' ? 'safe-copy.pdf' : 'safe-copy.png';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (mounted.current) setState({ kind: 'done' });
    } catch {
      if (mounted.current) {
        setState({ kind: 'error', message: 'The download did not finish. Try again.' });
      }
    }
  };

  return (
    <div className="safe-copy-download">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={start}
        aria-disabled={state.kind === 'working' ? true : undefined}
      >
        Download Safe Copy
      </button>
      {state.kind === 'working' ? (
        <output className="safe-copy-note" aria-live="polite">
          Making your safe copy. This can take up to half a minute.
        </output>
      ) : null}
      {state.kind === 'done' ? (
        <output className="safe-copy-note" aria-live="polite">
          Safe copy downloaded.
        </output>
      ) : null}
      {state.kind === 'error' ? (
        <p className="notice notice-warn" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'reauth' ? (
        <p className="notice notice-warn" role="alert">
          {state.message}{' '}
          <a className="safe-copy-link" href={state.url}>
            Confirm It Is You
          </a>
        </p>
      ) : null}
    </div>
  );
}
