/**
 * Document, profile photo, upload and naming refusals that a person can read on a screen. `en` is the
 * exact English each refusal has always carried. `bn` holds only wording whose automated checks
 * passed in the translation register; the rest shows English until a checked draft exists.
 * Safe copy refusals are not here: the safe copy screens word their own refusals from a code.
 */
export const documentsEn = {
  'documents.applicantNotFound': 'applicant not found',
  'documents.documentsMayOnlyBeRegisteredBy':
    'documents may only be registered by the owning account',
  'documents.aDocumentNameIsRequired': 'a document name is required',
  'documents.coreProcessingConsentIsRequired': 'Core processing consent is required',
  'documents.documentNotFound': 'document not found',
  'documents.versionsMayOnlyBeAddedBy': 'versions may only be added by the owning account',
  'documents.thisDocumentHasARetentionPurge':
    'this document has a retention purge in progress and cannot be modified until it completes',
  'documents.notAuthorizedToReviewThisDocument': 'not authorized to review this document',
  'documents.notAuthorizedToEditThisDocument': 'not authorized to edit this document',
  'documents.documentdateMustBeAValidYyyy':
    'documentDate must be a valid YYYY-MM-DD date, not in the future',
  'documents.chosenIsNotAKnownDocument':
    '"{chosen}" is not a known document type. Pick one from the list, or use "Other Document".',
  'documents.theNameOfTheDocumentMay': 'the name of the document may be at most 120 characters',
  'documents.onlyTheOwnerCanChangeWhat': 'only the owner can change what kind of document this is',
  'documents.notAuthorizedToListTheseDocuments': 'not authorized to list these documents',
  'documents.documentHasNoStoredVersion': 'document has no stored version',
  'documents.thisDocumentIsNotYetAvailable': 'this document is not yet available',
  'documents.storedObjectMissing': 'stored object missing',
  'documents.confirmItIsYouToDownload': 'confirm it is you to download this file',
  'documents.safeCopiesAreMadeOnlyThrough': 'safe copies are made only through the safe copy route',
  'photos.accessDenied': 'access denied',
  'photos.onlyTheOwnerOfThisProfile': 'Only the owner of this profile can see or change its photo.',
  'photos.chooseAJpegOrPngPhoto': 'Choose a JPEG or PNG photo.',
  'photos.chooseAPhotoSmallerThan5': 'Choose a photo smaller than 5 MB.',
  'photos.thisFileIsNotTheKind': 'This file is not the kind of photo it says it is.',
  'photos.thePhotoDidNotUploadCorrectly': 'The photo did not upload correctly. Please try again.',
  'photos.thisPhotoDidNotPassThe': 'This photo did not pass the safety check.',
  'photos.thisPhotoCouldNotBeRead': 'This photo could not be read. Try a JPEG or PNG photo.',
  'photos.thePhotoDidNotSaveCorrectly': 'The photo did not save correctly. Please try again.',
  'photos.tooManyPhotoChangesInA': 'Too many photo changes in a short time. Try later.',
  'photos.photosAreNotAvailableYetPlease': 'Photos are not available yet. Please try again later.',
  'photos.noPhoto': 'no photo',
  'naming.aProposedNameIsRequired': 'a proposed name is required',
  'naming.nameVersionNotFound': 'name version not found',
  'naming.thisNamingProposalHasAlreadyBeen': 'this naming proposal has already been decided',
  'naming.notAuthorizedToDecideThisDocument': 'not authorized to decide this document name',
  'naming.aFinalNameIsRequiredTo': 'a final name is required to accept a naming proposal',
  'naming.onlyTheOwnerCanRenameThis': 'only the owner can rename this document',
  'naming.enterANameForThisDocument': 'enter a name for this document',
  'uploads.platformStorageCapacityReachedNewUploads':
    'platform storage capacity reached; new uploads are temporarily paused',
  'uploads.notAuthorized': 'not authorized',
  'uploads.theFileSizeIsNotValid': 'the file size is not valid',
  'uploads.thisUploadIsNoLongerIn': 'this upload is no longer in progress',
  'suggestions.onlyTheOwnerCanDecideWhat': 'only the owner can decide what this document is',
  'suggestions.thereIsNoSuggestionToDecide': 'there is no suggestion to decide',
  'suggestions.chooseWhatKindOfDocumentThis': 'choose what kind of document this is',
  'suggestions.thisFileHasNotFinishedIts': 'this file has not finished its safety checks',
  'suggestions.suggestedNameNotFound': 'suggested name not found',
  'suggestions.thisSuggestionHasAlreadyBeenDecided': 'this suggestion has already been decided',
  'suggestions.suggestedKindNotFound': 'suggested kind not found',
  'readingState.onlyTheOwnerCanSeeHow': 'only the owner can see how a file was read',
} as const;

export const documentsBn = {
  'documents.coreProcessingConsentIsRequired': 'মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক',
  'documents.thisDocumentHasARetentionPurge':
    'এই ডকুমেন্টটি মেয়াদ শেষে মুছে ফেলার প্রক্রিয়ায় আছে, তাই তা শেষ না হওয়া পর্যন্ত এতে কোনো পরিবর্তন করা যাবে না',
  'documents.confirmItIsYouToDownload': 'এই ডকুমেন্ট ডাউনলোড করতে নিশ্চিত করুন যে এটি আপনিই',
} as const;
