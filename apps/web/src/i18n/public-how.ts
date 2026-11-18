import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the How It Works page (R2). English is the source text. Bengali is filled only from
 * approved rows of docs/localization/VISASTACK_TRANSLATION_REGISTER.csv (see public-how.sources.json);
 * a key without a Bengali value shows English, marked as English for screen readers.
 */
export const publicHowCatalog = defineCatalog({
  en: {
    'publicHow.hero.titleLead': 'How It',
    'publicHow.hero.titleEnd': 'Works.',
    'publicHow.hero.lead': 'Four steps. Each one is yours.',
    'publicHow.step.add': 'Add',
    'publicHow.step.check': 'Check',
    'publicHow.step.prepare': 'Prepare',
    'publicHow.step.share': 'Share',
    'publicHow.step.addBody':
      'Add a document by photo or file. Details are suggested for you to confirm.',
    'publicHow.step.checkBody': 'Confirm, change or skip each suggestion. Nothing is assumed.',
    'publicHow.step.prepareBody':
      'Pick a country and purpose. The checklist fills from what you already have.',
    'publicHow.step.shareBody': 'Choose what leaves, for whom, until when. Turn it off any time.',
    'publicHow.words.titleLead': 'Words Mean Exactly',
    'publicHow.words.titleEnd': 'What They Say.',
    'publicHow.words.hint': 'Select a word to read what it means.',
    'publicHow.words.received': 'Received',
    'publicHow.words.receivedNot': 'is not Reviewed',
    'publicHow.words.receivedMeans': 'A file arrived. No one has checked it yet.',
    'publicHow.words.suggested': 'Suggested',
    'publicHow.words.suggestedNot': 'is not Confirmed',
    'publicHow.words.suggestedMeans':
      'A detail was read from your page. Nothing is true until you say so.',
    'publicHow.words.saved': 'Saved',
    'publicHow.words.savedNot': 'is not Shared',
    'publicHow.words.savedMeans': 'A saved file stays yours until you choose to share it.',
    'publicHow.words.ready': 'Ready',
    'publicHow.words.readyNot': 'is not Approved',
    'publicHow.words.readyMeans': 'Ready counts what is complete. It never promises a visa.',
    'publicHow.closing.titleLead': 'See It With Your',
    'publicHow.closing.titleEnd': 'Own Passport.',
    'publicHow.closing.sub': 'Start with one document.',
    'publicHow.closing.start': 'Start with Your Own Profile',
    'publicHow.closing.privacy': 'Privacy and Trust',
  },
  bn: {
    'publicHow.step.add': 'যোগ করুন',
    'publicHow.step.share': 'শেয়ার করুন',
    'publicHow.words.received': 'পাওয়া গেছে',
    'publicHow.words.ready': 'প্রস্তুত',
  },
});
