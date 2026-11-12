import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-applicant surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appApplicantCatalog = defineCatalog({
  en: {
    'appApplicant.appApplicantIdAiReview.aiThinksThisIsATolowercase':
      'AI thinks this is a {toLowerCase} ({confidence}% sure). Please check it.',
    'appApplicant.appApplicantIdAiReview.bothAreRightItChanged': 'Both Are Right, It Changed',
    'appApplicant.appApplicantIdAiReview.changeItIfItIsNot':
      'Change it if it is not right before you accept.',
    'appApplicant.appApplicantIdAiReview.checkWhatWeFound': 'Check What We Found',
    'appApplicant.appApplicantIdAiReview.clear': 'Clear',
    'appApplicant.appApplicantIdAiReview.dateItChanged': 'Date It Changed',
    'appApplicant.appApplicantIdAiReview.fallbackProviderUsed': 'Fallback Provider Used',
    'appApplicant.appApplicantIdAiReview.foundAs': 'Found as',
    'appApplicant.appApplicantIdAiReview.keepMyCurrentValue': 'Keep My Current Value',
    'appApplicant.appApplicantIdAiReview.noLegibleTextWasFound': 'No legible text was found.',
    'appApplicant.appApplicantIdAiReview.pleaseCheck': 'Please Check',
    'appApplicant.appApplicantIdAiReview.possibleInconsistencyConfidenceConfidence':
      'Possible inconsistency ({confidence}% confidence)',
    'appApplicant.appApplicantIdAiReview.sensitive': 'Sensitive',
    'appApplicant.appApplicantIdAiReview.sensitiveDetailsAnythingYouChangedAnd':
      'Sensitive details, anything you changed, and anything that differs from your profile stay here for you to check one by one.',
    'appApplicant.appApplicantIdAiReview.skipLabel': 'Skip: {label}',
    'appApplicant.appApplicantIdAiReview.suggestedByApp': 'Suggested by {app}',
    'appApplicant.appApplicantIdAiReview.theAppSReasonInIts': 'The app’s reason, in its own words:',
    'appApplicant.appApplicantIdAiReview.theFirstReaderTimedOutOr':
      'The first reader timed out or was too busy, so a backup reader was used. Please check the result.',
    'appApplicant.appApplicantIdAiReview.useTheSuggestedValue': 'Use the Suggested Value',
    'appApplicant.appApplicantIdAiReview.useThisDocumentSValue': 'Use This Document’s Value',
    'appApplicant.appApplicantIdAiReview.valueToSave': 'Value to Save',
    'appApplicant.appApplicantIdAiReview.weCouldNotFindTheseExact':
      'We could not find these exact words in the document. Look at the document before you accept.',
    'appApplicant.appApplicantIdAiReview.weReadReadaswrittenPickTheDate':
      'We read "{readAsWritten}". Pick the date to save.',
    'appApplicant.appApplicantIdAiReview.yourProfileAlreadyHasADifferent':
      'Your profile already has a different value for this, hidden here to keep it private. Which is right?',
    'appApplicant.appApplicantIdAppSuggestions.aiApps': 'AI Apps',
    'appApplicant.appApplicantIdAppSuggestions.nothingWaiting': 'Nothing waiting.',
    'appApplicant.appApplicantIdAppSuggestions.pluralYourAiAppsSuggestedFor':
      '{plural} your AI apps suggested for your profile. Nothing is saved until you accept it. Check each one: an app can be wrong.',
    'appApplicant.appApplicantIdAppSuggestions.suggestionsFromAiApps': 'Suggestions from AI Apps',
    'appApplicant.appApplicantIdDocumentExpiryForm.expiryDate': 'Expiry Date',
    'appApplicant.appApplicantIdDocumentExpiryForm.noExpiryDateYetEnterThe':
      'No expiry date yet. Enter the one printed on the document.',
    'appApplicant.appApplicantIdDocumentExpiryForm.savedlabelEnteredByYou':
      '{savedLabel}, entered by you.',
    'appApplicant.appApplicantIdDocumentExpiryForm.savedlabelReadFromTheDocument':
      '{savedLabel}, read from the document.',
    'appApplicant.appApplicantIdDocumentExpiryForm.youEnteredTypedlabelTheDocumentSays':
      'You entered {typedLabel}. The document says {savedLabel}. Check which is right.',
    'appApplicant.appApplicantIdDocumentRenameForm.documentName': 'Document Name',
    'appApplicant.appApplicantIdDocumentSuggestionCard.cancel': 'Cancel',
    'appApplicant.appApplicantIdDocumentSuggestionCard.checkTheKindAndName':
      'Check the Kind and Name',
    'appApplicant.appApplicantIdDocumentSuggestionCard.chooseAKind': 'Choose a Kind',
    'appApplicant.appApplicantIdDocumentSuggestionCard.clear': 'Clear',
    'appApplicant.appApplicantIdDocumentSuggestionCard.edit': 'Edit',
    'appApplicant.appApplicantIdDocumentSuggestionCard.kindOfDocument': 'Kind of Document',
    'appApplicant.appApplicantIdDocumentSuggestionCard.listedUnder': 'Listed Under',
    'appApplicant.appApplicantIdDocumentSuggestionCard.name': 'Name',
    'appApplicant.appApplicantIdDocumentSuggestionCard.nothingIsSavedUntilYouAccept':
      'Nothing is saved until you accept.',
    'appApplicant.appApplicantIdDocumentSuggestionCard.pleaseCheck': 'Please Check',
    'appApplicant.appApplicantIdDocumentSuggestionCard.readByAi': 'Read by AI',
    'appApplicant.appApplicantIdDocumentSuggestionCard.recordgroupOnYourRecord':
      '{recordGroup} on your Record',
    'appApplicant.appApplicantIdDocumentSuggestionCard.whatIsIt': 'What Is It?',
    'appApplicant.appApplicantIdDocumentTypeForm.forExampleMarriageCertificate':
      'For example: Marriage Certificate',
    'appApplicant.appApplicantIdDocumentTypeForm.nameForAnOtherType': 'Name for an Other Type',
    'appApplicant.appApplicantIdDocumentTypeForm.notSetYet': 'Not Set Yet',
    'appApplicant.appApplicantIdDocumentTypeForm.save': 'Save',
    'appApplicant.appApplicantIdDocumentUploader.addedAsTitle': 'Added as {title}',
    'appApplicant.appApplicantIdDocumentUploader.appliesToTheFilesYouAdd':
      'Applies to the files you add next: it files them under the right sharing category and names them, for example Passport and your first name. You can change both later.',
    'appApplicant.appApplicantIdDocumentUploader.cameraPhoto': 'Camera Photo',
    'appApplicant.appApplicantIdDocumentUploader.chooseFiles': 'Choose Files',
    'appApplicant.appApplicantIdDocumentUploader.clearTheList': 'Clear the List',
    'appApplicant.appApplicantIdDocumentUploader.documentFiles': 'Document Files',
    'appApplicant.appApplicantIdDocumentUploader.documentSaved': 'Document Saved',
    'appApplicant.appApplicantIdDocumentUploader.documentsSaved': 'Documents Saved',
    'appApplicant.appApplicantIdDocumentUploader.dropFilesHere': 'Drop Files Here',
    'appApplicant.appApplicantIdDocumentUploader.embassiesUsuallyWantThisHandedIn':
      'Embassies usually want this handed in as the original when you apply. Upload a clear scan or photo here so it is ready to share, and keep the original safe.',
    'appApplicant.appApplicantIdDocumentUploader.filesBeingAdded': 'Files Being Added',
    'appApplicant.appApplicantIdDocumentUploader.kindOfDocumentOptional':
      'Kind of Document (Optional)',
    'appApplicant.appApplicantIdDocumentUploader.notAdded': 'Not added. ',
    'appApplicant.appApplicantIdDocumentUploader.notConfirmed': 'Not confirmed. ',
    'appApplicant.appApplicantIdDocumentUploader.notSureYet': 'Not Sure Yet',
    'appApplicant.appApplicantIdDocumentUploader.removeThisNewCopy': 'Remove This New Copy',
    'appApplicant.appApplicantIdDocumentUploader.removeThisNewCopyName':
      'Remove This New Copy: {name}',
    'appApplicant.appApplicantIdDocumentUploader.removing': 'Removing',
    'appApplicant.appApplicantIdDocumentUploader.storedPrivatelyOnlyYouAndThe':
      'Stored privately. Only you and the people you choose to share with can open it.',
    'appApplicant.appApplicantIdDocumentUploader.takeAPhoto': 'Take a Photo',
    'appApplicant.appApplicantIdDocumentUploader.tryAgain': 'Try Again',
    'appApplicant.appApplicantIdDocumentUploader.tryAgainName': 'Try Again: {name}',
    'appApplicant.appApplicantIdDocumentUploader.uploadOfName': 'Upload of {name}',
    'appApplicant.appApplicantIdDocumentUploader.uploadchecknoticeIphonePhotosHeicAreSaved':
      '{uploadCheckNotice} iPhone photos (HEIC) are saved as JPG copies so they open anywhere.',
    'appApplicant.appApplicantIdDocumentUploader.youAlreadyKeepAnIdenticalCopy':
      'You already keep an identical copy of this file.',
    'appApplicant.appApplicantIdDocumentsAddPage.addDocuments': 'Add Documents',
    'appApplicant.appApplicantIdDocumentsAddPage.documentStorage': 'Document Storage',
    'appApplicant.appApplicantIdDocumentsAddPage.dropYourFilesOrAWhole':
      'Drop your files or a whole folder here. We check each one, read what we can, and you approve every detail.',
    'appApplicant.appApplicantIdDocumentsAddPage.dropYourFilesOrAWhole088508':
      'Drop your files or a whole folder here. We check each one and keep it for you.',
    'appApplicant.appApplicantIdDocumentsAddPage.openMyDocuments': 'Open My Documents',
    'appApplicant.appApplicantIdDocumentsAddPage.pluralOneAnswer': '{plural} One Answer',
    'appApplicant.appApplicantIdDocumentsAddPage.takeAPhotoOrSayWhat':
      'Take a Photo, or Say What Kind of Document It Is',
    'appApplicant.appApplicantIdDocumentsAddPage.weFoundPluralToCheck':
      'We Found {plural} to Check',
    'appApplicant.appApplicantIdDocumentsAddPage.whatHappensNext': 'What Happens Next',
    'appApplicant.appApplicantIdDocumentsAddReadingSwitch.automaticReadingStateWord':
      'Automatic Reading: {STATE_WORD}',
    'appApplicant.appApplicantIdDocumentsManageArchiveArchiveAction.close': 'Close',
    'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.itIsASeparateCopyChecked':
      'It is a separate copy, checked for safety like any new file. Removing one does not remove the other.',
    'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.keepACopy': 'Keep a Copy',
    'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.keepACopyForName':
      'Keep a Copy for {name}',
    'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.keepACopyOfDocumentnameFor':
      'Keep a Copy of {documentName} for Whom?',
    'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.openTheirDocuments':
      'Open Their Documents',
    'appApplicant.appApplicantIdDocumentsManageCopyKeepCopyAction.thereIsNoOneElseOn':
      'There is no one else on your account to keep a copy for.',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.checkingThisCopy':
      'Checking this copy',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleteDuplicate':
      'Delete Duplicate?',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleteDuplicate484f53':
      'Delete Duplicate',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleting': 'Deleting',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.documentnameIsAnExactCopyThe':
      '{documentName} is an exact copy. The identical copy that stays is',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.done': 'Done',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.duplicateDeleted':
      'Duplicate Deleted',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.itWaitsInRecentlyDeletedUntil':
      'It waits in Recently Deleted until {formatTimestampDate}, and you can restore it until then. After that it is removed for good.',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.checkingThisDocument':
      'Checking this document',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.documentRestored':
      'Document Restored',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.documentnameIsBackInYourDocuments':
      '{documentName} is back in your documents. Cases that moved to the identical copy stay with that copy.',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.removedinlineRestoreItToBringIt':
      '{removedInLine}. Restore it to bring it back to your documents. Cases that moved to the identical copy stay with that copy.',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.restore': 'Restore',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.restoreDocumentname':
      'Restore {documentName}?',
    'appApplicant.appApplicantIdDocumentsManageDeleteRestoreAction.restoring': 'Restoring',
    'appApplicant.appApplicantIdDocumentsManageLifecycleTabs.documentLists': 'Document lists',
    'appApplicant.appApplicantIdDocumentsManageLifecycleTabs.removalRecords': 'Removal Records',
    'appApplicant.appApplicantIdDocumentsManageManageMenu.manage': 'Manage',
    'appApplicant.appApplicantIdDocumentsManageManageMenu.manageDocumentname':
      'Manage {documentName}',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.aCheckCanTakeAFew':
      'A check can take a few minutes. You can close this and come back.',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addTheDocument':
      'Add the Document',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addTheNewerDocument':
      'Add the Newer Document',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addedFormattimestampdateStatusWords':
      'Added {formatTimestampDate}{STATUS_WORDS}',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.adding': 'Adding',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.back': 'Back',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.checkAgain': 'Check Again',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.chooseTheNewerDocument':
      'Choose the Newer Document',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.continue': 'Continue',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.documentReplaced':
      'Document Replaced',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.itTakesThePlaceOfDocumentname':
      'It takes the place of {documentName}.',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.loadingYourDocuments':
      'Loading your documents',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replace': 'Replace',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replaceDocumentname':
      'Replace {documentName}?',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replaceWithANewerDocument':
      'Replace with a Newer Document',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replacing': 'Replacing',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.theOldDocumentStaysInYour':
      'The old document stays in your records, marked Replaced. Anything you already sent stays exactly as it was.',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.youHaveNoOtherDocumentOf':
      'You have no other document of this kind yet. Add the new one below.',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.cancelRequest': 'Cancel Request',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.cancelling': 'Cancelling',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.done': 'Done',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.keepRequest': 'Keep Request',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.removalRequested':
      'Removal Requested',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.requestCancelled':
      'Request Cancelled',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.youAskedUsToRemoveDocumentname':
      'You asked us to remove {documentName}. Our support team is checking the request. You can cancel it until they decide.',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.askUsToRemoveThisFile':
      'Ask Us to Remove This File',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.cancel': 'Cancel',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.sendRequest': 'Send Request',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.sending': 'Sending',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.whatRemovedMeans':
      'What Removed Means:',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.whyShouldWeRemoveDocumentname':
      'Why should we remove {documentName}?',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.checkingThisFile':
      'Checking this file',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.deleteDocumentnameNow':
      'Delete {documentName} Now?',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.deleteFileNow':
      'Delete File Now',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.fileDeleted':
      'File Deleted',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.typeDeleteToConfirm':
      'Type DELETE to Confirm',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.aSuggestionIsOnlyAGuess':
      'A suggestion is only a guess. Nothing is saved until you accept it.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.aboutTheseChoices': 'About These Choices',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.addAClearerCopyIfYou':
      'Add a clearer copy if you can, or keep this one as it is and add its details yourself.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.addANewerCopyIfYou':
      'Add a newer copy if you have one, or keep this one as it is.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.changeTitle': 'Change: {title}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.chooseSomeoneElse': 'Choose Someone Else',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.confirmTitle': 'Confirm: {title}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.fileItLabel': 'File It: {label}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.fileUnderDisplaynameLabel':
      'File Under {displayName}: {label}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.filedUnderPersonname':
      'Filed Under {personName}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.keepAsItIsTitle': 'Keep As It Is: {title}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.keepSeparateTitle': 'Keep Separate: {title}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.linkedCopies': 'Linked Copies',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.looksLikeWitharticle':
      'Looks like {withArticle}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.mostFilesAreSortedOnTheir':
      'Most files are sorted on their own. These need one answer from you. Nothing changes until you choose.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.needsOneDecision': 'Needs One Decision',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.openDocument': 'Open Document',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.openDocumentTitle': 'Open Document: {title}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.recognisedAutomatically':
      'Recognised Automatically',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.removeThisFileLabel':
      'Remove This File: {label}',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.sortedForYou': 'Sorted for You',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.theseFilesWereAddedForSeveral':
      'These files were added for several people at once. Each one waits here, seen only by you, until you choose who it belongs to.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.theseWereSortedForYouIf':
      'These were sorted for you. If one is wrong, Change puts it back as it was.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.titleHadAlreadyExpiredOnThe':
      '{title} had already expired on the day it was added.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.weCouldNotFindAnyReadable':
      'We could not find any readable text in {title}. It may be blank, blurred or turned sideways.',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.whatYouCanDo': 'What You Can Do',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.whichPerson': 'Which Person?',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.whichPersonIsLabelFor':
      'Which Person Is {label} For?',
    'appApplicant.appApplicantIdExpiryPage.aboutTheseDates': 'About These Dates',
    'appApplicant.appApplicantIdExpiryPage.addDatesToMyCalendar': 'Add Dates to My Calendar',
    'appApplicant.appApplicantIdExpiryPage.confirmationDates': 'Confirmation Dates',
    'appApplicant.appApplicantIdExpiryPage.confirmationsFromIssuers': 'Confirmations from Issuers',
    'appApplicant.appApplicantIdExpiryPage.datesExpiry': 'Dates & Expiry',
    'appApplicant.appApplicantIdExpiryPage.deadlineClock': 'Deadline Clock',
    'appApplicant.appApplicantIdExpiryPage.documentExpiry': 'Document Expiry',
    'appApplicant.appApplicantIdExpiryPage.documents': 'Documents',
    'appApplicant.appApplicantIdExpiryPage.documentsWithAnExpiryDateSuch':
      'Documents with an expiry date, such as a passport, appear here so you hear about them before they run out.',
    'appApplicant.appApplicantIdExpiryPage.enteredByYou': 'Entered by you.',
    'appApplicant.appApplicantIdExpiryPage.expiredPluralAgo': 'Expired {plural} ago',
    'appApplicant.appApplicantIdExpiryPage.expiresInPlural': 'Expires in {plural}',
    'appApplicant.appApplicantIdExpiryPage.noConfirmationsYet': 'No Confirmations Yet',
    'appApplicant.appApplicantIdExpiryPage.noDateRulesYet': 'No Date Rules Yet',
    'appApplicant.appApplicantIdExpiryPage.noDocumentsYet': 'No Documents Yet',
    'appApplicant.appApplicantIdExpiryPage.record': 'Record',
    'appApplicant.appApplicantIdExpiryPage.routeDateRules': 'Route Date Rules',
    'appApplicant.appApplicantIdExpiryPage.routeRules': 'Route Rules',
    'appApplicant.appApplicantIdExpiryPage.setExpiryDate': 'Set Expiry Date',
    'appApplicant.appApplicantIdExpiryPage.someRequirementsDemandEvidenceDatedWithin':
      "Some requirements demand evidence dated within a set window, separate from the document's own expiry.",
    'appApplicant.appApplicantIdExpiryPage.someVisaRoutesNeedADocument':
      'Some visa routes need a document dated within a set window, such as a bank statement from the last 30 days. They appear here once a case uses such a route.',
    'appApplicant.appApplicantIdExpiryPage.threeSeparateDatesWhenADocument':
      'Three separate dates: when a document expires, whether a route wants a newer one, and how long a confirmation from an issuer stays valid. We never merge them into one status.',
    'appApplicant.appApplicantIdExpiryPage.whenAnIssuerSuchAsA':
      'When an issuer, such as a bank or employer, confirms a document, the confirmation and how long it stays valid appear here.',
    'appApplicant.appApplicantIdExpiryPage.youEnteredADifferentDateCheck':
      'You entered a different date. Check which is right on Documents.',
    'appApplicant.appApplicantIdHistoryHistoryLog.everyPart': 'Every Part',
    'appApplicant.appApplicantIdHistoryHistoryLog.partOfTheProfile': 'Part of the Profile',
    'appApplicant.appApplicantIdHistoryHistoryLog.profileHistoryEntries': 'Profile History Entries',
    'appApplicant.appApplicantIdHistoryHistoryLog.showThisPart': 'Show This Part',
    'appApplicant.appApplicantIdHistoryPage.everySavedValueIsKeptAnd':
      'Every saved value is kept, and nothing is overwritten. This is the full trail, in order, with where each value came from.',
    'appApplicant.appApplicantIdHistoryPage.history': 'History',
    'appApplicant.appApplicantIdHistoryPage.historyListsEverySavedVersionOf':
      'History lists every saved version of a profile detail, with when and how it was saved. Nothing has been saved to this profile yet, so there is nothing to list. Add a detail on the profile, or upload a document and approve the details it suggests. Each save then appears here.',
    'appApplicant.appApplicantIdHistoryPage.nothingSavedToThisProfileYet':
      'Nothing Saved to This Profile Yet',
    'appApplicant.appApplicantIdImportImportPanel.addAFolder': 'Add a Folder',
    'appApplicant.appApplicantIdImportImportPanel.afterThisImport': 'After This Import',
    'appApplicant.appApplicantIdImportImportPanel.chooseWhichPerson': 'Choose Which Person',
    'appApplicant.appApplicantIdImportImportPanel.dropFilesOrAFolderHere':
      'Drop Files or a Folder Here',
    'appApplicant.appApplicantIdImportImportPanel.eachFileIsStoredPrivatelyAnd':
      'Each file is stored privately and checked when it arrives, exactly as a single upload is. Only you and the people you choose to share with can open it.',
    'appApplicant.appApplicantIdImportImportPanel.eachFileWaitsInNeedsOne':
      'Each file waits in Needs One Decision, seen only by you, until you choose who it belongs to. We suggest a person only when the name and date of birth in the file match exactly one of your people.',
    'appApplicant.appApplicantIdImportImportPanel.everyFileYouAddNowIs':
      'Every file you add now is saved under this person. You can change this between files.',
    'appApplicant.appApplicantIdImportImportPanel.filesForSeveralPeopleWaitIn':
      'Files for several people wait in Needs One Decision until you choose who each one belongs to.',
    'appApplicant.appApplicantIdImportImportPanel.filesInThisImport': 'Files in This Import',
    'appApplicant.appApplicantIdImportImportPanel.filesToImport': 'Files to Import',
    'appApplicant.appApplicantIdImportImportPanel.folderToImport': 'Folder to Import',
    'appApplicant.appApplicantIdImportImportPanel.foldersInsideItAreIncludedYou':
      'Folders inside it are included. You do not need to say what each file is first. Each file gets its own line below.',
    'appApplicant.appApplicantIdImportImportPanel.forgetEarlierImports': 'Forget Earlier Imports',
    'appApplicant.appApplicantIdImportImportPanel.inFolder': 'In {folder}',
    'appApplicant.appApplicantIdImportImportPanel.mostFilesAreSortedOnTheir':
      'Most files are sorted on their own. Anything that needs your answer is in Needs One Decision, and details read from your files wait for your approval.',
    'appApplicant.appApplicantIdImportImportPanel.nameThisPerson': '{name} (This Person)',
    'appApplicant.appApplicantIdImportImportPanel.notSureHelpMeDecide': 'Not Sure, Help Me Decide',
    'appApplicant.appApplicantIdImportImportPanel.openNeedsOneDecision': 'Open Needs One Decision',
    'appApplicant.appApplicantIdImportImportPanel.pause': 'Pause',
    'appApplicant.appApplicantIdImportImportPanel.resume': 'Resume',
    'appApplicant.appApplicantIdImportImportPanel.reviewSuggestedDetails':
      'Review Suggested Details',
    'appApplicant.appApplicantIdImportImportPanel.seeWhatWeFound': 'See What We Found',
    'appApplicant.appApplicantIdImportImportPanel.seeWhatWeFoundForName':
      'See What We Found for {name}',
    'appApplicant.appApplicantIdImportImportPanel.sendAgain': 'Send Again',
    'appApplicant.appApplicantIdImportImportPanel.sendAgainName': 'Send Again: {name}',
    'appApplicant.appApplicantIdImportImportPanel.showAllLength': 'Show All {length}',
    'appApplicant.appApplicantIdImportImportPanel.showFewer': 'Show Fewer',
    'appApplicant.appApplicantIdImportImportPanel.stop': 'Stop',
    'appApplicant.appApplicantIdImportImportPanel.theHourlyUploadLimitWasReached':
      '{held, plural, =1 {The hourly upload limit was reached, so {held} file is waiting. Nothing more is sent until you try again.} other {The hourly upload limit was reached, so {held} files are waiting. Nothing more is sent until you try again.}}',
    'appApplicant.appApplicantIdImportImportPanel.thisBrowserRemembersWhichFilesEarlier':
      'This browser remembers which files earlier imports here added (not their names), so a file already added is not sent again. To finish an import, add the same folder again.',
    'appApplicant.appApplicantIdImportImportPanel.thisFolderHoldsMoreThanTolocalestring':
      'This folder holds more than {toLocaleString} files. Only the first {MAX_IMPORT_FILES} can be added in one import; the rest were not looked at.',
    'appApplicant.appApplicantIdImportImportPanel.tryAgainForAllPausedFiles':
      'Try Again for All Paused Files',
    'appApplicant.appApplicantIdImportImportPanel.uploadlimitstextUpToMaxImportFiles':
      '{uploadLimitsText} Up to {MAX_IMPORT_FILES} files in one import.',
    'appApplicant.appApplicantIdImportImportPanel.whoAreTheseFilesFor': 'Who Are These Files For?',
    'appApplicant.appApplicantIdImportImportPanel.yourFiles': 'Your Files',
    'appApplicant.appApplicantIdImportImportPanel.yourFilesAreSavedAndChecked':
      'Your files are saved and checked. Automatic reading is off, so nothing was read: you add the details yourself. Anything that needs your answer is in Needs One Decision.',
    'appApplicant.appApplicantIdNameReview.proposedFilename': 'Proposed filename',
    'appApplicant.appApplicantIdPage.aCaseIsWhereOneVisa':
      'A case is where one visa application comes together. Start one for the route you are planning, and your saved documents are checked against its checklist.',
    'appApplicant.appApplicantIdPage.aboutTheseTotals': 'About These Totals',
    'appApplicant.appApplicantIdPage.activeCases': 'Active Cases',
    'appApplicant.appApplicantIdPage.allCases': 'All Cases →',
    'appApplicant.appApplicantIdPage.casesAreUnavailable': 'Cases Are Unavailable',
    'appApplicant.appApplicantIdPage.checklistProgress': 'Checklist Progress',
    'appApplicant.appApplicantIdPage.closedAndCancelledCasesAreExcluded':
      'Closed and cancelled cases are excluded.',
    'appApplicant.appApplicantIdPage.completenessDoesNotVerifyIdentity':
      'Completeness does not verify identity.',
    'appApplicant.appApplicantIdPage.continueCase': 'Continue Case →',
    'appApplicant.appApplicantIdPage.continueProfile': 'Continue Profile →',
    'appApplicant.appApplicantIdPage.continueWhereYouLeftOff': 'Continue Where You Left Off',
    'appApplicant.appApplicantIdPage.datesAreUnavailable': 'Dates Are Unavailable',
    'appApplicant.appApplicantIdPage.datesExpiry': 'Dates & Expiry →',
    'appApplicant.appApplicantIdPage.detailsWithValuesInOpenSections':
      'Details with values in open sections',
    'appApplicant.appApplicantIdPage.detailsWithValuesInOpenSections8284e6':
      'details with values in open sections',
    'appApplicant.appApplicantIdPage.documentsInYourWallet': 'Documents in Your Wallet',
    'appApplicant.appApplicantIdPage.documentsNeedingReview': 'Documents Needing Review',
    'appApplicant.appApplicantIdPage.done': 'Done',
    'appApplicant.appApplicantIdPage.essentialsAdded': 'Essentials added',
    'appApplicant.appApplicantIdPage.essentialsAdded28ca58': 'essentials added',
    'appApplicant.appApplicantIdPage.evidenceRequestsWaitingForAReply':
      'Evidence Requests Waiting for a Reply',
    'appApplicant.appApplicantIdPage.home': 'Home',
    'appApplicant.appApplicantIdPage.inProgress': 'In Progress',
    'appApplicant.appApplicantIdPage.itemsNeedingAttention': 'Items Needing Attention',
    'appApplicant.appApplicantIdPage.manageSharing': 'Manage Sharing →',
    'appApplicant.appApplicantIdPage.needsYourAttention': 'Needs Your Attention',
    'appApplicant.appApplicantIdPage.next': 'Next',
    'appApplicant.appApplicantIdPage.noActiveCaseYet': 'No Active Case Yet',
    'appApplicant.appApplicantIdPage.noRecordedActivityYet': 'No Recorded Activity Yet',
    'appApplicant.appApplicantIdPage.noUpcomingCaseDates': 'No Upcoming Case Dates',
    'appApplicant.appApplicantIdPage.nothingIsWaitingForYou': 'Nothing is waiting for you.',
    'appApplicant.appApplicantIdPage.nothingNeedsADecisionRightNow':
      'Nothing needs a decision right now.',
    'appApplicant.appApplicantIdPage.openDocumentsToReviewProcessingAnd':
      'Open documents to review processing and safety.',
    'appApplicant.appApplicantIdPage.pathdoneOfLengthStepsDoneKeep':
      '{pathDone} of {length} Steps Done. Keep Going',
    'appApplicant.appApplicantIdPage.personalApplication': 'Personal application',
    'appApplicant.appApplicantIdPage.pluralAgreeALook': '{plural} {agree} a look.',
    'appApplicant.appApplicantIdPage.profileChangesUploadsAndCaseUpdates':
      'Profile changes, uploads and case updates will appear here. This is a recent-record summary, not a complete audit log.',
    'appApplicant.appApplicantIdPage.profileHistory': 'Profile History →',
    'appApplicant.appApplicantIdPage.profileSharing': 'Profile & Sharing',
    'appApplicant.appApplicantIdPage.recentActivity': 'Recent Activity',
    'appApplicant.appApplicantIdPage.refreshToTryAgain': 'Refresh to try again.',
    'appApplicant.appApplicantIdPage.requestsSuggestedDetailsAndFlaggedDocuments':
      'Requests, suggested details and flagged documents.',
    'appApplicant.appApplicantIdPage.requiredItemsOnFile': 'required items on file',
    'appApplicant.appApplicantIdPage.requirementCompletenessIsNotAnApproval':
      'Requirement completeness is not an approval prediction.',
    'appApplicant.appApplicantIdPage.setATargetDeadlineOrTravel':
      'Set a target deadline or travel date in a case. Appointments remain in the individual case calendar.',
    'appApplicant.appApplicantIdPage.someRecordsCouldNotBeLoaded':
      'Some records could not be loaded. Try refreshing before relying on these totals.',
    'appApplicant.appApplicantIdPage.someSectionsAreUnavailableUnavailableTotals':
      'Some sections are unavailable. Unavailable totals are not reported as zero.',
    'appApplicant.appApplicantIdPage.startACase': 'Start a Case',
    'appApplicant.appApplicantIdPage.stepsToGetReady': 'Steps to get ready',
    'appApplicant.appApplicantIdPage.suggestedDetailsAwaitingApproval':
      'Suggested Details Awaiting Approval',
    'appApplicant.appApplicantIdPage.suggestionsFromAiAppsWaitingFor':
      'Suggestions from AI Apps Waiting for You',
    'appApplicant.appApplicantIdPage.threeStepsToGetReady': 'Three Steps to Get Ready',
    'appApplicant.appApplicantIdPage.unavailable': 'Unavailable',
    'appApplicant.appApplicantIdPage.untilAChecklistIsAttachedYou':
      "Until a checklist is attached, you review this case's requirements by hand in the case.",
    'appApplicant.appApplicantIdPage.upcoming': 'Upcoming',
    'appApplicant.appApplicantIdPage.upcomingDatesRecentActivityAndProfile':
      'Upcoming dates, recent activity and profile health',
    'appApplicant.appApplicantIdPage.updatedFormattimestampdate': 'Updated {formatTimestampDate}',
    'appApplicant.appApplicantIdPage.visaCase': 'Visa Case',
    'appApplicant.appApplicantIdProfileEditor.addAnother': 'Add Another',
    'appApplicant.appApplicantIdProfileEditor.addLabel': 'Add {label}',
    'appApplicant.appApplicantIdProfileEditor.addSomethingElse': 'Add Something Else',
    'appApplicant.appApplicantIdProfileEditor.addTheDateThisBecameTrue':
      'Add the Date This Became True',
    'appApplicant.appApplicantIdProfileEditor.answeredOfTotalDetailsCounted':
      '{answered} of {total} details counted',
    'appApplicant.appApplicantIdProfileEditor.apply': 'Apply',
    'appApplicant.appApplicantIdProfileEditor.area': 'Area',
    'appApplicant.appApplicantIdProfileEditor.backedByASuppliedDocument':
      '✓ Backed by a supplied document.',
    'appApplicant.appApplicantIdProfileEditor.chooseAPurpose': 'Choose a purpose…',
    'appApplicant.appApplicantIdProfileEditor.dateItEnded': 'Date It Ended',
    'appApplicant.appApplicantIdProfileEditor.descriptionOpencountOfLengthSectionsOpen':
      '{description} {openCount} of {length} sections open.',
    'appApplicant.appApplicantIdProfileEditor.detailsFilled': 'details filled',
    'appApplicant.appApplicantIdProfileEditor.documentsForThisSection':
      'Documents for This Section',
    'appApplicant.appApplicantIdProfileEditor.doesNotApply': 'Does not apply',
    'appApplicant.appApplicantIdProfileEditor.eGPassportAddressEmployer':
      'e.g. passport, address, employer',
    'appApplicant.appApplicantIdProfileEditor.editTheseDetails': 'Edit These Details',
    'appApplicant.appApplicantIdProfileEditor.effectiveAsOfFormatdateonly':
      'Effective as of {formatDateOnly}',
    'appApplicant.appApplicantIdProfileEditor.ended': 'Ended',
    'appApplicant.appApplicantIdProfileEditor.endedOnFormatdateonlyItsDetailsStay':
      'Ended on {formatDateOnly}. Its details stay on file. Save a change below to make it current again.',
    'appApplicant.appApplicantIdProfileEditor.enteredByTheTraveller': '✓ Entered by the traveller.',
    'appApplicant.appApplicantIdProfileEditor.essentialsFirst': 'Essentials First',
    'appApplicant.appApplicantIdProfileEditor.everyEssentialIsAddedAddMore':
      'Every essential is added. Add more from any section when a case needs it.',
    'appApplicant.appApplicantIdProfileEditor.everySectionSuggestedForThisPurpose':
      'Every section suggested for this purpose is already open.',
    'appApplicant.appApplicantIdProfileEditor.everySectionWithEveryDetailYou':
      'Every section, with every detail you can add, including these.',
    'appApplicant.appApplicantIdProfileEditor.fullProfileAnsweredOfTotalDetails':
      'Full profile: {answered} of {total} details in your {plural} have values ({percent}%). Opening a section adds its details to this number at once.',
    'appApplicant.appApplicantIdProfileEditor.history': 'History →',
    'appApplicant.appApplicantIdProfileEditor.howThisWasChecked': 'How This Was Checked',
    'appApplicant.appApplicantIdProfileEditor.iHaveNoTolowercase': 'I have no {toLowerCase}',
    'appApplicant.appApplicantIdProfileEditor.labelMarkedAsNotApplyingTo':
      '{label}: marked as not applying to you.',
    'appApplicant.appApplicantIdProfileEditor.lastConfirmedFormatdate':
      'Last confirmed {formatDate}',
    'appApplicant.appApplicantIdProfileEditor.locked': 'Locked',
    'appApplicant.appApplicantIdProfileEditor.lockedAndNotCountedTickUse':
      'Locked and not counted. Tick “Use this section” to fill it in; it then counts toward your completion.',
    'appApplicant.appApplicantIdProfileEditor.markAsEndedName': 'Mark as Ended: {name}',
    'appApplicant.appApplicantIdProfileEditor.needsReview': 'Needs Review',
    'appApplicant.appApplicantIdProfileEditor.noFieldsMatchTryAnotherField':
      'No fields match. Try another field name.',
    'appApplicant.appApplicantIdProfileEditor.noLongerCurrentLabel': 'No Longer Current: {label}',
    'appApplicant.appApplicantIdProfileEditor.noSupportingDocumentSupplied':
      '✗ No supporting document supplied.',
    'appApplicant.appApplicantIdProfileEditor.noneRecordedYet': 'None recorded yet.',
    'appApplicant.appApplicantIdProfileEditor.notOnTheListAddIt':
      'Not on the list? Add it here. It stays with this section and is saved like any other detail.',
    'appApplicant.appApplicantIdProfileEditor.notUploadedYet': 'Not Uploaded Yet',
    'appApplicant.appApplicantIdProfileEditor.notYetEntered': '✗ Not yet entered.',
    'appApplicant.appApplicantIdProfileEditor.open': 'Open',
    'appApplicant.appApplicantIdProfileEditor.openBecauseItHoldsYourDetails':
      'Open because it holds your details',
    'appApplicant.appApplicantIdProfileEditor.openForEveryone': 'Open for everyone',
    'appApplicant.appApplicantIdProfileEditor.otherOthertext': 'Other: {otherText}',
    'appApplicant.appApplicantIdProfileEditor.profileAreas': 'Profile areas',
    'appApplicant.appApplicantIdProfileEditor.searchAllProfileFields': 'Search All Profile Fields',
    'appApplicant.appApplicantIdProfileEditor.seeThePluralInside': 'See the {plural} inside',
    'appApplicant.appApplicantIdProfileEditor.select': 'Select…',
    'appApplicant.appApplicantIdProfileEditor.showAllSections': 'Show All Sections',
    'appApplicant.appApplicantIdProfileEditor.showEssentialsOnly': 'Show Essentials Only',
    'appApplicant.appApplicantIdProfileEditor.showSuggestions': 'Show Suggestions',
    'appApplicant.appApplicantIdProfileEditor.somethingElseInLabel': 'Something else in {label}',
    'appApplicant.appApplicantIdProfileEditor.startWithTheDetailsMostVisa':
      'Start with the details most visa forms ask for first. Everything else can wait.',
    'appApplicant.appApplicantIdProfileEditor.suggested': 'Suggested',
    'appApplicant.appApplicantIdProfileEditor.suggestedlockedcountSuggestedSectionsAreStillLoc':
      '{suggestedLockedCount, plural, =1 {{suggestedLockedCount} suggested section is still locked.} other {{suggestedLockedCount} suggested sections are still locked.}}',
    'appApplicant.appApplicantIdProfileEditor.thisDoesNotApplyToMe': 'This does not apply to me',
    'appApplicant.appApplicantIdProfileEditor.thisFieldIsMarkedTolowercaseIn':
      'This field is marked {toLowerCase} in the canonical registry.',
    'appApplicant.appApplicantIdProfileEditor.thisLabelEndedPosition':
      'This {label} Ended ({position})',
    'appApplicant.appApplicantIdProfileEditor.upload': 'Upload',
    'appApplicant.appApplicantIdProfileEditor.uploaded': 'Uploaded',
    'appApplicant.appApplicantIdProfileEditor.useThisSection': 'Use This Section',
    'appApplicant.appApplicantIdProfileEditor.usuallyHandedInAsTheOriginal':
      'Usually handed in as the original when you apply. Upload a clear scan or photo here so it is ready to share.',
    'appApplicant.appApplicantIdProfileEditor.whatIsThisProfileFor': 'What is this profile for?',
    'appApplicant.appApplicantIdProfileEditor.whenTolowercaseBecameTrueLeaveBlank':
      'When {toLowerCase} became true. Leave blank if you are not sure.',
    'appApplicant.appApplicantIdProfileEditor.whereThisCameFrom': 'Where This Came From',
    'appApplicant.appApplicantIdProfileEditor.whereThisCameFromTheDocument':
      'Where this came from: the document {label} was read from',
    'appApplicant.appApplicantIdProfileEditor.youMarkedThisNoLongerCurrent':
      'You marked this No Longer Current. Enter a new value above when you have one.',
    'appApplicant.appApplicantIdProfileEditor.youSaidYouHaveNone': 'You said you have none.',
    'appApplicant.appApplicantIdProfilePage.aboutEssentials': 'About Essentials',
    'appApplicant.appApplicantIdProfilePage.aboutSuggestions': 'About Suggestions',
    'appApplicant.appApplicantIdProfilePage.aboutThisProfile': 'About This Profile',
    'appApplicant.appApplicantIdProfilePage.addInformation': 'Add Information',
    'appApplicant.appApplicantIdProfilePage.aiSuggestionsDoNotChangeYour':
      'AI suggestions do not change your profile until you approve them. Your confirming a detail is not the same as the issuer confirming it.',
    'appApplicant.appApplicantIdProfilePage.aiSuggestionsWaitForYourApproval':
      'AI suggestions wait for your approval.',
    'appApplicant.appApplicantIdProfilePage.allProfileHistory': 'All Profile History →',
    'appApplicant.appApplicantIdProfilePage.answeredOfTotal': '{answered} of {total}',
    'appApplicant.appApplicantIdProfilePage.chooseWhetherToSaveYourProfile':
      'Choose Whether to Save Your Profile',
    'appApplicant.appApplicantIdProfilePage.confirmedByTheTraveller': 'Confirmed by the traveller',
    'appApplicant.appApplicantIdProfilePage.datesExpiry': 'Dates & Expiry →',
    'appApplicant.appApplicantIdProfilePage.essentialsAdded': 'Essentials Added',
    'appApplicant.appApplicantIdProfilePage.fieldsBackedByADocument': 'Fields Backed by a Document',
    'appApplicant.appApplicantIdProfilePage.fieldsThatDoNotMatch': 'Fields That Do Not Match',
    'appApplicant.appApplicantIdProfilePage.fullProfileCompletenessOfTheDetails':
      'Full profile: {completeness}% of the details in your {plural}.',
    'appApplicant.appApplicantIdProfilePage.latestChanges': 'Latest Changes',
    'appApplicant.appApplicantIdProfilePage.myProfile': 'My Profile',
    'appApplicant.appApplicantIdProfilePage.noSavedChangesYet': 'No Saved Changes Yet',
    'appApplicant.appApplicantIdProfilePage.oneReusableSetOfDetailsEvery':
      'One reusable set of details. Every saved change stays in your history.',
    'appApplicant.appApplicantIdProfilePage.profileDetail': 'Profile Detail',
    'appApplicant.appApplicantIdProfilePage.profileHealth': 'Profile Health',
    'appApplicant.appApplicantIdProfilePage.profileHealthAndLatestChanges':
      'Profile health and latest changes',
    'appApplicant.appApplicantIdProfilePage.record': 'Record',
    'appApplicant.appApplicantIdProfilePage.recordedUpdate': 'Recorded Update',
    'appApplicant.appApplicantIdProfilePage.reviewDocumentSuggestions':
      'Review Document Suggestions →',
    'appApplicant.appApplicantIdProfilePage.reviewPermissions': 'Review Permissions',
    'appApplicant.appApplicantIdProfilePage.selectedTravellerAndProfileCompletion':
      'Selected traveller and profile completion',
    'appApplicant.appApplicantIdProfilePage.theDetailsMostVisaFormsAsk':
      'The details most visa forms ask for first.',
    'appApplicant.appApplicantIdProfilePage.theseCountsAreSeparateTheyAre':
      'These counts are separate. They are not a score that proves anything. Open a field to see agency reviews and confirmations from issuers.',
    'appApplicant.appApplicantIdProfilePage.turnOnLetVisastackProcessMy':
      'Turn on “Let VisaStack Process My Details” on Home to edit this profile. Existing values are not changed.',
    'appApplicant.appApplicantIdProfilePage.youDecideWhatBecomesAFact':
      'You Decide What Becomes a Fact',
    'appApplicant.appApplicantIdProfilePage.yourSavedFieldVersionsWillAppear':
      'Your saved field versions will appear here.',
    'appApplicant.appApplicantIdRecordBrowser.1ItemMatches': '1 item matches.',
    'appApplicant.appApplicantIdRecordBrowser.namesKindsCategoriesOrCases':
      'Names, kinds, categories or cases',
    'appApplicant.appApplicantIdRecordBrowser.notAvailableRightNow': 'Not Available Right Now',
    'appApplicant.appApplicantIdRecordBrowser.nothingMatchesClearTheSearchOr':
      'Nothing matches. Clear the search or choose another category or filter.',
    'appApplicant.appApplicantIdRecordBrowser.previous': 'Previous',
    'appApplicant.appApplicantIdRecordBrowser.recordFilters': 'Record Filters',
    'appApplicant.appApplicantIdRecordBrowser.recordPages': 'Record pages',
    'appApplicant.appApplicantIdRecordBrowser.rowcountItemsMatch': '{rowCount} items match.',
    'appApplicant.appApplicantIdRecordBrowser.searchYourRecord': 'Search Your Record',
    'appApplicant.appApplicantIdRecordPage.addADocument': 'Add a Document',
    'appApplicant.appApplicantIdRecordPage.allRecords': 'All Records',
    'appApplicant.appApplicantIdRecordPage.currentVersionMeansThisIsThe':
      'Current Version means this is the newest copy you saved. It does not mean anyone has checked that it is genuine, or that it suits every application. Files still being checked, refused, expired or replaced are never shown as ready to use.',
    'appApplicant.appApplicantIdRecordPage.everythingSavedForDisplaynameInOne':
      'Everything saved for {displayName}, in one place. Find a detail or a document, see which copy is current, then use it in a case or share it.',
    'appApplicant.appApplicantIdRecordPage.updateYourProfile': 'Update Your Profile',
    'appApplicant.appApplicantIdRecordPage.youHaveNotAddedADocument':
      'You have not added a document yet. You can still fill in your details by hand now, and add a passport or other document whenever you have it.',
    'appApplicant.appApplicantIdRecordPage.yourDocumentsCouldNotBeLoaded':
      'Your documents could not be loaded just now, so only your profile details are listed. Refresh the page to try again.',
    'appApplicant.appApplicantIdRecordSections.recordSections': 'Record Sections',
    'appApplicant.appApplicantIdRemovalRecordsPage.records': 'Records',
    'appApplicant.appApplicantIdRemovalRecordsPage.removalRecords': 'Removal Records',
    'appApplicant.appApplicantIdRemovalRecordsPage.whatWasDeletedFromThisRecord':
      'What was deleted from this record, and where each removal stands. Each one shows its reference code, its kind, and when and from which account it was asked, never a name or a title.',
    'appApplicant.appApplicantIdReviewFlowSteps.done': ', done',
    'appApplicant.appApplicantIdReviewFlowSteps.next': ', next',
    'appApplicant.appApplicantIdReviewFlowSteps.now': ', now',
    'appApplicant.appApplicantIdReviewFlowSteps.whereYouAre': 'Where you are',
    'appApplicant.appApplicantIdReviewPage.1FileSaved': '1 File Saved',
    'appApplicant.appApplicantIdReviewPage.addMoreDocuments': 'Add More Documents',
    'appApplicant.appApplicantIdReviewPage.allDone': 'All Done',
    'appApplicant.appApplicantIdReviewPage.checkTheNameWeSuggestFor':
      'Check the name we suggest for each document.',
    'appApplicant.appApplicantIdReviewPage.detailsWeReadFromYourDocuments':
      'Details we read from your documents. Nothing is added to your profile until you accept it.',
    'appApplicant.appApplicantIdReviewPage.filesNotReadYet': 'Files Not Read Yet',
    'appApplicant.appApplicantIdReviewPage.lengthFilesSaved': '{length} Files Saved',
    'appApplicant.appApplicantIdReviewPage.openMyProfile': 'Open My Profile',
    'appApplicant.appApplicantIdReviewPage.pluralFoundInPlural2AcceptThe':
      '{plural} found in {plural2}. Accept the clear ones at once, or one by one. Sensitive details, such as an ID number, are always decided one at a time.',
    'appApplicant.appApplicantIdReviewPage.readAgain': 'Read Again',
    'appApplicant.appApplicantIdReviewPage.readThisDocument': 'Read This Document',
    'appApplicant.appApplicantIdReviewPage.seeEverythingThatIsWaiting':
      'See everything that is waiting',
    'appApplicant.appApplicantIdReviewPage.weCheckEachFileReadIt':
      'We check each file, read it, and bring you the details to approve. Nothing is added to your profile until you accept it.',
    'appApplicant.appApplicantIdReviewPage.whatWeFound': 'What We Found',
    'appApplicant.appApplicantIdReviewPage.youAreUpToDate': 'You Are Up to Date',
    'appApplicant.appApplicantIdReviewPage.youCanLeaveThisPageWe':
      'You can leave this page. We keep going, and Home tells you when details are ready.',
    'appApplicant.appApplicantIdReviewPage.yourFilesAreSaved': 'Your Files Are Saved',
  },
  bn: {
    'appApplicant.appApplicantIdAiReview.sensitive': 'সংবেদনশীল',
    'appApplicant.appApplicantIdDocumentExpiryForm.expiryDate': 'মেয়াদ শেষের তারিখ',
    'appApplicant.appApplicantIdDocumentRenameForm.documentName': 'ডকুমেন্টের নাম',
    'appApplicant.appApplicantIdDocumentSuggestionCard.cancel': 'বাতিল করুন',
    'appApplicant.appApplicantIdDocumentSuggestionCard.kindOfDocument': 'ডকুমেন্টের ধরন',
    'appApplicant.appApplicantIdDocumentTypeForm.forExampleMarriageCertificate': 'যেমন: বিবাহ সনদ',
    'appApplicant.appApplicantIdDocumentTypeForm.nameForAnOtherType': 'অন্য ধরনের জন্য একটি নাম',
    'appApplicant.appApplicantIdDocumentTypeForm.notSetYet': 'এখনও ঠিক করা হয়নি',
    'appApplicant.appApplicantIdDocumentTypeForm.save': 'সংরক্ষণ করুন',
    'appApplicant.appApplicantIdDocumentUploader.cameraPhoto': 'ক্যামেরার ছবি',
    'appApplicant.appApplicantIdDocumentUploader.chooseFiles': 'ডকুমেন্ট বেছে নিন',
    'appApplicant.appApplicantIdDocumentUploader.documentFiles': 'আপলোড করা ডকুমেন্ট',
    'appApplicant.appApplicantIdDocumentUploader.documentSaved': 'ডকুমেন্ট সংরক্ষণ করা হয়েছে',
    'appApplicant.appApplicantIdDocumentUploader.documentsSaved': 'ডকুমেন্ট সংরক্ষণ করা হয়েছে',
    'appApplicant.appApplicantIdDocumentUploader.dropFilesHere': 'ডকুমেন্ট এখানে ছেড়ে দিন',
    'appApplicant.appApplicantIdDocumentUploader.kindOfDocumentOptional': 'ডকুমেন্টের ধরন (ঐচ্ছিক)',
    'appApplicant.appApplicantIdDocumentUploader.notConfirmed': 'নিশ্চিত করা হয়নি।',
    'appApplicant.appApplicantIdDocumentUploader.removeThisNewCopy': 'এই নতুন কপি সরান',
    'appApplicant.appApplicantIdDocumentUploader.removeThisNewCopyName': 'এই নতুন কপি সরান: {name}',
    'appApplicant.appApplicantIdDocumentUploader.takeAPhoto': 'ছবি তুলুন',
    'appApplicant.appApplicantIdDocumentsAddPage.addDocuments': 'ডকুমেন্ট যোগ করুন',
    'appApplicant.appApplicantIdDocumentsAddPage.documentStorage': 'ডকুমেন্ট সংরক্ষণ',
    'appApplicant.appApplicantIdDocumentsAddPage.openMyDocuments': 'আমার ডকুমেন্ট খুলুন',
    'appApplicant.appApplicantIdDocumentsAddPage.takeAPhotoOrSayWhat':
      'ছবি তুলুন, অথবা বলুন এটি কী ধরনের ডকুমেন্ট',
    'appApplicant.appApplicantIdDocumentsAddPage.whatHappensNext': 'এরপর কী হবে',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleteDuplicate':
      'ডুপ্লিকেট মুছে ফেলবেন?',
    'appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.deleteDuplicate484f53':
      'ডুপ্লিকেট মুছে ফেলুন',
    'appApplicant.appApplicantIdDocumentsManageLifecycleTabs.removalRecords': 'অপসারণের রেকর্ড',
    'appApplicant.appApplicantIdDocumentsManageManageMenu.manage': 'ম্যানেজ করুন',
    'appApplicant.appApplicantIdDocumentsManageManageMenu.manageDocumentname':
      '{documentName} ম্যানেজ করুন',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.addTheNewerDocument':
      'নতুন ডকুমেন্টটি যোগ করুন',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.chooseTheNewerDocument':
      'নতুন ডকুমেন্টটি বেছে নিন',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.continue': 'চালিয়ে যান',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.documentReplaced':
      'ডকুমেন্ট প্রতিস্থাপিত হয়েছে',
    'appApplicant.appApplicantIdDocumentsManageReplaceReplaceAction.replaceWithANewerDocument':
      'নতুন ডকুমেন্ট দিয়ে প্রতিস্থাপন করুন',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.cancelRequest': 'অনুরোধ বাতিল করুন',
    'appApplicant.appApplicantIdDocumentsManageRequestCancelAction.removalRequested':
      'সরানোর অনুরোধ করা হয়েছে',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.askUsToRemoveThisFile':
      'এই ডকুমেন্টটি সরাতে আমাদের অনুরোধ করুন',
    'appApplicant.appApplicantIdDocumentsManageRequestRequestAction.whyShouldWeRemoveDocumentname':
      'আমরা কেন {documentName} সরাব?',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.deleteDocumentnameNow':
      '{documentName} এখনই মুছে ফেলবেন?',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.deleteFileNow':
      'ডকুমেন্টটি এখনই মুছে ফেলুন',
    'appApplicant.appApplicantIdDocumentsManageSelfDeleteSelfDeleteAction.typeDeleteToConfirm':
      'নিশ্চিত করতে DELETE লিখুন',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.addANewerCopyIfYou':
      'আপনার কাছে আরও নতুন কপি থাকলে সেটি যোগ করুন, অথবা এটি যেমন আছে তেমনই রাখুন।',
    'appApplicant.appApplicantIdDocumentsNeedsDecision.removeThisFileLabel':
      'এই ডকুমেন্টটি সরান: {label}',
    'appApplicant.appApplicantIdExpiryPage.aboutTheseDates': 'এই তারিখগুলো সম্পর্কে',
    'appApplicant.appApplicantIdExpiryPage.addDatesToMyCalendar': 'আমার ক্যালেন্ডারে তারিখ যোগ করুন',
    'appApplicant.appApplicantIdExpiryPage.confirmationDates': 'নিশ্চিতকরণের তারিখ',
    'appApplicant.appApplicantIdExpiryPage.confirmationsFromIssuers': 'ইস্যুকারীর কাছ থেকে নিশ্চিতকরণ',
    'appApplicant.appApplicantIdExpiryPage.deadlineClock': 'সময়সীমার ঘড়ি',
    'appApplicant.appApplicantIdExpiryPage.documentExpiry': 'ডকুমেন্টের মেয়াদ',
    'appApplicant.appApplicantIdExpiryPage.noConfirmationsYet': 'এখনো কোনো নিশ্চিতকরণ নেই',
    'appApplicant.appApplicantIdExpiryPage.noDateRulesYet': 'এখনো কোনো তারিখের নিয়ম নেই',
    'appApplicant.appApplicantIdExpiryPage.noDocumentsYet': 'এখনো কোনো ডকুমেন্ট নেই',
    'appApplicant.appApplicantIdExpiryPage.setExpiryDate': 'মেয়াদ শেষের তারিখ ঠিক করুন',
    'appApplicant.appApplicantIdExpiryPage.threeSeparateDatesWhenADocument':
      'তিনটি আলাদা তারিখ: ডকুমেন্টের মেয়াদ কখন শেষ হয়, কোনো রুট আরও নতুন ডকুমেন্ট চায় কি না, এবং ইস্যুকারীর নিশ্চিতকরণ কত দিন বৈধ থাকে। আমরা এগুলোকে কখনো একটি অবস্থায় মিলিয়ে ফেলি না।',
    'appApplicant.appApplicantIdExpiryPage.whenAnIssuerSuchAsA':
      'ব্যাংক বা নিয়োগকর্তার মতো কোনো ইস্যুকারী যখন কোনো ডকুমেন্ট নিশ্চিত করেন, তখন সেই নিশ্চিতকরণ এবং তা কত দিন বৈধ থাকে তা এখানে দেখা যায়।',
    'appApplicant.appApplicantIdHistoryHistoryLog.everyPart': 'প্রতিটি অংশ',
    'appApplicant.appApplicantIdHistoryHistoryLog.partOfTheProfile': 'প্রোফাইলের অংশ',
    'appApplicant.appApplicantIdHistoryHistoryLog.profileHistoryEntries': 'প্রোফাইল ইতিহাসের এন্ট্রি',
    'appApplicant.appApplicantIdHistoryHistoryLog.showThisPart': 'এই অংশ দেখান',
    'appApplicant.appApplicantIdHistoryPage.history': 'ইতিহাস',
    'appApplicant.appApplicantIdHistoryPage.nothingSavedToThisProfileYet':
      'এই প্রোফাইলে এখনো কিছু সংরক্ষণ করা হয়নি',
    'appApplicant.appApplicantIdImportImportPanel.addAFolder': 'একটি ফোল্ডার যোগ করুন',
    'appApplicant.appApplicantIdImportImportPanel.dropFilesOrAFolderHere':
      'ডকুমেন্ট বা ফোল্ডার এখানে ছেড়ে দিন',
    'appApplicant.appApplicantIdImportImportPanel.everyFileYouAddNowIs':
      'এখন থেকে আপনি যে ডকুমেন্ট যোগ করবেন তা এই ব্যক্তির অধীনে সংরক্ষণ হবে। দুটি ডকুমেন্টের মাঝখানে আপনি এটি বদলাতে পারেন।',
    'appApplicant.appApplicantIdImportImportPanel.filesToImport': 'আমদানির ডকুমেন্ট',
    'appApplicant.appApplicantIdImportImportPanel.folderToImport': 'আমদানির ফোল্ডার',
    'appApplicant.appApplicantIdImportImportPanel.foldersInsideItAreIncludedYou':
      'এর ভেতরের ফোল্ডারগুলোও অন্তর্ভুক্ত হবে। আগে প্রতিটি ডকুমেন্ট কী, তা বলতে হবে না। নিচে প্রতিটি ডকুমেন্টের নিজস্ব সারি থাকবে।',
    'appApplicant.appApplicantIdImportImportPanel.forgetEarlierImports': 'আগের আমদানি ভুলে যান',
    'appApplicant.appApplicantIdImportImportPanel.inFolder': '{folder}-এ',
    'appApplicant.appApplicantIdImportImportPanel.nameThisPerson': '{name} (এই ব্যক্তি)',
    'appApplicant.appApplicantIdImportImportPanel.notSureHelpMeDecide':
      'নিশ্চিত নই, ঠিক করতে সাহায্য করুন',
    'appApplicant.appApplicantIdImportImportPanel.pause': 'বিরতি দিন',
    'appApplicant.appApplicantIdImportImportPanel.whoAreTheseFilesFor': 'এই ডকুমেন্টগুলো কার জন্য?',
    'appApplicant.appApplicantIdImportImportPanel.yourFiles': 'আপনার ডকুমেন্ট',
    'appApplicant.appApplicantIdPage.aboutTheseTotals': 'এই মোট সংখ্যাগুলো সম্পর্কে',
    'appApplicant.appApplicantIdPage.activeCases': 'চলমান ভিসা ফাইল',
    'appApplicant.appApplicantIdPage.allCases': 'সব ভিসা ফাইল →',
    'appApplicant.appApplicantIdPage.checklistProgress': 'চেকলিস্টের অগ্রগতি',
    'appApplicant.appApplicantIdPage.closedAndCancelledCasesAreExcluded':
      'বন্ধ ও বাতিল ভিসা ফাইল বাদ দেওয়া হয়েছে।',
    'appApplicant.appApplicantIdPage.continueCase': 'ভিসা ফাইল চালিয়ে যান →',
    'appApplicant.appApplicantIdPage.continueProfile': 'প্রোফাইল চালিয়ে যান →',
    'appApplicant.appApplicantIdPage.continueWhereYouLeftOff':
      'যেখানে থামিয়েছিলেন সেখান থেকে চালিয়ে যান',
    'appApplicant.appApplicantIdPage.documentsInYourWallet': 'আপনার ওয়ালেটের ডকুমেন্ট',
    'appApplicant.appApplicantIdPage.documentsNeedingReview': 'পর্যালোচনা দরকার এমন ডকুমেন্ট',
    'appApplicant.appApplicantIdPage.essentialsAdded': 'প্রয়োজনীয় তথ্য যোগ করা হয়েছে',
    'appApplicant.appApplicantIdPage.essentialsAdded28ca58': 'প্রয়োজনীয় তথ্য যোগ করা হয়েছে',
    'appApplicant.appApplicantIdPage.evidenceRequestsWaitingForAReply':
      'উত্তরের অপেক্ষায় থাকা প্রমাণের অনুরোধ',
    'appApplicant.appApplicantIdPage.home': 'হোম',
    'appApplicant.appApplicantIdPage.inProgress': 'চলমান',
    'appApplicant.appApplicantIdPage.itemsNeedingAttention': 'যেসব আইটেমে মনোযোগ দরকার',
    'appApplicant.appApplicantIdPage.manageSharing': 'শেয়ারিং পরিচালনা করুন →',
    'appApplicant.appApplicantIdPage.needsYourAttention': 'আপনার মনোযোগ দরকার',
    'appApplicant.appApplicantIdPage.next': 'পরবর্তী',
    'appApplicant.appApplicantIdPage.noActiveCaseYet': 'এখনো কোনো চলমান ভিসা ফাইল নেই',
    'appApplicant.appApplicantIdPage.noRecordedActivityYet': 'এখনো কোনো কার্যকলাপ রেকর্ড হয়নি',
    'appApplicant.appApplicantIdPage.noUpcomingCaseDates': 'আসন্ন কোনো ভিসা ফাইলের তারিখ নেই',
    'appApplicant.appApplicantIdPage.nothingIsWaitingForYou': 'আপনার জন্য কিছু অপেক্ষায় নেই।',
    'appApplicant.appApplicantIdPage.profileChangesUploadsAndCaseUpdates':
      'প্রোফাইলের পরিবর্তন, আপলোড ও ভিসা ফাইলের আপডেট এখানে দেখা যাবে। এটি সাম্প্রতিক রেকর্ডের সারসংক্ষেপ, সম্পূর্ণ অডিট লগ নয়।',
    'appApplicant.appApplicantIdPage.profileHistory': 'প্রোফাইলের ইতিহাস →',
    'appApplicant.appApplicantIdPage.profileSharing': 'প্রোফাইল ও শেয়ারিং',
    'appApplicant.appApplicantIdPage.recentActivity': 'সাম্প্রতিক কার্যকলাপ',
    'appApplicant.appApplicantIdPage.requestsSuggestedDetailsAndFlaggedDocuments':
      'অনুরোধ, পরামর্শ হিসেবে পাওয়া তথ্য এবং চিহ্নিত ডকুমেন্ট।',
    'appApplicant.appApplicantIdPage.requiredItemsOnFile': 'আবশ্যক আইটেম সংরক্ষিত আছে',
    'appApplicant.appApplicantIdPage.setATargetDeadlineOrTravel':
      'কোনো ভিসা ফাইলে লক্ষ্যমাত্রার শেষ তারিখ বা ভ্রমণের তারিখ ঠিক করুন। অ্যাপয়েন্টমেন্ট আলাদা আলাদা ভিসা ফাইলের ক্যালেন্ডারেই থাকে।',
    'appApplicant.appApplicantIdPage.startACase': 'ভিসা ফাইল শুরু করুন',
    'appApplicant.appApplicantIdPage.stepsToGetReady': 'প্রস্তুত হওয়ার ধাপ',
    'appApplicant.appApplicantIdPage.threeStepsToGetReady': 'প্রস্তুত হওয়ার তিনটি ধাপ',
    'appApplicant.appApplicantIdPage.upcoming': 'আসন্ন',
    'appApplicant.appApplicantIdPage.upcomingDatesRecentActivityAndProfile':
      'আসন্ন তারিখ, সাম্প্রতিক কার্যকলাপ ও প্রোফাইলের অবস্থা',
    'appApplicant.appApplicantIdPage.updatedFormattimestampdate':
      'আপডেট করা হয়েছে {formatTimestampDate}',
    'appApplicant.appApplicantIdPage.visaCase': 'ভিসা ফাইল',
    'appApplicant.appApplicantIdProfileEditor.addLabel': '{label} যোগ করুন',
    'appApplicant.appApplicantIdProfileEditor.addTheDateThisBecameTrue':
      'যে তারিখ থেকে এটি সত্য হয়েছে তা যোগ করুন',
    'appApplicant.appApplicantIdProfileEditor.apply': 'প্রয়োগ করুন',
    'appApplicant.appApplicantIdProfileEditor.ended': 'শেষ হয়েছে',
    'appApplicant.appApplicantIdProfileEditor.enteredByTheTraveller': '✓ ভ্রমণকারী নিজে দিয়েছেন।',
    'appApplicant.appApplicantIdProfileEditor.essentialsFirst': 'আগে প্রয়োজনীয়গুলো',
    'appApplicant.appApplicantIdProfileEditor.everySectionWithEveryDetailYou':
      'প্রতিটি অংশ, আপনি যোগ করতে পারেন এমন সব তথ্যসহ, এগুলোও এর মধ্যে আছে।',
    'appApplicant.appApplicantIdProfileEditor.lastConfirmedFormatdate':
      'সর্বশেষ নিশ্চিত করা হয়েছে {formatDate}',
    'appApplicant.appApplicantIdProfileEditor.locked': 'লক করা',
    'appApplicant.appApplicantIdProfileEditor.needsReview': 'পর্যালোচনা দরকার',
    'appApplicant.appApplicantIdProfileEditor.noLongerCurrentLabel': 'আর বর্তমান নয়: {label}',
    'appApplicant.appApplicantIdProfileEditor.noSupportingDocumentSupplied':
      '✗ সমর্থনকারী কোনো ডকুমেন্ট দেওয়া হয়নি।',
    'appApplicant.appApplicantIdProfileEditor.noneRecordedYet': 'এখনও কিছু লেখা নেই।',
    'appApplicant.appApplicantIdProfileEditor.notOnTheListAddIt':
      'তালিকায় নেই? এখানে যোগ করুন। এটি এই অংশেই থাকবে এবং অন্য যেকোনো তথ্যের মতো সংরক্ষণ করা হবে।',
    'appApplicant.appApplicantIdProfileEditor.showAllSections': 'সব অংশ দেখান',
    'appApplicant.appApplicantIdProfileEditor.thisDoesNotApplyToMe': 'এটি আমার ক্ষেত্রে প্রযোজ্য নয়',
    'appApplicant.appApplicantIdProfilePage.aboutEssentials': 'মূল তথ্য সম্পর্কে',
    'appApplicant.appApplicantIdProfilePage.aboutSuggestions': 'পরামর্শ সম্পর্কে',
    'appApplicant.appApplicantIdProfilePage.aboutThisProfile': 'এই প্রোফাইল সম্পর্কে',
    'appApplicant.appApplicantIdProfilePage.addInformation': 'তথ্য যোগ করুন',
    'appApplicant.appApplicantIdProfilePage.allProfileHistory': 'প্রোফাইলের পুরো ইতিহাস →',
    'appApplicant.appApplicantIdProfilePage.confirmedByTheTraveller': 'ভ্রমণকারী নিশ্চিত করেছেন',
    'appApplicant.appApplicantIdProfilePage.essentialsAdded': 'প্রয়োজনীয়গুলো যোগ করা হয়েছে',
    'appApplicant.appApplicantIdProfilePage.fieldsBackedByADocument': 'ডকুমেন্টে ভিত্তি করা ঘরগুলো',
    'appApplicant.appApplicantIdProfilePage.fieldsThatDoNotMatch': 'যে ঘরগুলো মেলে না',
    'appApplicant.appApplicantIdProfilePage.latestChanges': 'সাম্প্রতিক পরিবর্তন',
    'appApplicant.appApplicantIdProfilePage.myProfile': 'আমার প্রোফাইল',
    'appApplicant.appApplicantIdProfilePage.noSavedChangesYet': 'এখনও কোনো সংরক্ষিত পরিবর্তন নেই',
    'appApplicant.appApplicantIdProfilePage.profileHealth': 'প্রোফাইলের অবস্থা',
    'appApplicant.appApplicantIdProfilePage.profileHealthAndLatestChanges':
      'প্রোফাইলের অবস্থা ও সাম্প্রতিক পরিবর্তন',
    'appApplicant.appApplicantIdProfilePage.record': 'রেকর্ড',
    'appApplicant.appApplicantIdProfilePage.reviewDocumentSuggestions':
      'ডকুমেন্টের পরামর্শ পর্যালোচনা করুন →',
    'appApplicant.appApplicantIdProfilePage.selectedTravellerAndProfileCompletion':
      'নির্বাচিত ভ্রমণকারী ও প্রোফাইলের সম্পূর্ণতা',
    'appApplicant.appApplicantIdProfilePage.yourSavedFieldVersionsWillAppear':
      'আপনার সংরক্ষিত ঘরের সংস্করণগুলো এখানে দেখা যাবে।',
    'appApplicant.appApplicantIdRecordBrowser.namesKindsCategoriesOrCases':
      'নাম, ধরন, বিভাগ বা ভিসা ফাইল',
    'appApplicant.appApplicantIdRecordBrowser.previous': 'পূর্ববর্তী',
    'appApplicant.appApplicantIdRecordBrowser.recordFilters': 'রেকর্ডের ফিল্টার',
    'appApplicant.appApplicantIdRecordBrowser.rowcountItemsMatch': '{rowCount}টি আইটেম মিলেছে।',
    'appApplicant.appApplicantIdRecordPage.addADocument': 'ডকুমেন্ট যোগ করুন',
    'appApplicant.appApplicantIdRecordPage.allRecords': 'সব রেকর্ড',
    'appApplicant.appApplicantIdRecordPage.everythingSavedForDisplaynameInOne':
      '{displayName}-এর জন্য সংরক্ষিত সবকিছু এক জায়গায়। একটি তথ্য বা ডকুমেন্ট খুঁজুন, কোন কপিটি বর্তমান তা দেখুন, তারপর ভিসা ফাইলে ব্যবহার করুন বা শেয়ার করুন।',
    'appApplicant.appApplicantIdRecordPage.updateYourProfile': 'আপনার প্রোফাইল আপডেট করুন',
    'appApplicant.appApplicantIdRecordSections.recordSections': 'রেকর্ডের অংশ',
    'appApplicant.appApplicantIdRemovalRecordsPage.records': 'রেকর্ড',
    'appApplicant.appApplicantIdRemovalRecordsPage.removalRecords': 'সরানোর রেকর্ড',
    'appApplicant.appApplicantIdReviewPage.1FileSaved': '১টি ডকুমেন্ট সংরক্ষণ করা হয়েছে',
    'appApplicant.appApplicantIdReviewPage.lengthFilesSaved': '{length}টি ডকুমেন্ট সংরক্ষণ করা হয়েছে',
    'appApplicant.appApplicantIdReviewPage.whatWeFound': 'আমরা যা পেয়েছি',
    'appApplicant.appApplicantIdReviewPage.yourFilesAreSaved': 'আপনার ডকুমেন্টগুলো সংরক্ষণ করা হয়েছে',
  },
});
