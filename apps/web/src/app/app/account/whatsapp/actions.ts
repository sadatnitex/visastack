'use server';

import { disconnectWhatsApp, startWhatsAppLink } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';
import { readWhatsAppConfig } from '../../../../lib/whatsapp';

export interface ConnectState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
  /** The code to send from WhatsApp, once made. */
  readonly code?: string;
  readonly whatsappMessage?: string;
  readonly whatsappHref?: string | null;
  readonly expiresAt?: string;
}

/** Makes a one-time code for the signed-in account. Nothing connects until it is sent from WhatsApp. */
export async function startWhatsAppLinkAction(
  _previous: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const config = readWhatsAppConfig();
  if (!config) return { ok: false, message: 'WhatsApp is not available yet.' };
  const optIn = formData.get('optIn') === 'yes';
  if (!optIn) {
    return {
      ok: false,
      field: 'optIn',
      message: 'Tick the box to agree to receive VisaStack messages on WhatsApp.',
    };
  }
  return withSession(async ({ db, accountId }) => {
    // Connecting lets a phone read case details, so it needs a recent sign-in, like sharing does.
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'CONNECT_WHATSAPP', resourceId: accountId },
      '/app/account/whatsapp',
    );
    if (stepUp.kind === 'not_configured')
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const started = await startWhatsAppLink(db, {
      accountId,
      optIn,
      businessNumber: config.businessNumber,
    });
    if (!started.ok) return { ok: false, message: started.error.message };
    return {
      ok: true,
      message: 'Your code is ready.',
      code: started.value.code,
      whatsappMessage: started.value.message,
      whatsappHref: started.value.whatsappHref,
      expiresAt: started.value.expiresAt.toISOString(),
    };
  });
}

/** Ends the connection. VisaStack keeps working the same without WhatsApp. */
export async function disconnectWhatsAppAction(): Promise<void> {
  await withSession(({ db, accountId }) => disconnectWhatsApp(db, { accountId }));
  revalidatePath('/app/account/whatsapp');
}
