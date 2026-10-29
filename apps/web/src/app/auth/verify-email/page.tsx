import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { safeReturnPath } from '../../../lib/neon-recency';
import {
  PENDING_CONFIRMATION_COOKIE,
  decodePendingConfirmation,
  maskEmail,
} from '../../../lib/pending-confirmation';
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
  // The address this browser just asked us to confirm (signed, short-lived): with it, the page
  // says where the link went and sends it again in one tap, without asking for the address again.
  const remembered = decodePendingConfirmation(
    (await cookies()).get(PENDING_CONFIRMATION_COOKIE)?.value,
  );
  const returnPath = safeReturnPath(next);
  const addressForm = (
    <form action={resendConfirmationAction} className="field-list">
      <input type="hidden" name="next" value={returnPath} />
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
  );
  return (
    <AuthShell title="Confirm Your Email Address">
      <ol className="auth-steps" aria-label="The three steps">
        <li>1 Create Your Account</li>
        <li aria-current="step">2 Confirm Your Email</li>
        <li>3 Sign In</li>
      </ol>
      {remembered ? (
        <>
          <p className="card-body">
            {s === '1'
              ? 'We sent a confirmation link to '
              : 'Confirm your address to continue. We can send a link to '}
            <strong>{maskEmail(remembered)}</strong>.
            {s === '1'
              ? ' It can take a few minutes, and it may land in your spam folder. The email comes from VisaStack. Once you have opened the link, sign in.'
              : ''}
          </p>
          <ErrorLine id="verify-error" message={error} />
          <div className="card u-mb-100">
            <form action={resendConfirmationAction} className="field-list">
              <input type="hidden" name="next" value={returnPath} />
              <input type="hidden" name="saved" value="1" />
              <button type="submit" className="btn btn-primary">
                {s === '1' ? 'Send the Link Again' : 'Send the Link'}
              </button>
            </form>
            <details className="verify-other-address">
              <summary>Use a Different Email</summary>
              {addressForm}
            </details>
          </div>
        </>
      ) : (
        <>
          <p className="card-body">
            {s === '1'
              ? 'Check your inbox. If your address needs confirmation, a link has been requested. It can take a few minutes, and it may land in your spam folder. Once you have opened it, sign in.'
              : 'You need to confirm your email address before you can use VisaStack. Enter it below and we will send you a new link.'}
          </p>
          {s === '1' ? <Notice>If you do not see it, you can ask for another below.</Notice> : null}
          <ErrorLine id="verify-error" message={error} />
          <div className="card u-mb-100">{addressForm}</div>
        </>
      )}
      <p className="card-body">
        <Link href={`/auth/sign-in?next=${encodeURIComponent(returnPath)}`}>Back to Sign In</Link>
      </p>
    </AuthShell>
  );
}
