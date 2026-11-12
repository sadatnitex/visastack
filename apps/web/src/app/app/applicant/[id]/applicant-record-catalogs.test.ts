import { describe, expect, it } from 'vitest';
import { applicantCalendarCatalog } from '../../../../i18n/applicant-calendar';
import { applicantEvidenceCatalog } from '../../../../i18n/applicant-evidence';
import { applicantInsightsCatalog } from '../../../../i18n/applicant-insights';
import { applicantMemoryCatalog } from '../../../../i18n/applicant-memory';
import { applicantMissionsCatalog } from '../../../../i18n/applicant-missions';
import { applicantOutputsCatalog } from '../../../../i18n/applicant-outputs';
import { applicantSharingCatalog } from '../../../../i18n/applicant-sharing';
import { applicantTravellerManageCatalog } from '../../../../i18n/applicant-traveller-manage';

const CATALOGS = {
  calendar: applicantCalendarCatalog,
  evidence: applicantEvidenceCatalog,
  insights: applicantInsightsCatalog,
  memory: applicantMemoryCatalog,
  missions: applicantMissionsCatalog,
  outputs: applicantOutputsCatalog,
  sharing: applicantSharingCatalog,
  'traveller-manage': applicantTravellerManageCatalog,
} as const;

/** Sharing, access, expiry, AI, memory, official-rule and date-in-sentence wording that stays English. */
const HELD: Record<string, string[]> = {
  sharing: [
    'draftsYourAiAppsSavedFor',
    'aiTools',
    'downloadsAreNotIncludedYouCan',
    'everyGrantExpiresLeaveBlankFor',
    'expiresAfterDays',
    'everythingInMyProfile',
    'whichDocumentsCanTheyOpen',
    'revokingEndsAccessOnVisastackIt',
    'yourAccessSummary',
    'reviewAndConfirm',
    'invitationCreated',
    'sharingRequestCreated',
    'andPluralNotShownHereDelete',
    'deleteDraftTitle',
  ],
  calendar: ['makingANewLinkStopsThe', 'thisLinkIsShownOnlyNow', 'yourPrivateCalendarLink'],
  evidence: [
    'anAgencyIsAskingYouFor',
    'neededByFormatdateonly',
    'youSentThisOnFormatmoment',
    'kindlabelAddedAddedlabelScanlabel',
  ],
  insights: ['aSummaryOfYourSavedDocuments', 'backsNoSavedDetailsYet', 'usuallyOriginal'],
  memory: [
    'aNoteWasSavedHiddenHere',
    'snapshotVersionKeepsExactlyWhatIt',
    'sharedOutsideACase',
    'theseSharesAreOfThisPerson',
  ],
  missions: ['startANewCaseFromThisad706c', 'optional', 'notAcceptedYet'],
  outputs: [
    'aShortMessageYouCanSend',
    'aSummaryIsAOneTime',
    'passportAndIdNumbersShowOnly',
    'theseAreTheConfirmedDetailsIn',
    'previewLabel',
  ],
  'traveller-manage': ['manage'],
};

const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe.each(Object.entries(CATALOGS))('applicant %s catalogue', (surface, catalog) => {
  const en = catalog.en as Record<string, string>;
  const bn = catalog.bn as Record<string, string>;

  it('leaves no placeholder missing or invented in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn))
      expect(names(text), key).toBe(names(en[key] ?? ''));
  });

  it('holds back the wording that must stay English', () => {
    for (const suffix of HELD[surface] ?? []) {
      const keys = Object.keys(en).filter((k) => k.endsWith(`.${suffix}`));
      expect(keys.length, suffix).toBeGreaterThan(0);
      for (const k of keys) expect(k in bn, k).toBe(false);
    }
  });

  it('has Bengali only for keys that exist in English', () => {
    for (const key of Object.keys(bn)) expect(key in en, key).toBe(true);
  });
});
