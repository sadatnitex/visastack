import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the oauth surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const oauthCatalog = defineCatalog({
  en: {
    'oauth.oauthAuthorizeAgencyConsentForm.howLong': 'How Long',
    'oauth.oauthAuthorizeConsentForm.answerAppname': 'Answer {appName}',
    'oauth.oauthAuthorizePage.agency': 'Agency:',
    'oauth.oauthAuthorizePage.aiAppAccess': 'AI App Access',
    'oauth.oauthAuthorizePage.chooseARecord': 'Choose a Record',
    'oauth.oauthAuthorizePage.chooseTheRecordThisAppMay': 'Choose the record this app may read:',
    'oauth.oauthAuthorizePage.connectAppname': 'Connect {appName}',
    'oauth.oauthAuthorizePage.connectForAnAgency': 'Connect for an Agency',
    'oauth.oauthAuthorizePage.isAskingToReadPartsOf':
      'is asking to read parts of a VisaStack record so it can help you.',
    'oauth.oauthAuthorizePage.orConnectItForAnAgency': 'Or connect it for an agency you run:',
    'oauth.oauthAuthorizePage.record': 'Record:',
    'oauth.oauthAuthorizePage.thisAppRunsOnThisComputer':
      'This app runs on this computer, not on a website. Allow it only if you started it yourself just now.',
    'oauth.oauthAuthorizePage.youHaveNoRecordsToConnect':
      'You have no records to connect yet. Add one in VisaStack first.',
  },
  bn: {},
});
