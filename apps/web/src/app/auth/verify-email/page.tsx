import type { Metadata } from 'next';
import Link from 'next/link';
import { safeReturnPath } from '../../../lib/neon-recency';
import { resendConfirmationAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Confirm Your Email Address' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address.',
  slow: 'Too many requests. Please wait a little while and try again.',
  unavailable: 'We could not request your confirmation email right now. Please try again shortly.',
};

export default async function VerifyEmailPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; s?: string; next?: string }> }) {
  const { e, s, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Confirm Your Email Address">
      <ol className="auth-steps" aria-label="The three steps">
        <li>1 Create Your Account</li>
        <li aria-current="step">2 Confirm Your Email</li>
        <li>3 Sign In</li>
      </ol>
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
            label="Email Address"
            autoComplete="email"
            required
            maxLength={254}
            errorId={error ? 'verify-error' : undefined}
          />
          <button type="submit" className="btn btn-primary">
            Send the Link Again
          </button>
        </form>
      </div>
      <p className="card-body">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(safeReturnPath(next))}`}>
          Back to Sign In
        </Link>
      </p>
    </AuthShell>
  );
}
