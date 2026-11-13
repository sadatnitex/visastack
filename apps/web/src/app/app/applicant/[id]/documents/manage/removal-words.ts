import type { CatalogKey } from '@visastack/i18n';
import type { ReactNode } from 'react';
import { appApplicantCatalog } from '../../../../../../i18n/app-applicant';
import type { PartsTranslator } from '../../../../../../lib/language-parts';

/**
 * Every sentence the removal screens (Delete My File, Delete Duplicate and Restore, Ask Us to
 * Remove This File) can show after a refusal or a failed call, as a key in the applicant
 * catalogue. A server action returns the English `message` it always sent plus the `messageKey`;
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

export function said(key: (typeof REMOVAL_WORDS)[keyof typeof REMOVAL_WORDS]): WordedRefusal {
  return { message: appApplicantCatalog.en[key], messageKey: key };
}

/** The words to show for a failed action: from the catalogue when it sent a key, else its own. */
export function refusalNode(
  t: PartsTranslator<AppApplicantKey>,
  refusal: { readonly message: string; readonly messageKey?: AppApplicantKey },
): ReactNode {
  return refusal.messageKey === undefined ? refusal.message : t.node(refusal.messageKey);
}
