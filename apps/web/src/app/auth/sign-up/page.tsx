import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { safeReturnPath } from '../../../lib/neon-recency';
import { isPublicBetaOpen } from '../../../lib/public-beta';
import { createSignupForm } from '../../../lib/signup-form';
import { signUpAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';
import { SignupContext } from './signup-context';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not create that account. Try a different email address or sign in instead.',
  exists: 'An account already uses this email. Sign in or reset your password.',
  unavailable: 'We could not check your account right now. Please try again shortly.',
  slow: 'Too many attempts. Please wait a little while and try again.',
  notices: 'Read and acknowledge the terms and privacy notice before creating your account.',
  refresh: 'Reload this page and try again. Your registration form could not be accepted.',
};

export default async function SignUpPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; next?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { e, next } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  const signupForm = createSignupForm();
  return (
    <AuthShell
      title="Create your account"
      variant="signup"
      eyebrow={isPublicBetaOpen() ? 'Public beta · Free account' : 'Private pilot'}
      utility={
        <>
          Already have an account?{' '}
          <Link href={`/auth/sign-in?next=${encodeURIComponent(safeReturnPath(next))}`}>
            Sign in
          </Link>
        </>
      }
    >
      <p className="card-body signup-introduction">One profile you can use again and again.</p>
      {!isPublicBetaOpen() ? (
        <p className="card-body signup-invite-note">Access is by invitation.</p>
      ) : null}
      <ol className="auth-steps" aria-label="The three steps">
        <li aria-current="step">1 Create your account</li>
        <li>2 Confirm your email</li>
        <li>3 Sign in</li>
      </ol>
      <p className="notice u-mb-100">
        Do not enter real applicant details or upload real identity documents.
      </p>
      <ErrorLine id="signup-error" message={error} />
      {e === 'exists' && (
        <p className="card-body">
          <Link href={`/auth/sign-in?next=${encodeURIComponent(safeReturnPath(next))}`}>
            Sign in
          </Link>{' '}
          or <Link href="/auth/forgot-password">reset your password</Link>.
        </p>
      )}
      <div className="card u-mb-100">
        <form action={signUpAction} className="field-list">
          <input type="hidden" name="next" value={safeReturnPath(next)} />
          <input type="hidden" name="signupForm" value={signupForm} />
          <div hidden aria-hidden="true">
            <label htmlFor="signup-website">Leave this field empty</label>
            <input id="signup-website" name="website" autoComplete="off" tabIndex={-1} />
          </div>
          <SignupContext />
          <TextField id="name" name="name" label="Your name" autoComplete="name" maxLength={120} />
          <TextField
            id="email"
            name="email"
            type="email"
            label="Email address"
            autoComplete="email"
            required
            maxLength={254}
            errorId={error ? 'signup-error' : undefined}
          />
          <TextField
            id="password"
            name="password"
            type="password"
            label="Password (at least 8 characters)"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
          <label className="card-body signup-consent" htmlFor="accept-notices">
            <input id="accept-notices" type="checkbox" name="acceptNotices" value="yes" required />{' '}
            I agree to the <Link href="/terms">terms of use</Link> and acknowledge the{' '}
            <Link href="/privacy">privacy notice</Link>.
          </label>
          <p className="card-body signup-notice-note">
            This acknowledgement does not enable marketing, AI processing or sharing with an agency.
          </p>
          <button type="submit" className="btn btn-primary">
            Create free account
          </button>
        </form>
      </div>
      <p className="card-body signup-confirmation-note">
        We will email you a link to confirm your address before you can sign in.
      </p>
    </AuthShell>
  );
}
