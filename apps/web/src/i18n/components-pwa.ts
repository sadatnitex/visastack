import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the components-pwa surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const componentsPwaCatalog = defineCatalog({
  en: {
    'componentsPwa.pwaInstallAppCard.addVisastackToYourHomeScreen':
      'Add VisaStack to your home screen to open it like an app, with the same sign-in and the same records as this website.',
    'componentsPwa.pwaInstallAppCard.installVisastack': 'Install VisaStack',
    'componentsPwa.pwaInstallAppCard.installingDoesNotDownloadYourRecords':
      'Installing does not download your records. Your details and documents stay protected on VisaStack and open only after you sign in.',
    'componentsPwa.pwaInstallAppCard.onIphoneOrIpadOpenVisastack':
      'On iPhone or iPad, open VisaStack in Safari, tap Share, then Add to Home Screen. On Android, open the browser menu and choose Install App or Add to Home Screen.',
    'componentsPwa.pwaInstallAppCard.useVisastackOnYourPhone': 'Use VisaStack on Your Phone',
    'componentsPwa.pwaInstallAppCard.visastackIsInstalledOnThisDevice':
      'VisaStack is installed on this device. Open it from your home screen or app list.',
    'componentsPwa.pwaInstallAppCard.youCanInstallItAnyTime':
      'You can install it any time from this page.',
    'componentsPwa.pwaPwaRuntime.aNewVersionOfVisastackIs':
      'A new version of VisaStack is ready. Finish anything you are typing or uploading, then reload.',
    'componentsPwa.pwaPwaRuntime.appUpdate': 'App Update',
    'componentsPwa.pwaPwaRuntime.browserTip': 'Browser Tip',
    'componentsPwa.pwaPwaRuntime.dismiss': 'Dismiss',
    'componentsPwa.pwaPwaRuntime.later': 'Later',
    'componentsPwa.pwaPwaRuntime.reloadNow': 'Reload Now',
    'componentsPwa.pwaPwaRuntime.reloading': 'Reloading',
    'componentsPwa.pwaPwaRuntime.youAreBackOnline': 'You are back online.',
    'componentsPwa.pwaPwaRuntime.youAreOfflineReconnectToContinue':
      'You are offline. Reconnect to continue securely. Anything not yet sent has not been saved.',
  },
  bn: {
    'componentsPwa.pwaInstallAppCard.addVisastackToYourHomeScreen':
      'VisaStack আপনার হোম স্ক্রিনে যোগ করুন, অ্যাপের মতো খুলতে পারবেন - এই ওয়েবসাইটের মতোই একই সাইন ইন ও একই রেকর্ড থাকবে।',
    'componentsPwa.pwaPwaRuntime.youAreOfflineReconnectToContinue':
      'আপনি অফলাইনে আছেন। নিরাপদে চালিয়ে যেতে আবার সংযুক্ত হন। এখনও পাঠানো হয়নি এমন কিছু সংরক্ষণ করা হয়নি।',
  },
});
