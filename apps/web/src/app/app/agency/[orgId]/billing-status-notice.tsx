import { type Db, getBillingAccountForOrganization } from '@visastack/services';
import Link from 'next/link';
import { reportServerError } from '../../../../lib/server-error';

/** The billing statuses that change what an agency can do, and so get a notice (S30, audit M4). */
export type NoticeBillingStatus = 'GRACE' | 'SUSPENDED';

/**
 * The agency's billing status when it is Grace or Suspended, for anyone who belongs to the agency
 * (the service checks that), otherwise null. A status that cannot be read never breaks the page
 * it sits on: the notice is left out and the failure is reported.
 */
export async function loadNoticeBillingStatus(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<NoticeBillingStatus | null> {
  try {
    const account = await getBillingAccountForOrganization(db, {
      actorAccountId: accountId,
      organizationId,
    });
    if (!account.ok || !account.value) return null;
    const status = account.value.status;
    return status === 'GRACE' || status === 'SUSPENDED' ? status : null;
  } catch (error) {
    reportServerError('billingStatusNotice', error, { step: 'reading the billing status' });
    return null;
  }
}

const COPY: Readonly<
  Record<
    NoticeBillingStatus,
    { readonly title: string; readonly admin: string; readonly member: string }
  >
> = {
  GRACE: {
    title: 'Your Agency Is in Grace',
    admin:
      'An invoice is past its due date. Everything still works for now. Pay it so adding cases, team members and files never pauses. Nothing is deleted or hidden.',
    member:
      'An invoice for your agency is past its due date. Everything still works. An owner or admin can see the details.',
  },
  SUSPENDED: {
    title: 'Your Agency Is Suspended',
    admin:
      'An invoice is still unpaid, so adding cases, team members and files is paused until it is paid. Everything already here still works: open cases, records and documents. Nothing is deleted or hidden.',
    member:
      'Adding cases, team members and files is paused for your agency. Everything already here still works, and nothing is deleted or hidden. An owner or admin can resolve it.',
  },
};

/**
 * A calm notice at the top of Plan and Usage, Invoices and the agency home while the agency is in
 * Grace or Suspended (S30). It says what the status means, what is paused and what still works,
 * with one action for owners and admins: Pay Invoice. Members get the short version with no money
 * detail. It is part of the page, not an alert, and it cannot be dismissed while it is true.
 */
export function BillingStatusNotice({
  status,
  admin,
  organizationId,
  showAction = true,
}: {
  readonly status: NoticeBillingStatus | null;
  readonly admin: boolean;
  readonly organizationId: string;
  /** False on the Invoices page itself, where the invoices are right below. */
  readonly showAction?: boolean;
}) {
  if (!status) return null;
  const copy = COPY[status];
  const titleId = `billing-status-${organizationId}`;
  return (
    <section
      className="notice notice-warn billing-status-notice"
      aria-labelledby={titleId}
      data-status={status.toLowerCase()}
    >
      <p className="billing-status-title" id={titleId}>
        {copy.title}
      </p>
      <p className="billing-status-body">{admin ? copy.admin : copy.member}</p>
      {admin && showAction ? (
        <Link className="btn btn-primary" href={`/app/agency/${organizationId}/plan/invoices`}>
          Pay Invoice
        </Link>
      ) : null}
    </section>
  );
}
