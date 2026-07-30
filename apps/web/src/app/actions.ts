'use server';

import { resolveLocale } from '@visastack/i18n';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE } from '../lib/locale';

/** Switch the EN/BN locale preference. Applies to every page immediately. */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = resolveLocale(String(formData.get('locale') ?? ''));
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}
