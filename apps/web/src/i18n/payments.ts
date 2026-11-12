import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the payments surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const paymentsCatalog = defineCatalog({
  en: {
    'payments.paymentsResultPage.checkAgain': 'Check Again',
    'payments.paymentsResultPage.goToPlanUsage': 'Go to Plan & Usage',
    'payments.paymentsResultPage.goToWorkspace': 'Go to Workspace',
    'payments.paymentsResultPage.invoice': 'Invoice',
    'payments.paymentsResultPage.purchase': 'Purchase',
  },
  bn: {
    'payments.paymentsResultPage.goToWorkspace': 'ওয়ার্কস্পেসে যান',
  },
});
