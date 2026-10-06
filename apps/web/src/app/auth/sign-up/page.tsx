import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { signUpAction } from '../actions';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not create that account. Try a different email address or sign in instead.',
};

export default async function SignUpPage({
  searchParams,
}: { searchParams: Promise<{ e?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { e } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <section className="section container" style={{ maxWidth: '28rem' }}>
      <h1 className="section-title">Create an account</h1>
      <p className="card-body">
        VisaStack is invite-only for now. You can create an account, but you can only get in if you
        have been invited.
      </p>
      {error ? (
        <p className="field-msg field-msg-err" id="signup-error">
          {error}
        </p>
      ) : null}
      <form action={signUpAction} className="field-list">
        <div className="field-row">
          <label className="field-label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            className="input"
            autoComplete="name"
            maxLength={120}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            autoComplete="email"
            required
            maxLength={254}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'signup-error' : undefined}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="password">
            Password (at least 8 characters)
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Create account
        </button>
      </form>
      <p className="card-body">
        Already have an account? <Link href="/auth/sign-in">Sign in</Link>
      </p>
    </section>
  );
}
