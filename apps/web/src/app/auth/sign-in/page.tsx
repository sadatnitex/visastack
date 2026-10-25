import type { Metadata } from 'next';
import Link from 'next/link';
import { safeReturnPath } from '../../../lib/neon-recency';
import { signInAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not sign you in with those details. Check them and try again.',
  slow: 'Too many attempts. Please wait a little while and try again.',
};

const NOTICES: Record<string, string> = {
  created: 'Your account is ready. Check your inbox to confirm your email address, then sign in.',
  confirmed: 'Your email address is confirmed. You can sign in now.',
  reset: 'Your password has been changed. Sign in with the new one.',
};

export default async function SignInPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; n?: string; next?: string }> }) {
  const { e, n, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  const notice = n ? NOTICES[n] : undefined;
  return (
    <AuthShell title="Sign in">
      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorLine id="signin-error" message={error} />
      <div className="card u-mb-100">
        <form action={signInAction} className="field-list">
          <input type="hidden" name="next" value={safeReturnPath(next)} />
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email address"
            autoComplete="email"
            required
            maxLength={254}
            errorId={error ? 'signin-error' : undefined}
          />
          <TextField
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={128}
          />
          <button type="submit" className="btn btn-primary">
            Sign in
          </button>
        </form>
      </div>
      <p className="card-body">
        <Link href="/auth/forgot-password">Forgot your password?</Link>
      </p>
      <p className="card-body">
        New here?{' '}
        <Link href={`/auth/sign-up?next=${encodeURIComponent(safeReturnPath(next))}`}>
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
