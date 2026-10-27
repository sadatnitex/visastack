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
        If you already have another sign-in for VisaStack, sign out and use that one. If your
        account was made before VisaStack changed how people sign in, contact VisaStack support or
        the person who invited you: once they have checked with you, sign in again with the email
        and password you just used.
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
