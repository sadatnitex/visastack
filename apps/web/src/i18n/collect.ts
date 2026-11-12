import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the collect surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const collectCatalog = defineCatalog({
  en: {
    'collect.collectAccountAnswersPage.continueAnOpenRequest': 'Continue an Open Request',
    'collect.collectAccountAnswersPage.goToYourRecord': 'Go to Your Record',
    'collect.collectAccountAnswersPage.submittedToAgency': 'Submitted to Agency',
    'collect.collectAccountAnswersPage.submittedToAgencyTheyCanOpen':
      'Submitted to Agency. They can open only what you chose, exactly as it was when you sent it.',
    'collect.collectAccountAnswersPage.withdrawnFormattimestampdate':
      'Withdrawn {formatTimestampDate}',
    'collect.collectAccountAnswersPage.withdrawnTheAgencyCanNoLonger':
      'Withdrawn. The agency can no longer open anything in that answer.',
    'collect.collectAccountAnswersPage.youHaveNotAnsweredAnyAgency':
      'You have not answered any agency requests yet.',
    'collect.collectAccountAnswersPage.yourAnswersToAgencies': 'Your Answers to Agencies',
    'collect.collectAccountPage.answerAnAgencyRequest': 'Answer an Agency Request',
    'collect.collectAccountPage.answerForSomeoneElse': 'Answer for Someone Else',
    'collect.collectAccountPage.answerName': 'Answer {name}',
    'collect.collectAccountPage.chooseWhoseRecordToAnswerFrom':
      'Choose whose record to answer from. Only you can see this list.',
    'collect.collectAccountPage.poweredByVisastack': 'Powered by VisaStack.',
    'collect.collectAccountPage.seeYourAnswers': 'See Your Answers',
    'collect.collectAccountPage.setUpYourRecord': 'Set Up Your Record',
    'collect.collectAccountPage.setUpYourRecordFirst': 'Set Up Your Record First',
    'collect.collectAccountPage.theLinkMayHaveExpiredOr':
      'The link may have expired or been replaced, the request may have ended, or it was sent to a different email address. Open it again from the message you received, signed in with the address it was sent to, or ask the agency for a new link.',
    'collect.collectAccountPage.thisAgencyIsNotReviewedYet': 'This Agency Is Not Reviewed Yet',
    'collect.collectAccountPage.thisLinkIsNotOpen': 'This Link Is Not Open',
    'collect.collectAccountPage.visastackHasNotFinishedReviewingThe':
      'VisaStack has not finished reviewing the agency that sent this request, so nothing can be shared with it yet. Nothing has been shared. Try again later, or ask the agency.',
    'collect.collectAccountPage.whoIsThisFor': 'Who Is This For?',
    'collect.collectAccountPage.yourAnswerComesFromYourOwn':
      'Your answer comes from your own VisaStack record, and you have no one in it yet. Add yourself and your documents, then open this page again.',
    'collect.collectAccountResponseForm.chooseADifferentDocument': 'Choose a Different Document',
    'collect.collectAccountResponseForm.chooseFromYourDocuments': 'Choose from Your Documents',
    'collect.collectAccountResponseForm.everyItemHasSomethingChosen':
      'Every item has something chosen.',
    'collect.collectAccountResponseForm.missingItemsAreStillMissingYou':
      '{missing} items are Still Missing. You can submit now and the agency sees them as missing.',
    'collect.collectAccountResponseForm.noteFromTheAgencyNote': 'Note From the Agency: {note}',
    'collect.collectAccountResponseForm.nothingInThisRecordMatchesYet':
      'Nothing in this record matches yet.',
    'collect.collectAccountResponseForm.oneCopyChosen': 'One Copy Chosen',
    'collect.collectAccountResponseForm.oneItemIsStillMissingYou':
      'One item is Still Missing. You can submit now and the agency sees it as missing.',
    'collect.collectAccountResponseForm.reviewAndSubmit': 'Review and Submit',
    'collect.collectAccountResponseForm.sizeCopiesChosen': '{size} Copies Chosen',
    'collect.collectAccountResponseForm.stillMissing': 'Still Missing',
    'collect.collectChecklist.suggestedFromItsNameCheckIt': ' (suggested from its name: check it)',
    'collect.collectGuestDeskFiles.agencyNoteNote': 'Agency note: {note}',
    'collect.collectGuestDeskFiles.alreadySent': ' Already sent.',
    'collect.collectGuestDeskFiles.changeItem': 'Change Item',
    'collect.collectGuestDeskFiles.filesAlreadyPlaced': 'Files Already Placed',
    'collect.collectGuestDeskFiles.whatYouSent': 'What You Sent',
    'collect.collectGuestDeskFiles.yourFiles': 'Your Files',
    'collect.collectGuestFiles.checklistItemForFilename': 'Checklist Item for {fileName}',
    'collect.collectGuestFiles.notPlacedYet': 'Not Placed Yet',
    'collect.collectGuestFiles.removeFilename': 'Remove {fileName}',
    'collect.collectGuestFiles.saveTheItemForFilename': 'Save the item for {fileName}',
    'collect.collectGuestForms.itWorksFor10MinutesOnly':
      'It works for 10 minutes. Only the newest code works.',
    'collect.collectGuestForms.sixDigitCode': 'Six-Digit Code',
    'collect.collectGuestProgress.allMandatoryPlaced': 'All mandatory placed',
    'collect.collectGuestProgress.chooseHowLongWhoMayKeep':
      'Choose how long {who} may keep your files, then you can send.',
    'collect.collectGuestProgress.doneOfTotalMandatoryItemsPlaced':
      '{done} of {total} mandatory items placed',
    'collect.collectGuestProgress.itemsMarkedMandatoryIfItApplies':
      'Items marked Mandatory If It Applies are yours to check, and are not counted here.',
    'collect.collectGuestProgress.leftMandatoryOpen': '{left} mandatory open',
    'collect.collectGuestProgress.needslookFilesNeedALook':
      '{needsLook, plural, =1 {{needsLook} file needs a look} other {{needsLook} files need a look}}',
    'collect.collectGuestProgress.nothingMandatory': 'Nothing mandatory',
    'collect.collectGuestProgress.nothingOnThisListIsMarked':
      'Nothing on this list is marked Mandatory. Add what you have, then send it to {who} when you are ready.',
    'collect.collectGuestProgress.placedFilesPlaced':
      '{placed, plural, =1 {{placed} File Placed} other {{placed} Files Placed}}',
    'collect.collectGuestProgress.yourFilesAreStillBeingChecked':
      'Your files are still being checked. You can send them when that finishes.',
    'collect.collectGuestProgress.yourSubmission': 'Your submission',
    'collect.collectGuestUploader.addYourFiles': 'Add Your Files',
    'collect.collectGuestUploader.chooseFiles': 'Choose Files',
    'collect.collectGuestUploader.dropFilesOrAFolderHere':
      'Drop files or a folder here, or choose them.',
    'collect.collectGuestUploader.filesToAdd': 'Files to Add',
    'collect.collectGuestUploader.tryAgainForName': 'Try Again for {name}',
    'collect.collectPage.aCodeWasSentToThe':
      'A code was sent to the email address this request was sent to.',
    'collect.collectPage.addAndSendYourFiles': 'Add and send your files',
    'collect.collectPage.back': 'Back',
    'collect.collectPage.continueWithoutAnAccount': 'Continue Without an Account',
    'collect.collectPage.ifYouWereNotExpectingThis':
      'If you were not expecting this, you can ignore it. Powered by VisaStack.',
    'collect.collectPage.noEmailCheckYourSpamFolder':
      'No email? Check your spam folder, or ask for a new code.',
    'collect.collectPage.pleaseTryAgainLater': 'Please Try Again Later',
    'collect.collectPage.signInToRespond': 'Sign In to Respond',
    'collect.collectPage.theLinkMayHaveExpiredOr':
      'The link may have expired or been replaced, or the request may have ended. If it reached you recently, open it again from the message you received. Otherwise ask the agency that sent it for a new link.',
    'collect.collectPage.thisChecklistCannotBeShownRight':
      'This checklist cannot be shown right now. Ask the agency to send the request again.',
    'collect.collectPage.thisPrivateLinkComesFromAn':
      'This private link comes from an agency that asked you, through VisaStack, for documents. Opening it has shared nothing.',
    'collect.collectPage.toComeBackOpenTheLink':
      'To come back, open the link from your message again.',
    'collect.collectPage.toSeeTheChecklistConfirmIt':
      'To see the checklist, confirm it is you: we will email a six-digit code to the address this request was sent to. No account is made.',
    'collect.collectPage.tooManyLinksWereOpenedFrom':
      'Too many links were opened from this network just now. Try again in an hour.',
    'collect.collectPage.weSentASixDigitCode':
      'We sent a six-digit code to the email address this request was sent to.',
    'collect.collectPage.withoutAnAccountNoVisastackProfile':
      'Without an account, no VisaStack profile is made for you: your files go only to this request.',
    'collect.collectPage.youHaveLeftThisRequest': 'You Have Left This Request',
    'collect.collectRetentionChoice.chooseHowManyDaysAfterThis':
      'Choose how many days after this request closes {who} may keep the files you send. After that they are deleted, unless the law requires them to be kept longer.',
    'collect.collectRetentionChoice.days': 'Days',
    'collect.collectRetentionChoice.howLongWhoMayKeepYour': 'How Long {who} May Keep Your Files',
  },
  bn: {
    'collect.collectAccountPage.answerAnAgencyRequest': 'এজেন্সির অনুরোধের উত্তর দিন',
    'collect.collectAccountPage.thisLinkIsNotOpen': 'এই লিংকটি খোলা নেই',
    'collect.collectGuestDeskFiles.alreadySent': 'আগেই পাঠানো হয়েছে।',
    'collect.collectGuestDeskFiles.whatYouSent': 'আপনি যা পাঠিয়েছেন',
    'collect.collectGuestDeskFiles.yourFiles': 'আপনার ডকুমেন্ট',
    'collect.collectGuestFiles.removeFilename': '{fileName} সরান',
    'collect.collectGuestProgress.allMandatoryPlaced': 'সব বাধ্যতামূলক বসানো হয়েছে',
    'collect.collectGuestProgress.doneOfTotalMandatoryItemsPlaced':
      '{total}টি বাধ্যতামূলক আইটেমের মধ্যে {done}টি বসানো হয়েছে',
    'collect.collectGuestProgress.itemsMarkedMandatoryIfItApplies':
      'যেসব আইটেমে "প্রযোজ্য হলে বাধ্যতামূলক" লেখা আছে, সেগুলো আপনাকে নিজে দেখে নিতে হবে এবং এখানে গণনা করা হয়নি।',
    'collect.collectGuestProgress.leftMandatoryOpen': '{left}টি বাধ্যতামূলক বাকি',
    'collect.collectGuestProgress.nothingMandatory': 'বাধ্যতামূলক কিছু নেই',
    'collect.collectGuestProgress.nothingOnThisListIsMarked':
      'এই তালিকার কোনো কিছুই বাধ্যতামূলক হিসেবে চিহ্নিত নয়। আপনার কাছে যা আছে তা যোগ করুন, তারপর প্রস্তুত হলে {who}-এর কাছে পাঠান।',
    'collect.collectGuestUploader.chooseFiles': 'ডকুমেন্ট বেছে নিন',
    'collect.collectPage.aCodeWasSentToThe':
      'এই অনুরোধ যে ইমেইল ঠিকানায় পাঠানো হয়েছিল, সেখানে একটি কোড পাঠানো হয়েছে।',
    'collect.collectPage.toComeBackOpenTheLink': 'ফিরে আসতে আপনার বার্তা থেকে লিংকটি আবার খুলুন।',
    'collect.collectPage.weSentASixDigitCode':
      'এই অনুরোধ যে ইমেইল ঠিকানায় পাঠানো হয়েছিল, সেখানে আমরা ছয় অঙ্কের একটি কোড পাঠিয়েছি।',
  },
});
