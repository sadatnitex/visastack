import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { selectedIdentityProvider } from '../../../lib/identity-selection';
import { signInAction } from '../actions';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter a valid email address and a password of at least 8 characters.',
  failed: 'We could not sign you in with those details. Check them and try again.',
};

export default async function SignInPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; n?: string }> }) {
  if (selectedIdentityProvider() !== 'neon_auth') notFound();
  const { e, n } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <section className="section container" style={{ maxWidth: '28rem' }}>
      <h1 className="page-title" style={{ marginBottom: '1.25rem' }}>
        Sign in
      </h1>
      {n === 'created' ? (
        <output className="field-msg" style={{ display: 'block', marginBottom: '1rem' }}>
          Your account is ready. If we asked you to confirm your email address, check your inbox
          first, then sign in here.
        </output>
      ) : null}
      {error ? (
        <p className="field-msg field-msg-err" id="signin-error">
          {error}
        </p>
      ) : null}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <form action={signInAction} className="field-list">
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
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </div>
          <div className="field-row">
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="input"
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={128}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Sign in
          </button>
        </form>
      </div>
      <p className="card-body">
        New here? <Link href="/auth/sign-up">Create an account</Link>
      </p>
    </section>
  );
}
