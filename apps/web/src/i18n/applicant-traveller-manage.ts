import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-traveller-manage surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantTravellerManageCatalog = defineCatalog({
  en: {
    'applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.cancel': 'Cancel',
    'applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.manage': 'Manage',
    'applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.manageName':
      'Manage {name}',
  },
  bn: {},
});
