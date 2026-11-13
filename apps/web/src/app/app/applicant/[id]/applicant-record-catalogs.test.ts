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

/** Wording still English after the owner sign-off of 2026-11-12: a date, count or label filled in by code that does not follow the reader language yet, or official-rule content. */
const HELD: Record<string, string[]> = {
  sharing: ['andPluralNotShownHereDelete', 'deleteDraftTitle'],
  calendar: [],
  evidence: [
    'neededByFormatdateonly',
    'youSentThisOnFormatmoment',
    'kindlabelAddedAddedlabelScanlabel',
  ],
  insights: ['usuallyOriginal'],
  memory: [],
  missions: ['startANewCaseFromThisad706c', 'notAcceptedYet', 'optional'],
  outputs: ['previewLabel'],
  'traveller-manage': ['manage'],
};

/** Wording that was held for the owner sign-off and now has Bengali. */
const SIGNED_OFF: Record<string, string[]> = {
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
  ],
  calendar: ['makingANewLinkStopsThe', 'thisLinkIsShownOnlyNow', 'yourPrivateCalendarLink'],
  evidence: ['anAgencyIsAskingYouFor'],
  insights: ['aSummaryOfYourSavedDocuments', 'backsNoSavedDetailsYet'],
  memory: [
    'aNoteWasSavedHiddenHere',
    'snapshotVersionKeepsExactlyWhatIt',
    'sharedOutsideACase',
    'theseSharesAreOfThisPerson',
  ],
  outputs: [
    'aShortMessageYouCanSend',
    'aSummaryIsAOneTime',
    'passportAndIdNumbersShowOnly',
    'theseAreTheConfirmedDetailsIn',
  ],
};

const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe.each(Object.entries(CATALOGS))('applicant %s catalogue', (surface, catalog) => {
  const en = catalog.en as Record<string, string>;
  const bn = catalog.bn as Record<string, string>;

  it('leaves no placeholder missing or invented in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn))
      expect(names(text), key).toBe(names(en[key] ?? ''));
  });

  it('has Bengali for the wording the owner signed off on 2026-11-12', () => {
    for (const suffix of SIGNED_OFF[surface] ?? []) {
      const keys = Object.keys(en).filter((k) => k.endsWith(`.${suffix}`));
      expect(keys.length, suffix).toBeGreaterThan(0);
      for (const k of keys) expect(k in bn, k).toBe(true);
    }
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
