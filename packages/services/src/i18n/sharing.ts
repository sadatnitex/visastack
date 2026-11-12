/**
 * Sharing refusals (grants and invitations). `en` is the exact English each refusal has always
 * carried. `bn` holds only the wording whose automated checks passed in the translation register;
 * the rest shows English until a checked draft exists.
 */
export const sharingEn = {
  'sharing.ownerOnlyGrant': 'only the applicant owner can grant access',
  'sharing.consentRequired': 'Sharing consent is required before creating a grant',
  'sharing.oneRecipientType': 'a grant must name exactly one recipient type, not both',
  'sharing.recipientRequired': 'a grant must name a recipient',
  'sharing.actionRequired': 'a grant needs at least one action',
  'sharing.aiAfterGrant': 'AI tools are allowed on an agency grant itself, after it is made',
  'sharing.stepUpGrant': 'granting this level of access requires reauthentication',
  'sharing.purposeRequired': 'a purpose is required',
  'sharing.expiryInvalid': 'expiry must be a valid date',
  'sharing.expiryPast': 'expiry must be in the future',
  'sharing.recipientAccountMissing': 'recipient account not found',
  'sharing.recipientOrganizationMissing': 'recipient organization not found',
  'sharing.recipientOrganizationInactive':
    'recipient organization is not an active, verified organization',
  'sharing.caseNotApplicants': 'case does not belong to this applicant',
  'sharing.documentsNotApplicants': 'one or more documents do not belong to this applicant',
  'sharing.grantMissing': 'grant not found',
  'sharing.grantNotPending': 'grant is not pending acceptance',
  'sharing.acceptOnlyRecipient':
    'only the grant recipient, or an OWNER/ADMIN of the recipient organization, can accept it',
  'sharing.ownerOnlyChange': 'only the applicant owner can change this grant',
  'sharing.expiredCannotResume': 'this grant has already expired and cannot be resumed',
  'sharing.extendResumeFirst': 'resume this grant before extending it',
  'sharing.extendEnded': 'this grant has already ended',
  'sharing.chooseTraveller': 'Choose the traveller whose sharing this is.',
  'sharing.noEndDate': 'this grant has no end date to extend',
  'sharing.consentToKeep': 'Sharing consent is needed to keep sharing.',
  'sharing.confirmToKeep': 'Confirm it is you to keep sharing.',
  'sharing.notAuthorizedAccess': 'not authorized to view access for this applicant',
  'sharing.caseSharingUnavailable':
    'Sharing choices for new cases are not available yet. Please try again in a few minutes.',
  'sharing.ownerOnlyChooseCase': 'Only the owner of this record can choose who sees a case.',
  'sharing.chooseCaseAnswers': 'Choose the case these answers are for.',
  'sharing.caseAlreadyChosen':
    'Sharing for this case was already chosen. To share it with someone now, use Allow This Case on the Sharing page.',
  'sharing.personLostAccess': 'One of the people you chose no longer has access to all cases.',
  'sharing.chooseCaseToAllow': 'Choose the case to allow.',
  'sharing.sharingMissing': 'That sharing was not found.',
  'sharing.sharingEnded': 'This sharing has ended, so there is nothing to allow.',
  'sharing.confirmToAllow': 'Confirm it is you to allow this case.',
  'sharing.caseAlreadyShared': 'This case is already shared.',
  'sharing.grantNotActive': 'this grant is not active',
  'sharing.notAuthorizedWorkspace': 'not authorized to view this shared workspace',
  'sharing.applicantMissing': 'applicant not found',
  'sharing.ownerOnlyView': 'only the applicant owner can view this grant',
  'sharing.noCategoryScope': 'this grant has no category scope to expand',
  'sharing.nameDocument': 'name at least one document to include',
  'sharing.inviteEmailInvalid': 'Enter a valid recipient email.',
  'sharing.cannotShareSelf': 'You cannot share with yourself.',
  'sharing.inviteUnavailable': 'Invitation unavailable.',
  'sharing.inviteWrongEmail': 'Use the email address that received this invitation.',
  'sharing.inviteNotUsable':
    'This invitation has expired, was revoked or has already been accepted.',
  'sharing.inviteDocumentsGone': 'The documents in this invitation are no longer available.',
  'sharing.inviteConsent': 'Confirm account and sharing consent before accepting.',
  'sharing.inviteNotPending': 'This invitation is no longer pending.',
  'sharing.ownerOnlySee': 'Only the owner of this record can see this.',
  'sharing.ownerOnlyRevoke': 'Only the owner can revoke this invitation.',
  'sharing.inviteNotPendingManage':
    'Invitation is no longer pending. Manage accepted access in Sharing.',
  'sharing.expiryTooFar': 'expiry may be at most {days} days out',
  'sharing.recipientAlwaysSees':
    '{label} runs this case for you, so it always sees it. Tick it to continue.',
} as const;

export const sharingBn = {
  'sharing.consentRequired': 'অ্যাক্সেস দেওয়ার আগে শেয়ার করার সম্মতি আবশ্যক',
  'sharing.extendResumeFirst': 'এটি বাড়ানোর আগে এই অ্যাক্সেস আবার চালু করুন',
  'sharing.extendEnded': 'এই অ্যাক্সেস ইতিমধ্যে শেষ হয়ে গেছে',
  'sharing.consentToKeep': 'শেয়ার চালিয়ে যেতে শেয়ার করার সম্মতি দরকার।',
  'sharing.caseSharingUnavailable':
    'নতুন ভিসা ফাইলের জন্য শেয়ারিংয়ের পছন্দ এখনো পাওয়া যাচ্ছে না। অনুগ্রহ করে কয়েক মিনিট পরে আবার চেষ্টা করুন।',
  'sharing.cannotShareSelf': 'আপনি নিজের সঙ্গে শেয়ার করতে পারবেন না।',
  'sharing.inviteConsent': 'গ্রহণ করার আগে অ্যাকাউন্ট ও শেয়ার করার সম্মতি নিশ্চিত করুন।',
} as const;
