import type { Metadata } from 'next';
import Link from 'next/link';
import { signOutCurrentUser } from '../../../lib/sign-out';
import { AuthShell } from '../auth-ui';

export const metadata: Metadata = { title: 'Account access needs verification' };

export default function AccountRecoveryPage() {
  return (
    <AuthShell title="Account access needs verification">
      <p className="card-body">
        We could not safely connect this sign-in to an account. Your records have not been changed.
        Sign out and try the account you previously used. If you still cannot get access, ask the
        person who invited you to arrange account verification.
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
            Sign out
          </button>
        </form>
        <Link className="btn btn-secondary" href="/">
          Back to home
        </Link>
      </div>
    </AuthShell>
  );
}
