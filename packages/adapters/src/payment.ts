import type { PaymentPort } from '@visastack/services';

/**
 * The pilot's payment provider — there isn't one (master directive §7 "PR
 * 11": "no payment provider"). `configured: false` lets a caller check
 * before attempting a checkout, matching `getPlatformCapabilities()`'s
 * pre-existing `payments: 'unconfigured'` entry. `createCheckoutSession`
 * throws rather than silently returning a fake session — nothing should be
 * able to mistake "no provider" for "a checkout that just always fails
 * downstream."
 */
export class NullPaymentPort implements PaymentPort {
  readonly configured = false as const;

  async createCheckoutSession(): Promise<never> {
    throw new Error('no payment provider is configured in this deployment');
  }
}
