import type { Metadata } from 'next';
import Link from 'next/link';
import { signOutCurrentUser } from '../../../lib/sign-out';
import { AuthShell } from '../auth-ui';

export const metadata: Metadata = { title: 'Account Access Needs Verification' };

export default function AccountRecoveryPage() {
  return (
    <AuthShell title="Account Access Needs Verification">
      <p className="card-body">
        We could not safely connect this sign-in to an account. Your records have not been changed.
        If your account was made before October 2026, this new sign-in now waits for the VisaStack
        team to confirm it with you. Once they have, sign in again with the email and password you
        just used. If you still cannot get access, ask the person who invited you to arrange account
        verification.
      </p>
      <p className="card-body">
        Resetting a password confirms access to your email. It does not transfer existing records to
        another account.
      </p>
      <div className="cta-row">
        <form
          action={async () => {
            'use server';
            await signOutCurrentUser();
          }}
        >
          <button type="submit" className="btn btn-primary">
            Sign Out
          </button>
        </form>
        <Link className="btn btn-secondary" href="/">
          Back to Home
        </Link>
      </div>
    </AuthShell>
  );
}
