import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { isPublicBetaOpen } from '../../../lib/public-beta';
import { signUpAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not create that account. Try a different email address or sign in instead.',
  slow: 'Too many attempts. Please wait a little while and try again.',
};

export default async function SignUpPage({
  searchParams,
}: { searchParams: Promise<{ e?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { e } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Create an account">
      <p className="card-body">
        {isPublicBetaOpen()
          ? 'VisaStack is in public beta. Anyone can create an account, and some features are still being finished.'
          : 'VisaStack is invite-only for now. You can create an account, but you can only get in if you have been invited.'}
      </p>
      <ErrorLine id="signup-error" message={error} />
      <div className="card" style={{ marginBottom: '1rem' }}>
        <form action={signUpAction} className="field-list">
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
          <button type="submit" className="btn btn-primary">
            Create account
          </button>
        </form>
      </div>
      <p className="card-body">
        We will email you a link to confirm your address before you can sign in.
      </p>
      <p className="card-body">
        Already have an account? <Link href="/auth/sign-in">Sign in</Link>
      </p>
    </AuthShell>
  );
}
