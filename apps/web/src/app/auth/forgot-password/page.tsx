import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { requestPasswordResetAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Reset your password' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address.',
  slow: 'Too many requests. Please wait a little while and try again.',
  expired: 'That link has expired or was already used. Ask for a new one below.',
};

export default async function ForgotPasswordPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; sent?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { e, sent } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Reset your password">
      {sent === '1' ? (
        <Notice>
          If that address has an account, we have sent a link to choose a new password. It can take
          a few minutes to arrive. Check your spam folder too.
        </Notice>
      ) : null}
      <ErrorLine id="forgot-error" message={error} />
      <div className="card" style={{ marginBottom: '1rem' }}>
        <form action={requestPasswordResetAction} className="field-list">
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email address"
            autoComplete="email"
            required
            maxLength={254}
            errorId={error ? 'forgot-error' : undefined}
          />
          <button type="submit" className="btn btn-primary">
            Send me a link
          </button>
        </form>
      </div>
      <p className="card-body">
        <Link href="/auth/sign-in">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
