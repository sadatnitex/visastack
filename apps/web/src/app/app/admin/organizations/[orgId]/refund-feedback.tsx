'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { RefundFormState } from './refund-state';

/**
 * The card-level result of the refund and credit forms (S18). A full refund or a credit can take
 * away the very row whose form was used, and its own message with it, so every form also reports
 * here: a polite region at the top of the card says what happened, and focus moves to the
 * refund's line in the Refunds list (or to this region when there is no line), once the page has
 * been drawn again.
 */

type Report = (result: RefundFormState) => void;

const ReportContext = createContext<Report>(() => undefined);

/** What a form calls with each reply. Outside the card (in tests) it does nothing. */
export function useRefundReport(): Report {
  return useContext(ReportContext);
}

export function RefundFeedback({ children }: { readonly children: ReactNode }) {
  const [last, setLast] = useState<{ readonly result: RefundFormState; readonly n: number } | null>(
    null,
  );
  const region = useRef<HTMLOutputElement>(null);
  const report = useCallback<Report>((result) => {
    setLast((before) => ({ result, n: (before?.n ?? 0) + 1 }));
  }, []);
  // Said here for a success and for any result about a refund line (a refund written but not
  // confirmed, say), because the row whose form was used may be gone after the page is drawn again.
  const shown = last !== null && (last.result.ok || last.result.focusId !== undefined);
  useEffect(() => {
    if (!last || !(last.result.ok || last.result.focusId !== undefined)) return;
    // Wait for the page drawn again after the action, then move focus to the new line.
    const timer = window.setTimeout(() => {
      const line = last.result.focusId ? document.getElementById(last.result.focusId) : null;
      (line ?? region.current)?.focus();
    }, 100);
    return () => window.clearTimeout(timer);
  }, [last]);
  return (
    <ReportContext.Provider value={report}>
      <output
        ref={region}
        tabIndex={-1}
        className={`field-msg ${last?.result.ok === false ? 'field-msg-err' : 'field-msg-ok'}`}
      >
        {last && shown ? last.result.message : ''}
      </output>
      {children}
    </ReportContext.Provider>
  );
}

/**
 * A disclosure whose content is drawn only once it is opened, so a page with many payments does
 * not draw (or make keys for) every form up front.
 */
export function LazyDisclosure({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="disclosure u-mt-100"
      // Full width inside a payment's box, so the form it opens lays its fields side by side.
      style={{ justifySelf: 'stretch' }}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>
        <span className="disclosure-title">{title}</span>
      </summary>
      <div className="disclosure-body">{opened ? children : null}</div>
    </details>
  );
}
