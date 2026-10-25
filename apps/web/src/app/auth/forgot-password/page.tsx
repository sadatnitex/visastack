import type { Metadata } from 'next';
import Link from 'next/link';
import { requestPasswordResetAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Reset your password' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address.',
  slow: 'Too many requests. Please wait a little while and try again.',
  unavailable: 'We could not request a link right now. Please try again in a few minutes.',
  expired: 'That link has expired or was already used. Ask for a new one below.',
};

export default async function ForgotPasswordPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; sent?: string }> }) {
  const { e, sent } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Reset your password">
      {sent === '1' ? (
        <div className="card u-mb-100">
          <h2 className="card-title">Check your email</h2>
          <Notice>
            If an account uses that address, a password reset link will arrive shortly. Check your
            inbox and spam folder. If you do not have an account, you can create one instead.
          </Notice>
          <details className="u-mt-100">
            <summary>Did not get a link? Send another</summary>
            <p className="card-body">
              Wait a few minutes, then enter your email to request a new link.
            </p>
            <RecoveryForm resend />
          </details>
          <p className="card-body u-mt-100">
            <Link href="/auth/forgot-password">Use a different email address</Link>
            {' · '}
            <Link href="/auth/sign-up">Create an account</Link>
          </p>
        </div>
      ) : (
        <>
          <ErrorLine id="forgot-error" message={error} />
          <div className="card u-mb-100">
            <RecoveryForm error={error} />
          </div>
        </>
      )}
      <p className="card-body">
        <Link href="/auth/sign-in">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

function RecoveryForm({ error, resend = false }: { error?: string | undefined; resend?: boolean }) {
  return (
    <form action={requestPasswordResetAction} className="field-list">
      <TextField
        id={resend ? 'resend-email' : 'email'}
        name="email"
        type="email"
        label="Email address"
        autoComplete="email"
        required
        maxLength={254}
        errorId={error ? 'forgot-error' : undefined}
      />
      <button type="submit" className="btn btn-primary">
        {resend ? 'Send another link' : 'Send me a link'}
      </button>
    </form>
  );
}
