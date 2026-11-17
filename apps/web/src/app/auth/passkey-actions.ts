'use server';

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@visastack/services/passkeys';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

/**
 * Passkeys (Q8, ADR 0028): confirm it is you with Face ID, a fingerprint or the screen lock, and
 * add, rename or remove passkeys. Server actions, so Next's own same-origin check applies and no
 * new public address is opened. Nothing here signs anyone in: every action needs an existing,
 * valid sign-in (`withSession`), and confirming only records that THIS sign-in was confirmed.
 *
 * - Switched off (`PASSKEYS` not "on"): every action refuses.
 * - Adding or removing a passkey needs the password typed in the last five minutes, so a borrowed
 *   or stolen sign-in cannot plant or delete one.
 * - Confirming is rate limited exactly like the password re-check (same limits, same keys).
 * - The challenge cookie is cleared the moment it is read, and is bound to this purpose, account
 *   and sign-in.
 * - Messages are fixed, plain sentences, never text from the browser or the authenticator.
 */

type Failure = { readonly ok: false; readonly message: string; readonly reauthUrl?: string };

export type PasskeyStart<T> = { readonly ok: true; readonly options: T } | Failure;
export type PasskeyFinish = { readonly ok: true; readonly next: string } | Failure;

const OFF: Failure = { ok: false, message: 'Passkeys are not available here yet.' };
const UNAVAILABLE: Failure = {
  ok: false,
  message: 'Passkeys are not available right now. Use your password instead.',
};
const EXPIRED: Failure = {
  ok: false,
  message: 'That took a little too long. Please try again.',
};
const SLOW: Failure = {
  ok: false,
  message: 'Too many attempts. Please wait a little while and try again.',
};
const STAFF: Failure = {
  ok: false,
  message: 'Staff accounts confirm with the password and the authenticator app.',
};

/** Largest browser answer accepted; real ones are a few kilobytes. */
const MAX_RESPONSE_CHARS = 16_000;

async function deps() {
  const [passkeys, web, recency, session, staffFactor, base, neonAuth, sessionAge, services] =
    await Promise.all([
      import('@visastack/services/passkeys'),
      import('../../lib/passkeys'),
      import('../../lib/neon-recency'),
      import('../../lib/session'),
      import('../../lib/staff-factor'),
      import('../../lib/base-url'),
      import('../../lib/neon-auth'),
      import('../../lib/session-age'),
      import('@visastack/services'),
    ]);
  return { passkeys, web, recency, session, staffFactor, base, neonAuth, sessionAge, services };
}

type Deps = Awaited<ReturnType<typeof deps>>;

function secureCookies(d: Deps): boolean {
  return d.base.resolveBaseUrl().startsWith('https://');
}

async function rememberChallenge(
  d: Deps,
  challenge: string,
  binding: { purpose: 'add' | 'confirm'; accountId: string; sessionRef: string },
): Promise<void> {
  const { cookies } = await import('next/headers');
  const secure = secureCookies(d);
  const value = d.web.encodePasskeyChallenge(
    challenge,
    binding,
    d.neonAuth.readNeonAuthSettings().cookieSecret,
  );
  (await cookies()).set(
    d.web.passkeyChallengeCookieName(binding.purpose, secure),
    value,
    d.web.passkeyChallengeCookieOptions(secure),
  );
}

/** Read the challenge for this purpose, account and sign-in, and clear it whatever it holds. */
async function takeChallenge(
  d: Deps,
  binding: { purpose: 'add' | 'confirm'; accountId: string; sessionRef: string },
): Promise<{ readonly challenge: string; readonly issuedAt: Date } | null> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const secure = secureCookies(d);
  const name = d.web.passkeyChallengeCookieName(binding.purpose, secure);
  const value = store.get(name)?.value;
  store.set(name, '', { ...d.web.passkeyChallengeCookieOptions(secure), maxAge: 0 });
  return d.web.readPasskeyChallenge(value, binding, d.neonAuth.readNeonAuthSettings().cookieSecret);
}

/** A browser answer with the expected shape and a sane size, or null. */
function browserAnswer<T>(value: unknown): T | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
  if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.length > 1366) {
    return null;
  }
  if (candidate.type !== 'public-key') return null;
  if (typeof candidate.response !== 'object' || candidate.response === null) return null;
  try {
    if (JSON.stringify(value).length > MAX_RESPONSE_CHARS) return null;
  } catch {
    return null;
  }
  return value as T;
}

/**
 * Passkey confirmations, per account, in their own bucket (`PASSKEY_CONFIRM`). If the counter
 * cannot be read the attempt is allowed: an answer is a signature from the person's own device,
 * which cannot be guessed, and every other check (challenge, signature, counter) still runs. The
 * password re-check keeps its own limits untouched.
 */
async function withinPasskeyLimit(
  d: Deps,
  db: Parameters<Deps['passkeys']['listPasskeys']>[0],
  accountId: string,
): Promise<boolean> {
  try {
    const decision = await d.services.checkRateLimit(
      db,
      { subjectId: accountId, action: 'passkey.confirm' },
      d.services.RATE_LIMITS.PASSKEY_CONFIRM,
    );
    return decision.allowed;
  } catch {
    return true;
  }
}

function reauthFailure(d: Deps): Failure {
  return {
    ok: false,
    message: 'For your safety, confirm it is you first, then come back to add or remove a passkey.',
    reauthUrl: d.recency.neonReauthUrl(d.web.PASSKEYS_PATH),
  };
}

// ---------------------------------------------------------------------------------------------
// Confirm it is you (the re-check page)
// ---------------------------------------------------------------------------------------------

export async function startPasskeyConfirmAction(): Promise<
  PasskeyStart<PublicKeyCredentialRequestOptionsJSON>
> {
  const d = await deps();
  if (!d.web.passkeysEnabled()) return OFF;
  const sessionRef = await d.recency.neonSessionRef();
  if (!sessionRef) redirect('/auth/sign-in');
  return d.session.withSession(async ({ db, accountId, email }) => {
    if (await d.sessionAge.isStaffContext(db, { accountId, email })) return STAFF;
    const options = await d.passkeys.startPasskeyConfirmation(db, {
      accountId,
      rp: d.web.passkeyRelyingParty(),
    });
    if (!options.ok) {
      return options.error.code === 'not_found'
        ? { ok: false, message: 'There is no passkey on this account yet.' }
        : UNAVAILABLE;
    }
    await rememberChallenge(d, options.value.challenge, {
      purpose: 'confirm',
      accountId,
      sessionRef,
    });
    return { ok: true, options: options.value };
  });
}

export async function finishPasskeyConfirmAction(
  answer: unknown,
  returnTo: unknown,
): Promise<PasskeyFinish> {
  const d = await deps();
  if (!d.web.passkeysEnabled()) return OFF;
  const next = d.recency.safeReturnPath(typeof returnTo === 'string' ? returnTo : null);
  const sessionRef = await d.recency.neonSessionRef();
  if (!sessionRef) redirect('/auth/sign-in');
  return d.session.withSession(async ({ db, accountId, email }) => {
    const challenge = await takeChallenge(d, { purpose: 'confirm', accountId, sessionRef });
    if (!(await withinPasskeyLimit(d, db, accountId))) return SLOW;
    if (await d.sessionAge.isStaffContext(db, { accountId, email })) return STAFF;
    if (!challenge) return EXPIRED;
    const response = browserAnswer<AuthenticationResponseJSON>(answer);
    if (!response) return { ok: false, message: 'That passkey could not be checked. Try again.' };
    // An answer to another challenge (an older tab, another purpose) is "try again", not a failure.
    if (d.web.challengeOfAnswer(response) !== challenge.challenge) return EXPIRED;
    const confirmed = await d.passkeys.finishPasskeyConfirmation(db, {
      accountId,
      rp: d.web.passkeyRelyingParty(),
      expectedChallenge: challenge.challenge,
      challengeIssuedAt: challenge.issuedAt,
      response,
      sessionRef,
    });
    if (!confirmed.ok) {
      return confirmed.error.code === 'upstream_error'
        ? UNAVAILABLE
        : {
            ok: false,
            message: 'That passkey could not be checked. Try again, or use your password.',
          };
    }
    return { ok: true, next };
  });
}

// ---------------------------------------------------------------------------------------------
// Add, rename and remove (the passkeys page)
// ---------------------------------------------------------------------------------------------

export async function startPasskeyAddAction(): Promise<
  PasskeyStart<PublicKeyCredentialCreationOptionsJSON>
> {
  const d = await deps();
  if (!d.web.passkeysEnabled()) return OFF;
  const sessionRef = await d.recency.neonSessionRef();
  if (!sessionRef) redirect('/auth/sign-in');
  return d.session.withSession(async ({ db, accountId, email }) => {
    if (!(await d.staffFactor.passwordIsRecent())) return reauthFailure(d);
    const options = await d.passkeys.startPasskeyRegistration(db, {
      accountId,
      email,
      rp: d.web.passkeyRelyingParty(),
    });
    if (!options.ok) {
      return options.error.code === 'upstream_error'
        ? UNAVAILABLE
        : { ok: false, message: options.error.message };
    }
    await rememberChallenge(d, options.value.challenge, { purpose: 'add', accountId, sessionRef });
    return { ok: true, options: options.value };
  });
}

export async function finishPasskeyAddAction(
  answer: unknown,
  label: unknown,
): Promise<PasskeyFinish> {
  const d = await deps();
  if (!d.web.passkeysEnabled()) return OFF;
  const sessionRef = await d.recency.neonSessionRef();
  if (!sessionRef) redirect('/auth/sign-in');
  const result = await d.session.withSession(async ({ db, accountId }): Promise<PasskeyFinish> => {
    const challenge = await takeChallenge(d, { purpose: 'add', accountId, sessionRef });
    if (!(await d.staffFactor.passwordIsRecent())) return reauthFailure(d);
    if (!challenge) return EXPIRED;
    const response = browserAnswer<RegistrationResponseJSON>(answer);
    if (!response) return { ok: false, message: 'That passkey could not be saved. Try again.' };
    if (d.web.challengeOfAnswer(response) !== challenge.challenge) return EXPIRED;
    const saved = await d.passkeys.finishPasskeyRegistration(db, {
      accountId,
      rp: d.web.passkeyRelyingParty(),
      expectedChallenge: challenge.challenge,
      response,
      label: typeof label === 'string' ? label : null,
    });
    if (!saved.ok) {
      return saved.error.code === 'upstream_error'
        ? UNAVAILABLE
        : { ok: false, message: saved.error.message };
    }
    return { ok: true, next: d.web.PASSKEYS_PATH };
  });
  if (result.ok) revalidatePath(d.web.PASSKEYS_PATH);
  return result;
}

const PASSKEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed passkey id, or '' (which then answers exactly like a passkey that is not there). */
function passkeyId(formData: FormData): string {
  const value = formData.get('passkeyId');
  return typeof value === 'string' && PASSKEY_ID.test(value) ? value : '';
}

export async function renamePasskeyAction(formData: FormData): Promise<void> {
  const d = await deps();
  if (!d.web.passkeysEnabled()) redirect('/app/account');
  const id = passkeyId(formData);
  const label = formData.get('label');
  let outcome = 'renamed';
  await d.session.withSession(async ({ db, accountId }) => {
    if (!id) {
      outcome = 'missing';
      return;
    }
    if (typeof label !== 'string') {
      outcome = 'invalid';
      return;
    }
    const renamed = await d.passkeys.renamePasskey(db, { accountId, id, label });
    if (!renamed.ok) outcome = renamed.error.code === 'upstream_error' ? 'unavailable' : 'missing';
  });
  revalidatePath(d.web.PASSKEYS_PATH);
  redirect(`${d.web.PASSKEYS_PATH}?n=${outcome}`);
}

export async function removePasskeyAction(formData: FormData): Promise<void> {
  const d = await deps();
  if (!d.web.passkeysEnabled()) redirect('/app/account');
  const id = passkeyId(formData);
  let outcome = 'removed';
  await d.session.withSession(async ({ db, accountId }) => {
    if (!(await d.staffFactor.passwordIsRecent())) {
      outcome = 'reauth';
      return;
    }
    if (!id) {
      outcome = 'missing';
      return;
    }
    const removed = await d.passkeys.removePasskey(db, { accountId, id });
    if (!removed.ok) outcome = removed.error.code === 'upstream_error' ? 'unavailable' : 'missing';
  });
  if (outcome === 'reauth') redirect(d.recency.neonReauthUrl(d.web.PASSKEYS_PATH));
  revalidatePath(d.web.PASSKEYS_PATH);
  redirect(`${d.web.PASSKEYS_PATH}?n=${outcome}`);
}
