'use client';

import { useRouter } from 'next/navigation';
import { ReceiptCard } from '../../../../../components/receipt-card';

/**
 * The receipt after a request is answered (F2). It is drawn by the page from the address
 * (`?item=<request>&done=answered`) and the request's own saved answer time, not from the reply
 * form's memory: the form is rebuilt when the page refreshes after the answer, so anything it held
 * would be gone. Done takes `done` out of the address (no new history entry) and hands focus to the
 * panel's own control. It states only what the page already holds: the item, the confirmed moment
 * in the traveller's zone and the request's reference. Nobody has looked at the answer yet.
 */
export function AnswerReceipt({
  applicantId,
  itemName,
  respondedAt,
  timeZone,
  referenceCode,
  honestLine,
}: {
  readonly applicantId: string;
  readonly itemName: string;
  /** The moment the answer was saved, from the request (server time), as an ISO string. */
  readonly respondedAt: string;
  readonly timeZone: string;
  readonly referenceCode?: string;
  /** What is true about review right now; left out once the agency has already decided. */
  readonly honestLine?: string;
}) {
  const router = useRouter();
  return (
    <ReceiptCard
      title="Answer Sent"
      what={`${itemName} went to the agency.`}
      at={respondedAt}
      timeZone={timeZone}
      reference={referenceCode ? { code: referenceCode, label: 'Request Reference' } : undefined}
      honestLine={honestLine}
      next={{
        label: 'Back to Requests',
        href: `/app/applicant/${applicantId}/evidence`,
        closesPane: true,
      }}
      onDone={() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('done');
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      }}
      returnFocusTo={() =>
        document.querySelector<HTMLElement>(
          '.rt-pane summary, .rt-pane a:not([data-pane-close]), .lp-pane-bar a',
        )
      }
    />
  );
}
