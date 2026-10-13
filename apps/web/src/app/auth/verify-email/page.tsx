import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { safeReturnPath } from '../../../lib/neon-recency';
import { resendConfirmationAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Confirm your email address' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address.',
  slow: 'Too many requests. Please wait a little while and try again.',
  unavailable: 'We could not request your confirmation email right now. Please try again shortly.',
};

export default async function VerifyEmailPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; s?: string; next?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { e, s, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Confirm your email address">
      <p className="card-body">
        {s === '1'
          ? 'Check your inbox. If your address needs confirmation, a link has been requested. It can take a few minutes, and it may land in your spam folder. Once you have opened it, sign in.'
          : 'You need to confirm your email address before you can use VisaStack. Enter it below and we will send you a new link.'}
      </p>
      {s === '1' ? <Notice>If you do not see it, you can ask for another below.</Notice> : null}
      <ErrorLine id="verify-error" message={error} />
      <div className="card u-mb-100">
        <form action={resendConfirmationAction} className="field-list">
          <input type="hidden" name="next" value={safeReturnPath(next)} />
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email address"
            autoComplete="email"
            required
            maxLength={254}
            errorId={error ? 'verify-error' : undefined}
          />
          <button type="submit" className="btn btn-primary">
            Send the link again
          </button>
        </form>
      </div>
      <p className="card-body">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(safeReturnPath(next))}`}>
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
