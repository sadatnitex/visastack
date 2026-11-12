import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the status surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const statusCatalog = defineCatalog({
  en: {
    'status.statusStatusView.aboutThisVersion': 'About This Version',
    'status.statusStatusView.checkNow': 'Check Now',
    'status.statusStatusView.checking': 'Checking…',
    'status.statusStatusView.checkingWhichFeaturesAreWorking':
      'Checking which features are working…',
    'status.statusStatusView.features': 'Features',
    'status.statusStatusView.featuresThatAreNotSwitchedOn':
      'Features that are not switched on yet are listed too, so you always know what to expect.',
    'status.statusStatusView.live': 'Live',
    'status.statusStatusView.loading': 'Loading…',
    'status.statusStatusView.notSwitchedOnYet': 'Not Switched On Yet',
    'status.statusStatusView.theListOfFeaturesIsNot':
      'The list of features is not available right now.',
    'status.statusStatusView.updatedUpdatedatThisPageChecksAgain':
      'Updated {updatedAt}. This page checks again by itself.',
    'status.statusStatusView.whatWorksToday': 'What Works Today',
    'status.statusStatusView.youCanUseNow': 'You Can Use Now',
  },
  bn: {
    'status.statusStatusView.aboutThisVersion': 'এই সংস্করণ সম্পর্কে',
    'status.statusStatusView.checkNow': 'এখনই দেখুন',
    'status.statusStatusView.checkingWhichFeaturesAreWorking': 'কোন ফিচারগুলো কাজ করছে তা দেখা হচ্ছে…',
    'status.statusStatusView.features': 'ফিচার',
    'status.statusStatusView.featuresThatAreNotSwitchedOn':
      'যেসব ফিচার এখনো চালু হয়নি সেগুলোও তালিকায় আছে, যাতে আপনি সবসময় জানেন কী আশা করতে পারেন।',
    'status.statusStatusView.loading': 'লোড হচ্ছে…',
    'status.statusStatusView.whatWorksToday': 'আজ যা কাজ করছে',
  },
});
