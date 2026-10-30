import { LEDGER_EXPORT_MAX_ROWS } from '@visastack/services';

/**
 * Download Ledger CSV (Small Commercial V1 S18) on the Billing Rules page: a plain form that asks
 * for one month's file. The download itself checks who is asking and asks for a fresh sign-in
 * check; a refusal comes back here with `ledger` set to a reason.
 */

const REASONS: Readonly<Record<string, string>> = {
  denied: 'Only the platform owner can download the ledger.',
  month: 'Choose a month, then download again.',
  too_many: `That month has more than ${LEDGER_EXPORT_MAX_ROWS.toLocaleString('en-US')} ledger rows, more than one file can hold. Nothing was downloaded.`,
  not_configured: 'This needs an extra sign-in check, which is not available here right now.',
};

export function ledgerProblem(reason: string | undefined): string | null {
  return reason !== undefined && Object.hasOwn(REASONS, reason) ? (REASONS[reason] ?? null) : null;
}

export function LedgerCard({
  thisMonth,
  problem,
}: {
  /** The current Bangladesh month (YYYY-MM), the default and the latest choice. */
  readonly thisMonth: string;
  readonly problem: string | null;
}) {
  return (
    <article className="card u-mb-150" id="ledger" aria-labelledby="ledger-title">
      <h2 className="card-title" id="ledger-title">
        Accounting File
      </h2>
      <p className="card-body">
        One file of every payment, credit and refund counted in a month (Bangladesh time), for your
        accountant. It names each agency but never a traveller. Payments still waiting for a check
        are not in it until they are counted.
      </p>
      {problem ? (
        <p className="notice notice-warn" role="alert">
          {problem}
        </p>
      ) : null}
      <form method="get" action="/app/admin/billing/ledger" className="field-list">
        <div className="field-row">
          <label className="field-label" htmlFor="ledger-month">
            Month
          </label>
          <input
            id="ledger-month"
            name="month"
            type="month"
            required
            max={thisMonth}
            defaultValue={thisMonth}
            className="input"
          />
        </div>
        <div>
          <button type="submit" className="btn btn-secondary">
            Download Ledger CSV
          </button>
        </div>
      </form>
    </article>
  );
}
