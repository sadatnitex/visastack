import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { safeReturnPath } from '../../../lib/neon-recency';
import {
  PENDING_CONFIRMATION_COOKIE,
  decodePendingConfirmation,
} from '../../../lib/pending-confirmation';
import { signInAction } from '../actions';
import { AuthShell, ErrorLine, Notice, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Sign In' };
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
  // After the confirmation link, start with the address this browser just asked us to confirm
  // (the signed, short-lived cookie the confirmation page already uses). It is read here and put
  // in the form only: the address is never added to a link, so it cannot reach logs or history.
  const prefill =
    n === 'confirmed'
      ? decodePendingConfirmation((await cookies()).get(PENDING_CONFIRMATION_COOKIE)?.value)
      : null;
  return (
    <AuthShell title="Sign In">
      {notice ? <Notice>{notice}</Notice> : null}
      <ErrorLine id="signin-error" message={error} />
      <div className="card u-mb-100">
        <form action={signInAction} className="field-list">
          <input type="hidden" name="next" value={safeReturnPath(next)} />
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email Address"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={prefill ?? undefined}
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
            Sign In
          </button>
        </form>
      </div>
      <p className="card-body">
        <Link href="/auth/forgot-password">Forgot your password?</Link>
      </p>
      <p className="card-body">
        New here?{' '}
        <Link href={`/auth/sign-up?next=${encodeURIComponent(safeReturnPath(next))}`}>
          Create an Account
        </Link>
      </p>
    </AuthShell>
  );
}
