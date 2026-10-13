import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { resetPasswordAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Choose a new password' };
// The email link carries a one-time code, so the form page tells the browser not to pass it on.
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Choose a password of 8 to 128 characters.',
  mismatch: 'The two passwords do not match.',
};

export default async function ResetPasswordPage({
  searchParams,
}: { searchParams: Promise<{ token?: string; e?: string; error?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { token, e, error: linkError } = await searchParams;
  if (!token || linkError) {
    return (
      <AuthShell title="Choose a new password">
        <ErrorLine
          id="reset-error"
          message="That link has expired or is not valid. Ask for a new one."
        />
        <p className="card-body">
          <Link href="/auth/forgot-password">Send me a new link</Link>
        </p>
      </AuthShell>
    );
  }
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Choose a new password">
      <meta name="referrer" content="no-referrer" />
      <ErrorLine id="reset-error" message={error} />
      <div className="card u-mb-100">
        <form action={resetPasswordAction} className="field-list">
          <input type="hidden" name="token" value={token} />
          <TextField
            id="password"
            name="password"
            type="password"
            label="New password (at least 8 characters)"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            errorId={error ? 'reset-error' : undefined}
          />
          <TextField
            id="confirm"
            name="confirm"
            type="password"
            label="Type the new password again"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
          <button type="submit" className="btn btn-primary">
            Change password
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
