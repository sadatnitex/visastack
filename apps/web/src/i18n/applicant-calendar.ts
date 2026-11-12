import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the applicant-calendar surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const applicantCalendarCatalog = defineCatalog({
  en: {
    'applicantCalendar.appApplicantIdCalendarCalendarDateGroups.eventsInTheFile':
      'Events in the File',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.anyoneWhoHasThisLinkCan':
      'Anyone who has this link can see these dates, their general titles such as "Task Due", and the traveller\'s first name, which names the calendar. It never shows full names, case names, documents or notes. Keep it private. If someone else may have it, make a new link or stop sharing.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.calendarOnAMacChooseFile':
      'Calendar on a Mac: choose File, then New Calendar Subscription, and paste the link.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.copyLink': 'Copy Link',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.googleCalendarOnAComputerNext':
      'Google Calendar on a computer: next to Other calendars, choose the plus sign, then From URL, and paste the link.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.iphoneOrIpadOpenSettingsThen':
      'iPhone or iPad: open Settings, then Calendar, Accounts, Add Account, Other, Add Subscribed Calendar, and paste the link.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.makingANewLinkStopsThe':
      'Making a new link stops the old one at once: add the new link to your calendar app again. Stop Sharing turns the link off; your calendar app then gets no new dates.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.outlookChooseAddCalendarThenSubscribe':
      'Outlook: choose Add Calendar, then Subscribe from web, and paste the link.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.subscribeInYourCalendarApp':
      'Subscribe in Your Calendar App',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.subscribingInYourCalendarAppIs':
      'Subscribing in your calendar app is not available yet. You can still download a calendar file above.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.thenAddItToYourCalendar':
      'Then add it to your calendar app:',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.thisLinkIsShownOnlyNow':
      'This link is shown only now. If you lose it, make a new link.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.turnOnAPrivateLinkAnd':
      'Turn on a private link and add it to your calendar app once. Your dates then keep up by themselves: new dates appear, changed dates move, and finished dates go away. Calendar apps check the link on their own schedule, from every few minutes to about once a day.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.weCouldNotCheckYourCalendar':
      'We could not check your calendar link just now. Refresh to try again. If you want to be sure nobody can use a link you made, stop sharing.',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.yourPrivateCalendarLink':
      'Your Private Calendar Link',
    'applicantCalendar.appApplicantIdCalendarCalendarSelectAll.selectAll': 'Select All',
    'applicantCalendar.appApplicantIdCalendarPage.addCaseNames': 'Add Case Names',
    'applicantCalendar.appApplicantIdCalendarPage.addDatesToMyCalendar': 'Add Dates to My Calendar',
    'applicantCalendar.appApplicantIdCalendarPage.addsTheCaseNameAfterThe':
      'Adds the case name after the title, for example "Task Due - Japan Visit". Anyone who can see your calendar will see it. A case name with a number, a link or an email address in it is left out.',
    'applicantCalendar.appApplicantIdCalendarPage.appointmentsDueDatesAndDocumentExpiry':
      'Appointments, due dates and document expiry dates appear here once they are set. Items without a date are never added.',
    'applicantCalendar.appApplicantIdCalendarPage.calendar': 'Calendar',
    'applicantCalendar.appApplicantIdCalendarPage.chooseAtLeastOneDateFirst':
      'Choose at least one date first. A date finished or removed since the preview is left out.',
    'applicantCalendar.appApplicantIdCalendarPage.chooseDates': 'Choose Dates',
    'applicantCalendar.appApplicantIdCalendarPage.chooseTheDatesYouWantCheck':
      'Choose the dates you want, check the preview, then download one file to open in your calendar app.',
    'applicantCalendar.appApplicantIdCalendarPage.clearChoices': 'Clear Choices',
    'applicantCalendar.appApplicantIdCalendarPage.datesToAdd': 'Dates to Add',
    'applicantCalendar.appApplicantIdCalendarPage.datesWithoutATimeAreAdded':
      'Dates without a time are added as all-day events. Titles are general, such as "Task Due", unless you choose to add case names. Dates more than {CALENDAR_PAST_DAYS} days ago are not listed.',
    'applicantCalendar.appApplicantIdCalendarPage.downloadCalendarFile': 'Download Calendar File',
    'applicantCalendar.appApplicantIdCalendarPage.noDatesToAdd': 'No Dates to Add',
    'applicantCalendar.appApplicantIdCalendarPage.oneFileHoldsUpToCalendar':
      '{leftOut, plural, =1 {One file holds up to {CALENDAR_EXPORT_LIMIT} events, so the last {plural} you chose is left out. Download them in a second file.} other {One file holds up to {CALENDAR_EXPORT_LIMIT} events, so the last {plural} you chose are left out. Download them in a second file.}}',
    'applicantCalendar.appApplicantIdCalendarPage.onlyTheEarliestCalendarSourceLimit':
      'Only the earliest {CALENDAR_SOURCE_LIMIT} of each kind of date are listed.',
    'applicantCalendar.appApplicantIdCalendarPage.preview': 'Preview',
    'applicantCalendar.appApplicantIdCalendarPage.previewYourDates': 'Preview Your Dates',
    'applicantCalendar.appApplicantIdCalendarPage.remindMe': 'Remind Me',
    'applicantCalendar.appApplicantIdCalendarPage.theFileWillHoldPluralAs':
      'The file will hold {plural}, as shown here. It is made again when you download it: anything finished or removed since this preview is left out, and anything changed comes in as it is then.',
    'applicantCalendar.appApplicantIdCalendarPage.thisIsAOneTimeCopy':
      'This is a one-time copy. If a date changes later, your calendar will not update; download a new file. Calendar apps that support updates replace the dates you added before; others may add them again.',
    'applicantCalendar.appApplicantIdCalendarPage.titles': 'Titles',
    'applicantCalendar.appApplicantIdCalendarPage.weCouldNotLoadYourDates':
      'We could not load your dates just now. Refresh to try again.',
    'applicantCalendar.appApplicantIdCalendarPage.weCouldNotMakeTheFile':
      'We could not make the file just now. Try again.',
  },
  bn: {
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.copyLink': 'লিংক কপি করুন',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.makingANewLinkStopsThe':
      'নতুন লিংক তৈরি করলে পুরোনোটি সঙ্গে সঙ্গে বন্ধ হয়ে যায়: নতুন লিংকটি আবার আপনার ক্যালেন্ডার অ্যাপে যোগ করুন। শেয়ার বন্ধ করুন চাপলে লিংকটি বন্ধ হয়ে যায়; তখন আপনার ক্যালেন্ডার অ্যাপে আর নতুন তারিখ আসে না।',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.subscribeInYourCalendarApp':
      'আপনার ক্যালেন্ডার অ্যাপে সাবস্ক্রাইব করুন',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.thisLinkIsShownOnlyNow':
      'এই লিংকটি শুধু এখনই দেখানো হচ্ছে। হারিয়ে ফেললে নতুন লিংক তৈরি করুন।',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.turnOnAPrivateLinkAnd':
      'একটি ব্যক্তিগত লিংক চালু করে একবার আপনার ক্যালেন্ডার অ্যাপে যোগ করুন। এরপর আপনার তারিখগুলো নিজে থেকেই হালনাগাদ থাকে: নতুন তারিখ দেখা যায়, বদলানো তারিখ সরে যায়, আর শেষ হয়ে যাওয়া তারিখ চলে যায়। ক্যালেন্ডার অ্যাপ নিজের সময়সূচি অনুযায়ী লিংকটি দেখে, কয়েক মিনিট পরপর থেকে দিনে প্রায় একবার পর্যন্ত।',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.weCouldNotCheckYourCalendar':
      'এই মুহূর্তে আপনার ক্যালেন্ডার লিংক দেখে নেওয়া যায়নি। আবার চেষ্টা করতে পেজটি রিফ্রেশ করুন। আপনার তৈরি করা কোনো লিংক যাতে কেউ ব্যবহার করতে না পারে তা নিশ্চিত করতে চাইলে শেয়ার বন্ধ করুন।',
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.yourPrivateCalendarLink':
      'আপনার ব্যক্তিগত ক্যালেন্ডার লিংক',
    'applicantCalendar.appApplicantIdCalendarPage.addCaseNames': 'ভিসা ফাইলের নাম যোগ করুন',
    'applicantCalendar.appApplicantIdCalendarPage.addDatesToMyCalendar':
      'আমার ক্যালেন্ডারে তারিখ যোগ করুন',
    'applicantCalendar.appApplicantIdCalendarPage.calendar': 'ক্যালেন্ডার',
    'applicantCalendar.appApplicantIdCalendarPage.chooseDates': 'তারিখ বেছে নিন',
    'applicantCalendar.appApplicantIdCalendarPage.chooseTheDatesYouWantCheck':
      'আপনার পছন্দের তারিখগুলো বেছে নিন, প্রিভিউ দেখে নিন, তারপর আপনার ক্যালেন্ডার অ্যাপে খোলার জন্য একটি ডকুমেন্ট ডাউনলোড করুন।',
    'applicantCalendar.appApplicantIdCalendarPage.datesToAdd': 'যোগ করার তারিখ',
    'applicantCalendar.appApplicantIdCalendarPage.preview': 'প্রিভিউ',
    'applicantCalendar.appApplicantIdCalendarPage.previewYourDates': 'আপনার তারিখগুলোর প্রিভিউ দেখুন',
    'applicantCalendar.appApplicantIdCalendarPage.remindMe': 'আমাকে মনে করিয়ে দিন',
    'applicantCalendar.appApplicantIdCalendarPage.thisIsAOneTimeCopy':
      'এটি একবারের কপি। পরে কোনো তারিখ বদলালে আপনার ক্যালেন্ডার আপডেট হবে না; নতুন একটি ডকুমেন্ট ডাউনলোড করুন। যেসব ক্যালেন্ডার অ্যাপ আপডেট সমর্থন করে, সেগুলো আগে যোগ করা তারিখগুলো বদলে দেয়; অন্যগুলো সেগুলো আবার যোগ করতে পারে।',
    'applicantCalendar.appApplicantIdCalendarPage.titles': 'শিরোনাম',
  },
});
