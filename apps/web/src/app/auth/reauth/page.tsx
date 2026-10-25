import type { Metadata } from 'next';
import { safeReturnPath } from '../../../lib/neon-recency';
import { reauthAction } from '../actions';
import { AuthShell, ErrorLine, TextField } from '../auth-ui';

export const metadata: Metadata = { title: 'Confirm it is you' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  invalid: 'Enter your password (8 to 128 characters).',
  failed: 'That password was not right. Try again.',
  slow: 'Too many attempts. Please wait a little while and try again.',
};

export default async function ReauthPage({
  searchParams,
}: { searchParams: Promise<{ e?: string; returnTo?: string }> }) {
  const { e, returnTo } = await searchParams;
  const error = e ? ERRORS[e] : undefined;
  return (
    <AuthShell title="Confirm it is you">
      <p className="card-body">For your safety, please type your password again to continue.</p>
      <ErrorLine id="reauth-error" message={error} />
      <div className="card u-mb-100">
        <form action={reauthAction} className="field-list">
          <input type="hidden" name="returnTo" value={safeReturnPath(returnTo)} />
          <TextField
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={128}
            errorId={error ? 'reauth-error' : undefined}
          />
          <button type="submit" className="btn btn-primary">
            Continue
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
