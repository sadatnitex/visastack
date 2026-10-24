import { SIGNUP_PRIVACY_VERSION } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { readEnv } from '../../lib/env';
import { selectedIdentityProvider } from '../../lib/identity-selection';

export const metadata: Metadata = { title: 'Privacy notice' };
export const dynamic = 'force-dynamic';

export default function PrivacyPage() {
  const storage = readEnv('STORAGE_PROVIDER');
  const fileStorage =
    storage === 'r2'
      ? 'Cloudflare R2'
      : storage === 'vercel_blob'
        ? 'Vercel'
        : storage === 'neon'
          ? 'Neon'
          : 'The configured private storage service';
  return (
    <section className="section container" style={{ maxWidth: '48rem' }}>
      <h1 className="page-title">Privacy notice</h1>
      <p className="card-body">
        Version {SIGNUP_PRIVACY_VERSION}. This beta notice awaits legal review.
      </p>
      <h2>Information and purpose</h2>
      <p>
        Account registration uses your name, email address and sign-in information to create and
        protect your account and send confirmation or recovery messages. Security controls record
        registration attempts and notice versions. During the free public beta you may add your own
        information and documents at your own risk; some protections, such as virus scanning of
        uploads, are not switched on yet.
      </p>
      <h2>Services that process information</h2>
      <p>
        Vercel hosts the application. {fileStorage} stores private files. Cloudflare R2 stores
        encrypted backup archives when backups are configured. Neon stores application records.{' '}
        {selectedIdentityProvider() === 'neon_auth' ? 'Neon Auth' : 'WorkOS'} handles sign-in.
        Resend handles application email when configured. Authentication email uses the configured
        sign-in provider's mail service. These services can process information outside your
        country. This notice does not claim a particular data location or a completed compliance
        review.
      </p>
      <h2>Separate choices</h2>
      <p>
        Acknowledging this notice does not grant marketing permission, enable optional AI processing
        or share records with an agency. Sharing and optional processing require their own choices
        and applicable permissions. We do not request marketing consent during registration.
      </p>
      <h2>Access, export and deletion</h2>
      <p>
        Signed-in users can use <Link href="/app/privacy">privacy controls</Link> to review
        available consent choices, export their account information or request deletion. Deletion is
        a process, not an immediate promise to erase every record: legal holds and required audit
        retention can restrict it. Revoking sharing stops future permitted access; it cannot recall
        copies someone has already downloaded.
      </p>
      <h2>Storage and recovery</h2>
      <p>
        Independent backup and restore protections are still being completed. Do not use this pilot
        as the only copy of important records. Keep your own originals until real-data safeguards
        and their acceptance checks are complete.
      </p>
      <p>
        <Link href="/terms">Read the terms of use</Link> or{' '}
        <Link href="/auth/sign-up">return to account creation</Link>.
      </p>
    </section>
  );
}
