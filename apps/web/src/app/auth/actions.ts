'use server';

import { redirect } from 'next/navigation';
import { withinAuthLimits } from '../../lib/auth-throttle';
import { resolveBaseUrl } from '../../lib/base-url';
import { selectedIdentityProvider } from '../../lib/identity-selection';
import { safeReturnPath } from '../../lib/neon-recency';
import { consumeSignupForm, readSignupForm } from '../../lib/signup-form';

/**
 * Sign-in, sign-up, email confirmation and password recovery for Neon Auth. Plain forms that work
 * without scripts. Failure messages are fixed codes in the address, never text from the provider.
 * A wrong password and an unknown address look the same, and recovery and re-sending a
 * confirmation always give the same answer whether or not the address has an account, so the
 * forms cannot be used to find out who is registered. Every action refuses to run unless Neon
 * Auth is the selected sign-in system, and the email-sending ones are rate limited first.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function validEmail(email: string): boolean {
  return email.length <= 254 && EMAIL.test(email);
}

function validPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

function validCredentials(email: string, password: string): boolean {
  return validEmail(email) && validPassword(password);
}

function requireNeon(): void {
  if (selectedIdentityProvider() !== 'neon_auth') redirect('/');
}

/** Better Auth reports an address that is not confirmed yet with this code. */
function isUnconfirmed(error: { code?: string | undefined }): boolean {
  return error.code === 'EMAIL_NOT_VERIFIED';
}

function signInTarget(next: string): string {
  return next === '/app' ? '' : `&next=${encodeURIComponent(next)}`;
}

export async function signInAction(formData: FormData): Promise<void> {
  requireNeon();
  const email = field(formData, 'email').trim();
  const password = field(formData, 'password');
  const next = safeReturnPath(field(formData, 'next'));
  if (!validCredentials(email, password)) redirect(`/auth/sign-in?e=invalid${signInTarget(next)}`);
  const allowed = await withinAuthLimits({
    email,
    byEmail: 'AUTH_SIGN_IN_EMAIL',
    byAddress: 'AUTH_SIGN_IN_IP',
    onFailure: 'allow',
  });
  if (!allowed) redirect(`/auth/sign-in?e=slow${signInTarget(next)}`);
  const { getNeonAuth } = await import('../../lib/neon-auth');
  const { error } = await getNeonAuth().signIn.email({ email, password });
  if (error) {
    if (isUnconfirmed(error)) redirect('/auth/verify-email');
    redirect(`/auth/sign-in?e=failed${signInTarget(next)}`);
  }
  redirect(next);
}

export async function signUpAction(formData: FormData): Promise<void> {
  requireNeon();
  const email = field(formData, 'email').trim();
  const password = field(formData, 'password');
  const name = field(formData, 'name').trim().slice(0, 120);
  if (!validCredentials(email, password)) redirect('/auth/sign-up?e=invalid');
  if (field(formData, 'acceptNotices') !== 'yes') redirect('/auth/sign-up?e=notices');
  if (field(formData, 'website')) redirect('/auth/sign-up?e=refresh');
  const signupForm = readSignupForm(field(formData, 'signupForm'));
  if (!signupForm) redirect('/auth/sign-up?e=refresh');
  const allowed = await withinAuthLimits({
    email,
    byEmail: 'AUTH_SIGN_UP_EMAIL',
    byAddress: 'AUTH_SIGN_UP_IP',
    onFailure: 'deny',
  });
  if (!allowed) redirect('/auth/sign-up?e=slow');
  if (!(await consumeSignupForm(signupForm))) redirect('/auth/sign-up?e=refresh');
  const { getNeonAuth } = await import('../../lib/neon-auth');
  const { error } = await getNeonAuth().signUp.email({
    email,
    password,
    name: name || email.split('@')[0] || 'Traveller',
    callbackURL: `${resolveBaseUrl()}/auth/sign-in?n=confirmed`,
  });
  if (error) redirect('/auth/sign-up?e=failed');
  redirect('/auth/verify-email?s=1');
}

/** Send the confirmation email again. Same answer for every address. */
export async function resendConfirmationAction(formData: FormData): Promise<void> {
  requireNeon();
  const email = field(formData, 'email').trim();
  if (!validEmail(email)) redirect('/auth/verify-email?e=invalid');
  const allowed = await withinAuthLimits({
    email,
    byEmail: 'AUTH_EMAIL_SEND_EMAIL',
    byAddress: 'AUTH_EMAIL_SEND_IP',
    onFailure: 'deny',
  });
  if (!allowed) redirect('/auth/verify-email?e=slow');
  const { getNeonAuth } = await import('../../lib/neon-auth');
  let unavailable = false;
  let throttled = false;
  try {
    const { error } = await getNeonAuth().sendVerificationEmail({
      email,
      callbackURL: `${resolveBaseUrl()}/auth/sign-in?n=confirmed`,
    });
    throttled = error?.status === 429;
    const unknownAccount = error?.code === 'USER_NOT_FOUND' || error?.message === 'User not found';
    unavailable = !!error && !unknownAccount && !throttled;
  } catch {
    unavailable = true;
  }
  if (throttled) redirect('/auth/verify-email?e=slow');
  if (unavailable) redirect('/auth/verify-email?e=unavailable');
  redirect('/auth/verify-email?s=1');
}

/** Start password recovery. Same answer for every address. */
export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  requireNeon();
  const email = field(formData, 'email').trim();
  if (!validEmail(email)) redirect('/auth/forgot-password?e=invalid');
  const allowed = await withinAuthLimits({
    email,
    byEmail: 'AUTH_EMAIL_SEND_EMAIL',
    byAddress: 'AUTH_EMAIL_SEND_IP',
    onFailure: 'deny',
  });
  if (!allowed) redirect('/auth/forgot-password?e=slow');
  const { getNeonAuth } = await import('../../lib/neon-auth');
  let unavailable = false;
  let throttled = false;
  try {
    const { error } = await getNeonAuth().requestPasswordReset({
      email,
      redirectTo: `${resolveBaseUrl()}/auth/reset-password`,
    });
    // Unknown accounts receive the same neutral confirmation. Provider outages
    // and throttling must not be disguised as a successful request.
    throttled = error?.status === 429;
    const unknownAccount = error?.code === 'USER_NOT_FOUND' || error?.message === 'User not found';
    unavailable = !!error && !unknownAccount && !throttled;
  } catch {
    unavailable = true;
  }
  if (throttled) redirect('/auth/forgot-password?e=slow');
  if (unavailable) redirect('/auth/forgot-password?e=unavailable');
  redirect('/auth/forgot-password?sent=1');
}

/** Finish password recovery with the one-time link from the email. */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  requireNeon();
  const token = field(formData, 'token');
  const password = field(formData, 'password');
  const confirm = field(formData, 'confirm');
  if (!token || token.length > 512) redirect('/auth/forgot-password?e=expired');
  const back = `/auth/reset-password?token=${encodeURIComponent(token)}`;
  if (!validPassword(password)) redirect(`${back}&e=invalid`);
  if (password !== confirm) redirect(`${back}&e=mismatch`);
  const { getNeonAuth } = await import('../../lib/neon-auth');
  const { error } = await getNeonAuth().resetPassword({ newPassword: password, token });
  if (error) redirect('/auth/forgot-password?e=expired');
  redirect('/auth/sign-in?n=reset');
}

/** Ask the signed-in person for their password again before a sensitive step. */
export async function reauthAction(formData: FormData): Promise<void> {
  requireNeon();
  const password = field(formData, 'password');
  const returnTo = safeReturnPath(field(formData, 'returnTo'));
  const back = `/auth/reauth?returnTo=${encodeURIComponent(returnTo)}`;
  if (!validPassword(password)) redirect(`${back}&e=invalid`);
  const { getNeonAuth } = await import('../../lib/neon-auth');
  const auth = getNeonAuth();
  const { data } = await auth.getSession();
  const email = data?.user?.email;
  if (!email) redirect('/auth/sign-in');
  const allowed = await withinAuthLimits({
    email,
    byEmail: 'AUTH_SIGN_IN_EMAIL',
    byAddress: 'AUTH_SIGN_IN_IP',
    onFailure: 'allow',
  });
  if (!allowed) redirect(`${back}&e=slow`);
  const { error } = await auth.signIn.email({ email, password });
  if (error) redirect(`${back}&e=failed`);
  redirect(returnTo);
}
