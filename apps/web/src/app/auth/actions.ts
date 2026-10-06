'use server';

import { redirect } from 'next/navigation';
import { selectedIdentityProvider } from '../../lib/identity-selection';

/**
 * Sign-in and sign-up for Neon Auth (phase 1 of docs/commercial-v1/neon-auth-migration-plan.md).
 * Plain forms that work without scripts. Failure messages are fixed codes in the address, never
 * text from the provider, and a wrong password and an unknown address look the same, so the
 * forms cannot be used to find out who has an account.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function validCredentials(email: string, password: string): boolean {
  return email.length <= 254 && EMAIL.test(email) && password.length >= 8 && password.length <= 128;
}

export async function signInAction(formData: FormData): Promise<void> {
  if (selectedIdentityProvider() !== 'neon_auth') redirect('/');
  const email = field(formData, 'email').trim();
  const password = field(formData, 'password');
  if (!validCredentials(email, password)) redirect('/auth/sign-in?e=invalid');
  const { getNeonAuth } = await import('../../lib/neon-auth');
  const { error } = await getNeonAuth().signIn.email({ email, password });
  if (error) redirect('/auth/sign-in?e=failed');
  redirect('/app');
}

export async function signUpAction(formData: FormData): Promise<void> {
  if (selectedIdentityProvider() !== 'neon_auth') redirect('/');
  const email = field(formData, 'email').trim();
  const password = field(formData, 'password');
  const name = field(formData, 'name').trim().slice(0, 120);
  if (!validCredentials(email, password)) redirect('/auth/sign-up?e=invalid');
  const { getNeonAuth } = await import('../../lib/neon-auth');
  const { error } = await getNeonAuth().signUp.email({
    email,
    password,
    name: name || email.split('@')[0] || 'Traveller',
  });
  if (error) redirect('/auth/sign-up?e=failed');
  redirect('/auth/sign-in?n=created');
}
