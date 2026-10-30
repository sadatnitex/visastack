import { type AgencyBillingNotice, type Db, getAgencyBillingNotice } from '@visastack/services';
import Link from 'next/link';
import { reportServerError } from '../../../../lib/server-error';

/**
 * The agency's Grace or Suspended standing for its notice, for anyone who belongs to the agency
 * (the service checks that), otherwise null. A standing that cannot be read never breaks the
 * page it sits on: the notice is left out and the failure is reported.
 */
export async function loadBillingNotice(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<AgencyBillingNotice | null> {
  try {
    const notice = await getAgencyBillingNotice(db, { actorAccountId: accountId, organizationId });
    return notice.ok ? notice.value : null;
  } catch (error) {
    reportServerError('billingStatusNotice', error, { step: 'reading the billing status' });
    return null;
  }
}

interface Words {
  readonly title: string;
  readonly body: string;
}

/**
 * What the notice says (S30, audit M4). An unpaid invoice is named only when the status really
 * comes from one: a status a person set, or one with nothing owed, reads as a hold with no claim
 * about invoices. Members never get money detail.
 */
export function billingNoticeWords(notice: AgencyBillingNotice, admin: boolean): Words {
  const fromAnInvoice = !notice.setByPerson && notice.invoiceOwed;
  if (notice.status === 'GRACE') {
    if (!fromAnInvoice) {
      return {
        title: 'Your Agency Is in Grace',
        body: "Your agency's billing needs attention. Everything still works. Nothing is deleted or hidden. Contact VisaStack if you have questions.",
      };
    }
    return {
      title: 'Your Agency Is in Grace',
      body: admin
        ? 'An invoice is past its due date. Everything still works for now. Pay it so adding cases, team members and files never pauses. Nothing is deleted or hidden.'
        : 'An invoice for your agency is past its due date. Everything still works. An owner or admin can see the details.',
    };
  }
  if (!fromAnInvoice) {
    return {
      title: "Your Agency's Billing Is on Hold",
      body: "Your agency's billing is on hold, so adding cases, team members and files is paused. Nothing is deleted or hidden. Contact VisaStack if you have questions.",
    };
  }
  return {
    title: 'Your Agency Is Suspended',
    body: admin
      ? 'An invoice is still unpaid, so adding cases, team members and files is paused until it is paid. Everything already here still works: open cases, records and documents. Nothing is deleted or hidden.'
      : 'Adding cases, team members and files is paused for your agency. Everything already here still works, and nothing is deleted or hidden. An owner or admin can resolve it.',
  };
}

/**
 * A calm notice at the top of Plan and Usage, Invoices and the agency home while the agency is in
 * Grace or Suspended (S30). It says what the status means, what is paused and what still works.
 * Owners and admins get one action, Pay Invoice, only while an invoice is owed. It is part of the
 * page, not an alert, and it cannot be dismissed while it is true. Its title is a level-two
 * heading: every page it sits on has its one level-one heading above it.
 */
export function BillingStatusNotice({
  notice,
  admin,
  organizationId,
  showAction = true,
}: {
  readonly notice: AgencyBillingNotice | null;
  readonly admin: boolean;
  readonly organizationId: string;
  /** False on the Invoices page itself, where the invoices are right below. */
  readonly showAction?: boolean;
}) {
  if (!notice) return null;
  const words = billingNoticeWords(notice, admin);
  const titleId = `billing-status-${organizationId}`;
  return (
    <section
      className="notice notice-warn billing-status-notice"
      aria-labelledby={titleId}
      data-status={notice.status.toLowerCase()}
    >
      <h2 className="billing-status-title" id={titleId}>
        {words.title}
      </h2>
      <p className="billing-status-body">{words.body}</p>
      {admin && showAction && notice.invoiceOwed ? (
        <Link className="btn btn-primary" href={`/app/agency/${organizationId}/plan/invoices`}>
          Pay Invoice
        </Link>
      ) : null}
    </section>
  );
}
