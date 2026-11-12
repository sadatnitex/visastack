import { catalogTranslator } from '@visastack/i18n';
import { describe, expect, it } from 'vitest';
import { keyedError } from '../errors';
import { GRANT_EXTEND_ENDED, GRANT_EXTEND_RESUME_FIRST } from '../sharing';
import { serviceMessages } from './messages';
import { sharingBn, sharingEn } from './sharing';

// The English each sharing refusal carried before it was keyed, kept here independently of the
// catalogue so a changed word fails this test.
const OLD_ENGLISH: ReadonlyArray<readonly [keyof typeof sharingEn, string]> = [
  ['sharing.ownerOnlyGrant', 'only the applicant owner can grant access'],
  ['sharing.consentRequired', 'Sharing consent is required before creating a grant'],
  ['sharing.oneRecipientType', 'a grant must name exactly one recipient type, not both'],
  ['sharing.recipientRequired', 'a grant must name a recipient'],
  ['sharing.actionRequired', 'a grant needs at least one action'],
  ['sharing.aiAfterGrant', 'AI tools are allowed on an agency grant itself, after it is made'],
  ['sharing.stepUpGrant', 'granting this level of access requires reauthentication'],
  ['sharing.purposeRequired', 'a purpose is required'],
  ['sharing.expiryInvalid', 'expiry must be a valid date'],
  ['sharing.expiryPast', 'expiry must be in the future'],
  ['sharing.recipientAccountMissing', 'recipient account not found'],
  ['sharing.recipientOrganizationMissing', 'recipient organization not found'],
  [
    'sharing.recipientOrganizationInactive',
    'recipient organization is not an active, verified organization',
  ],
  ['sharing.caseNotApplicants', 'case does not belong to this applicant'],
  ['sharing.documentsNotApplicants', 'one or more documents do not belong to this applicant'],
  ['sharing.grantMissing', 'grant not found'],
  ['sharing.grantNotPending', 'grant is not pending acceptance'],
  [
    'sharing.acceptOnlyRecipient',
    'only the grant recipient, or an OWNER/ADMIN of the recipient organization, can accept it',
  ],
  ['sharing.ownerOnlyChange', 'only the applicant owner can change this grant'],
  ['sharing.expiredCannotResume', 'this grant has already expired and cannot be resumed'],
  ['sharing.extendResumeFirst', 'resume this grant before extending it'],
  ['sharing.extendEnded', 'this grant has already ended'],
  ['sharing.chooseTraveller', 'Choose the traveller whose sharing this is.'],
  ['sharing.noEndDate', 'this grant has no end date to extend'],
  ['sharing.consentToKeep', 'Sharing consent is needed to keep sharing.'],
  ['sharing.confirmToKeep', 'Confirm it is you to keep sharing.'],
  ['sharing.notAuthorizedAccess', 'not authorized to view access for this applicant'],
  [
    'sharing.caseSharingUnavailable',
    'Sharing choices for new cases are not available yet. Please try again in a few minutes.',
  ],
  ['sharing.ownerOnlyChooseCase', 'Only the owner of this record can choose who sees a case.'],
  ['sharing.chooseCaseAnswers', 'Choose the case these answers are for.'],
  [
    'sharing.caseAlreadyChosen',
    'Sharing for this case was already chosen. To share it with someone now, use Allow This Case on the Sharing page.',
  ],
  ['sharing.personLostAccess', 'One of the people you chose no longer has access to all cases.'],
  ['sharing.chooseCaseToAllow', 'Choose the case to allow.'],
  ['sharing.sharingMissing', 'That sharing was not found.'],
  ['sharing.sharingEnded', 'This sharing has ended, so there is nothing to allow.'],
  ['sharing.confirmToAllow', 'Confirm it is you to allow this case.'],
  ['sharing.caseAlreadyShared', 'This case is already shared.'],
  ['sharing.grantNotActive', 'this grant is not active'],
  ['sharing.notAuthorizedWorkspace', 'not authorized to view this shared workspace'],
  ['sharing.applicantMissing', 'applicant not found'],
  ['sharing.ownerOnlyView', 'only the applicant owner can view this grant'],
  ['sharing.noCategoryScope', 'this grant has no category scope to expand'],
  ['sharing.nameDocument', 'name at least one document to include'],
  ['sharing.inviteEmailInvalid', 'Enter a valid recipient email.'],
  ['sharing.cannotShareSelf', 'You cannot share with yourself.'],
  ['sharing.inviteUnavailable', 'Invitation unavailable.'],
  ['sharing.inviteWrongEmail', 'Use the email address that received this invitation.'],
  [
    'sharing.inviteNotUsable',
    'This invitation has expired, was revoked or has already been accepted.',
  ],
  ['sharing.inviteDocumentsGone', 'The documents in this invitation are no longer available.'],
  ['sharing.inviteConsent', 'Confirm account and sharing consent before accepting.'],
  ['sharing.inviteNotPending', 'This invitation is no longer pending.'],
  ['sharing.ownerOnlySee', 'Only the owner of this record can see this.'],
  ['sharing.ownerOnlyRevoke', 'Only the owner can revoke this invitation.'],
  [
    'sharing.inviteNotPendingManage',
    'Invitation is no longer pending. Manage accepted access in Sharing.',
  ],
  ['sharing.expiryTooFar', 'expiry may be at most {days} days out'],
  [
    'sharing.recipientAlwaysSees',
    '{label} runs this case for you, so it always sees it. Tick it to continue.',
  ],
];

describe('sharing refusals keep their English', () => {
  it('every key has exactly its old English message', () => {
    expect(OLD_ENGLISH.length).toBe(Object.keys(sharingEn).length);
    for (const [key, english] of OLD_ENGLISH) {
      // The two worded with a value are checked with real values in the next test.
      if (english.includes('{')) continue;
      expect(keyedError('invalid', key).message).toBe(english);
      expect(keyedError('invalid', key).messageKey).toBe(key);
    }
  });

  it('words with a number or a name fill them in', () => {
    expect(keyedError('invalid', 'sharing.expiryTooFar', { days: 90 }).message).toBe(
      'expiry may be at most 90 days out',
    );
    expect(
      keyedError('invalid', 'sharing.recipientAlwaysSees', { label: 'Acme Visas' }).message,
    ).toBe('Acme Visas runs this case for you, so it always sees it. Tick it to continue.');
  });

  it('the extend wording the web compares against is the catalogue English', () => {
    expect(sharingEn['sharing.extendResumeFirst']).toBe(GRANT_EXTEND_RESUME_FIRST);
    expect(sharingEn['sharing.extendEnded']).toBe(GRANT_EXTEND_ENDED);
  });

  it('Bangla exists only for keys that have English, and renders under bn', () => {
    const t = catalogTranslator(serviceMessages as never, 'bn') as (
      key: string,
      p?: object,
    ) => string;
    const keys = Object.keys(sharingBn) as Array<keyof typeof sharingBn>;
    expect(keys.length).toBe(7);
    for (const key of keys) {
      expect(sharingEn).toHaveProperty(key);
      expect(t(key)).toBe(sharingBn[key]);
      expect(t(key)).not.toBe(sharingEn[key]);
    }
  });
});
