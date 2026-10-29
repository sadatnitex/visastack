import {
  type BillingSettings,
  type OverduePreview,
  getBillingSettings,
  previewOverdueHandling,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader, StatusBadge } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { formatTimestamp } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { AdminRestricted } from '../admin-restricted';
import { BillingRulesForm } from './forms';
import {
  PAID_IN_FULL,
  TRAVELLER_UPLOADS_NOTE,
  WHAT_SUSPENDED_DOES,
  previewSentence,
} from './labels';

export const metadata: Metadata = { title: 'Billing Rules' };

export const dynamic = 'force-dynamic';

const UNAVAILABLE =
  'Billing rules are not available yet. Until they are, VisaStack creates no invoices on its own and never changes a billing status by itself.';

function daysText(value: number | null): string {
  if (value === null) return 'Not set';
  return value === 1 ? '1 day after the due date' : `${value} days after the due date`;
}

function Rules({ settings }: { readonly settings: BillingSettings }) {
  return (
    <div className="rows">
      <div className="row">
        <span className="row-key">Payment Due After</span>
        <span>
          {settings.dueDays === 1 ? '1 day' : `${settings.dueDays} days`} from the start of each
          billing period
        </span>
      </div>
      <div className="row">
        <span className="row-key">Automatic Grace and Suspended</span>
        <StatusBadge tone={settings.overdueHandlingEnabled ? 'warning' : 'neutral'}>
          {settings.overdueHandlingEnabled ? 'On' : 'Off'}
        </StatusBadge>
      </div>
      <div className="row">
        <span className="row-key">Grace</span>
        <span>{daysText(settings.graceAfterDays)}</span>
      </div>
      <div className="row">
        <span className="row-key">Suspended</span>
        <span>{daysText(settings.suspendAfterDays)}</span>
      </div>
      {settings.invoicingStartsAt ? (
        <div className="row">
          <span className="row-key">Invoices Made Automatically From</span>
          <span>{formatTimestamp(settings.invoicingStartsAt)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The platform owner sets when invoices fall due and whether an unpaid one changes an agency's billing status. */
export default async function BillingRulesPage() {
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_SETTINGS_MANAGE',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const read = await getBillingSettings(db, staff.value);
    if (!read.ok) return { kind: 'restricted' as const };
    const settings = read.value;
    if (!settings.available) return { kind: 'unavailable' as const, settings };
    let preview: OverduePreview | null = null;
    if (
      !settings.overdueHandlingEnabled &&
      settings.graceAfterDays !== null &&
      settings.suspendAfterDays !== null
    ) {
      const counted = await previewOverdueHandling(db, staff.value, {
        graceAfterDays: settings.graceAfterDays,
        suspendAfterDays: settings.suspendAfterDays,
      });
      if (counted.ok) preview = counted.value;
    }
    return { kind: 'ready' as const, settings, preview };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/settings', label: 'Settings' }}
        eyebrow="Platform Settings"
        title="Billing Rules"
        description="Each agency on a paid plan gets an invoice at the start of every billing period, with reminders before and after its due date. Choose when invoices are due, and whether an invoice left unpaid moves the agency to Grace and then Suspended."
      />
      {data.kind === 'restricted' ? (
        <AdminRestricted />
      ) : data.kind === 'unavailable' ? (
        <output className="notice notice-warn">{UNAVAILABLE}</output>
      ) : (
        <>
          <article className="card u-mb-150">
            <h2 className="card-title">Current Rules</h2>
            <Rules settings={data.settings} />
            {data.settings.updatedAt && data.settings.updatedByAccountId ? (
              <p className="muted u-fs-085">
                Last changed on {formatTimestamp(data.settings.updatedAt)}.
              </p>
            ) : (
              <p className="muted u-fs-085">The standard rules, never changed.</p>
            )}
          </article>

          <article className="card u-mb-150">
            <h2 className="card-title">What Grace and Suspended Do</h2>
            <p className="card-body">{WHAT_SUSPENDED_DOES}</p>
            <p className="card-body">{PAID_IN_FULL}</p>
            <p className="notice notice-warn">{TRAVELLER_UPLOADS_NOTE}</p>
            {data.preview ? (
              <>
                <h3 className="card-title">Before You Turn It On</h3>
                <p className="card-body">
                  With the saved day counts: {previewSentence(data.preview)}
                </p>
              </>
            ) : null}
          </article>

          <article className="card">
            <h2 className="card-title">Change the Rules</h2>
            <BillingRulesForm
              dueDays={data.settings.dueDays}
              overdueHandlingEnabled={data.settings.overdueHandlingEnabled}
              graceAfterDays={data.settings.graceAfterDays}
              suspendAfterDays={data.settings.suspendAfterDays}
            />
          </article>
        </>
      )}
    </section>
  );
}
