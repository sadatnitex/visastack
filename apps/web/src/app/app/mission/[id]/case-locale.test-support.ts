import { expect } from 'vitest';
import { appMissionCatalog } from '../../../../i18n/app-mission';

/**
 * Shared by the two Bengali tests of the case screens (case-forms-locale and case-screens-locale):
 * which parts each one draws, and the check that a part's Bengali is what a reader meets.
 */

/** Client forms and panels, drawn in case-forms-locale.test.tsx. */
export const FORM_PARTS = [
  'appMissionIdAttachPackForm',
  'appMissionIdAttemptForms',
  'appMissionIdCaseMoreMenu',
  'appMissionIdCaseWelcome',
  'appMissionIdChecklistSearch',
  'appMissionIdCollaborationPanels',
  'appMissionIdComplaintFeedbackPanel',
  'appMissionIdContributorRequestsPanel',
  'appMissionIdMissionButtons',
  'appMissionIdOutcomePanel',
  'appMissionIdPackageForms',
  'appMissionIdSubmissionReportPanel',
  'appMissionIdSnapshotsSnapshotidAcknowledgementPanel',
  'appMissionStartStartForm',
] as const;

/** Server parts, the snapshot pages and Start a Trip, drawn in case-screens-locale.test.tsx. */
export const SCREEN_PARTS = [
  'appMissionIdAttemptPanel',
  'appMissionIdCaseChecklist',
  'appMissionIdCaseItemPane',
  'appMissionIdCaseMobileBar',
  'appMissionIdCaseRail',
  'appMissionIdCaseSecondary',
  'appMissionIdCaseStatusPanel',
  'appMissionIdChangesSinceConfirmed',
  'appMissionIdPackagePanel',
  'appMissionIdTripChecksPanel',
  'appMissionIdSnapshotsPage',
  'appMissionIdSnapshotsSnapshotidPage',
  'appMissionStartPage',
] as const;

const bn = appMissionCatalog.bn as Record<string, string>;
const en = appMissionCatalog.en as Record<string, string>;
const RAW_KEY = /appMission\.app[A-Z]/;

/** A key written short ("CaseRail.case") or in full ("appMission.appMissionStartPage.startATrip"). */
export const fullKey = (key: string) =>
  key.startsWith('appMission.') ? key : `appMission.appMissionId${key}`;

/**
 * Checks for what is drawn under `root`. `seen` is what a reader meets: the words plus every
 * attribute (spoken names, hints, placeholders). `expectBengali` asserts each key's Bengali is
 * there and its English sentence is not; a short English word such as "Date" or a tab name also
 * appears in English elsewhere on a page, so only sentences are checked for absence.
 */
export function bengaliChecks(root: () => Element) {
  const words = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const seen = () =>
    [
      words(),
      ...[...root().querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value)),
    ].join('\n');
  const expectBengali = (...keys: string[]) => {
    const text = seen();
    for (const key of keys.map(fullKey)) {
      expect(bn[key], key).toBeTruthy();
      expect(text, key).toContain(bn[key]);
      if ((en[key] ?? '').length >= 30) expect(words(), key).not.toContain(en[key]);
    }
    expect(text).not.toMatch(RAW_KEY);
  };
  return { words, seen, expectBengali };
}
