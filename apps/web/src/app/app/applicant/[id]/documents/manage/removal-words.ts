import type { CatalogKey } from '@visastack/i18n';
import { type ReactNode, createElement } from 'react';
import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';
import type { PartsTranslator } from '../../../../../../lib/language-parts';
import type { PageLanguage } from '../../../../../../lib/page-language';

/**
 * The sentences the removal screens (Delete My File, Delete Duplicate and Restore, Ask Us to
 * Remove This File) show after a refusal or a failed call, as keys in the applicant catalogue.
 * Not covered: the step-up sentence shared with other screens (lib/step-up) and the failed-Undo
 * line (components/lifecycle/undo-status), which stay English for now. A server action returns the English `message` it always sent plus the `messageKey`;
 * the dialog words it in the visitor's language. English comes from the catalogue, so the two
 * can never drift apart. Not a server-action file: it exports values.
 */

export type AppApplicantKey = CatalogKey<typeof appApplicantCatalog>;

export const REMOVAL_WORDS = {
  notOwnerOfRecord: 'appApplicant.appApplicantIdDocumentsManageRemoval.notOwnerOfRecord',
  fileNoLongerHere: 'appApplicant.appApplicantIdDocumentsManageRemoval.fileNoLongerHere',
  documentNoLongerHere: 'appApplicant.appApplicantIdDocumentsManageRemoval.documentNoLongerHere',
  deletingNotAvailable: 'appApplicant.appApplicantIdDocumentsManageRemoval.deletingNotAvailable',
  typeTheWordToConfirm: 'appApplicant.appApplicantIdDocumentsManageRemoval.typeTheWordToConfirm',
  changedSinceOpened: 'appApplicant.appApplicantIdDocumentsManageRemoval.changedSinceOpened',
  deletedManyFilesLastHour:
    'appApplicant.appApplicantIdDocumentsManageRemoval.deletedManyFilesLastHour',
  fileAlreadyDeletedOrRemoving:
    'appApplicant.appApplicantIdDocumentsManageRemoval.fileAlreadyDeletedOrRemoving',
  fileKeptLegal: 'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptLegal',
  fileKeptFinishedCase: 'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptFinishedCase',
  fileKeptFinishedCaseAskUs:
    'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptFinishedCaseAskUs',
  fileKeptAgencyAnswer: 'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptAgencyAnswer',
  fileKeptAgencyAnswerAskUs:
    'appApplicant.appApplicantIdDocumentsManageRemoval.fileKeptAgencyAnswerAskUs',
  fileCannotBeDeletedNow:
    'appApplicant.appApplicantIdDocumentsManageRemoval.fileCannotBeDeletedNow',
  couldNotCheckFile: 'appApplicant.appApplicantIdDocumentsManageRemoval.couldNotCheckFile',
  couldNotDeleteIt: 'appApplicant.appApplicantIdDocumentsManageRemoval.couldNotDeleteIt',
  copyAlreadyRecentlyDeleted:
    'appApplicant.appApplicantIdDocumentsManageRemoval.copyAlreadyRecentlyDeleted',
  copyKeptFinishedCase: 'appApplicant.appApplicantIdDocumentsManageRemoval.copyKeptFinishedCase',
  copyKeptAgencyAnswer: 'appApplicant.appApplicantIdDocumentsManageRemoval.copyKeptAgencyAnswer',
  copyKeptHandover: 'appApplicant.appApplicantIdDocumentsManageRemoval.copyKeptHandover',
  copyKeptSharedByName: 'appApplicant.appApplicantIdDocumentsManageRemoval.copyKeptSharedByName',
  copyKeptLegalHold: 'appApplicant.appApplicantIdDocumentsManageRemoval.copyKeptLegalHold',
  copyNotDuplicate: 'appApplicant.appApplicantIdDocumentsManageRemoval.copyNotDuplicate',
  copyCannotBeDeletedNow:
    'appApplicant.appApplicantIdDocumentsManageRemoval.copyCannotBeDeletedNow',
  couldNotCheckCopy: 'appApplicant.appApplicantIdDocumentsManageRemoval.couldNotCheckCopy',
  restoreTooLate: 'appApplicant.appApplicantIdDocumentsManageRemoval.restoreTooLate',
  restoreNotDeleted: 'appApplicant.appApplicantIdDocumentsManageRemoval.restoreNotDeleted',
  couldNotCheckDocument: 'appApplicant.appApplicantIdDocumentsManageRemoval.couldNotCheckDocument',
  couldNotRestoreIt: 'appApplicant.appApplicantIdDocumentsManageRemoval.couldNotRestoreIt',
  couldNotRemoveIt: 'appApplicant.appApplicantIdDocumentsManageRemoval.couldNotRemoveIt',
  requestNotOwner: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestNotOwner',
  requestsNotAvailable: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestsNotAvailable',
  requestAlreadyRemoving:
    'appApplicant.appApplicantIdDocumentsManageRemoval.requestAlreadyRemoving',
  requestLegalHold: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestLegalHold',
  requestAlreadyAsked: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestAlreadyAsked',
  requestAlreadyDecided: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestAlreadyDecided',
  chooseReasonFromList: 'appApplicant.appApplicantIdDocumentsManageRemoval.chooseReasonFromList',
  requestCouldNotBeSent: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestCouldNotBeSent',
  noWaitingRequest: 'appApplicant.appApplicantIdDocumentsManageRemoval.noWaitingRequest',
  requestSendFailed: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestSendFailed',
  requestCancelFailed: 'appApplicant.appApplicantIdDocumentsManageRemoval.requestCancelFailed',
} as const satisfies Record<string, AppApplicantKey>;

/** What a failed action returns: the English line plus the key the dialog words it from. */
export interface WordedRefusal {
  readonly message: string;
  readonly messageKey: AppApplicantKey;
}

/** A refusal as a screen keeps it: the key is optional (an answer that sent none shows its English). */
export type RefusalLine = { readonly message: string; readonly messageKey?: AppApplicantKey };

export function said(key: (typeof REMOVAL_WORDS)[keyof typeof REMOVAL_WORDS]): WordedRefusal {
  return { message: appApplicantCatalog.en[key], messageKey: key };
}

/**
 * The words to show for a failed action: from the catalogue when it sent a key this page knows,
 * else the English it sent, marked as English on a page in another language (WCAG 3.1.2).
 */
export function refusalNode(
  t: PartsTranslator<AppApplicantKey>,
  refusal: RefusalLine,
  pageLang: PageLanguage,
): ReactNode {
  const { message, messageKey } = refusal;
  // A key this page's catalogue does not know (a tab left open across a deploy) shows the English
  // the action sent, never the key itself.
  if (messageKey !== undefined && t(messageKey) !== messageKey) return t.node(messageKey);
  return pageLang === 'en' ? message : createElement('span', { lang: 'en' }, message);
}
