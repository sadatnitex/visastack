import { getWhatsAppConnection } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { formatDateOnly } from '../../../../lib/format-date';
import { withSession } from '../../../../lib/session';
import { readWhatsAppConfig } from '../../../../lib/whatsapp';
import { disconnectWhatsAppAction } from './actions';
import { ConnectWhatsAppForm } from './connect-form';

export const metadata: Metadata = { title: 'WhatsApp' };

export const dynamic = 'force-dynamic';

/**
 * Connect or disconnect WhatsApp (Lane D contract sections 6 and 11). The connection is optional:
 * nothing in VisaStack depends on it, and losing the phone never locks anyone out.
 */
export default async function WhatsAppPage() {
  const available = readWhatsAppConfig() !== null;
  const connection = await withSession(({ db, accountId }) => getWhatsAppConnection(db, accountId));
  const ready = available && connection.available;

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Account"
        title="WhatsApp"
        description="Ask about your cases from WhatsApp. Everything else stays in VisaStack."
      />
      <div className="grid">
        {!ready ? (
          <article className="card">
            <h2 className="card-title">WhatsApp Is Not Available Yet</h2>
            <p className="card-body">You can use everything in VisaStack without WhatsApp.</p>
          </article>
        ) : connection.connected ? (
          <article className="card">
            <p className="card-kicker">Connected</p>
            <h2 className="card-title">Your WhatsApp Is Connected</h2>
            <div className="rows u-mt-050">
              {connection.maskedNumber ? (
                <p className="row">
                  <span className="row-key">Number</span>
                  <span>{connection.maskedNumber}</span>
                </p>
              ) : null}
              {connection.connectedAt ? (
                <p className="row">
                  <span className="row-key">Connected On</span>
                  <span>{formatDateOnly(connection.connectedAt)}</span>
                </p>
              ) : null}
              <p className="row">
                <span className="row-key">Messages</span>
                <span>{connection.messagesOff ? 'Off (send START to turn them on)' : 'On'}</span>
              </p>
            </div>
            <p className="card-body u-mt-050">
              Send MENU in WhatsApp to see what you can ask. Send STOP to turn messages off.
            </p>
            <form action={disconnectWhatsAppAction}>
              <button type="submit" className="btn btn-secondary">
                Disconnect WhatsApp
              </button>
            </form>
          </article>
        ) : (
          <article className="card">
            <p className="card-kicker">Not Connected</p>
            <h2 className="card-title">Connect WhatsApp</h2>
            <p className="card-body u-mb-125">
              Get a one-time code here, then send it from your WhatsApp. Only you can connect it,
              because the code comes from your signed-in account.
            </p>
            <ConnectWhatsAppForm />
          </article>
        )}

        <article className="card">
          <p className="card-kicker">Privacy</p>
          <h2 className="card-title">What Happens in WhatsApp</h2>
          <ul className="card-body">
            <li>You can ask where your cases stand, what is missing and what expires soon.</li>
            <li>VisaStack never asks for passport, ID or bank details in WhatsApp.</li>
            <li>
              Documents are added in VisaStack, not in chat, so they stay private and checked.
            </li>
            <li>Messages pass through WhatsApp, which is run by Meta.</li>
          </ul>
          <Link href="/app/privacy">Privacy and Consent</Link>
        </article>
      </div>
    </section>
  );
}
