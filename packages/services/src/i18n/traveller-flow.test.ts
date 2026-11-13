import { describe, expect, it } from 'vitest';
import { keyedError } from '../errors';
import { REQUEST_QUESTION_MAX_LENGTH } from '../request-items';
import { serviceMessages } from './messages';
import { travellerFlowBn, travellerFlowEn } from './traveller-flow';

/** The sentence each refusal always returned, written out so a rewording cannot pass silently. */
const OLD_ENGLISH: ReadonlyArray<readonly [string, string]> = [
  ['profile.applicant_not_found', 'applicant not found'],
  [
    'profile.core_processing_consent_is_required',
    'Core processing consent is required to edit facts',
  ],
  ['profile.enter_a_real_date', 'enter a real date, as year, month and day'],
  [
    'profile_sections.this_section_is_always_open',
    'this section is always open and cannot be closed',
  ],
  ['request_items.only_the_owner_of_this_record', 'Only the owner of this record can do this.'],
  ['request_items.write_your_question_first', 'Write your question first.'],
  ['request_items.request_not_found', 'request not found'],
  ['request_items.this_request_cannot_take_a_question', 'This request cannot take a question yet.'],
  ['contributor_requests.request_not_found', 'request not found'],
  ['contributor_requests.already_used_or_revoked', 'this request has already been used or revoked'],
  ['contributor_requests.this_request_has_expired', 'this request has expired'],
  [
    'contributor_requests.sent_to_a_different_email',
    'this request was sent to a different email address',
  ],
  [
    'contributor_requests.not_in_a_completable_state',
    'contributor request not in a completable state',
  ],
  ['client_invitations.invitation_not_found', 'invitation not found'],
  [
    'client_invitations.already_used_or_revoked',
    'this invitation has already been used or revoked',
  ],
  ['client_invitations.this_invitation_has_expired', 'this invitation has expired'],
  ['invitations.invitation_not_found', 'invitation not found'],
  ['invitations.already_used_or_revoked', 'this invitation has already been used or revoked'],
  ['invitations.this_invitation_has_expired', 'this invitation has expired'],
  [
    'invitations.sent_to_a_different_email',
    'this invitation was sent to a different email address',
  ],
  ['invitations.no_longer_taking_new_members', 'this agency is no longer taking new members'],
  ['deletion.only_request_its_own_deletion', 'an account may only request its own deletion'],
  ['deletion.a_deletion_request_is_already_pending', 'a deletion request is already pending'],
  ['deletion.an_active_legal_hold_blocks_deletion', 'an active legal hold blocks deletion'],
  ['deletion.only_cancel_its_own_deletion', 'an account may only cancel its own deletion'],
  ['deletion.no_pending_deletion_request', 'no pending deletion request'],
  [
    'whatsapp_link.agree_to_receive_messages_first',
    'Agree to receive VisaStack messages on WhatsApp first.',
  ],
  ['whatsapp_link.whatsapp_is_not_available_yet', 'WhatsApp is not available yet.'],
  ['whatsapp_link.please_try_again', 'Please try again.'],
  ['workspace_search.choose_an_available_workspace', 'Choose an available workspace.'],
  ['workspace_search.use_between_2_and_80_characters', 'Use between 2 and 80 characters.'],
  [
    'workspace_search.this_agency_workspace_is_unavailable',
    'This agency workspace is unavailable.',
  ],
  [
    'workspace_search.this_traveller_workspace_is_unavailable',
    'This traveller workspace is unavailable.',
  ],
  [
    'request_items.you_have_asked_several_questions',
    'You have asked several questions about this item. Wait for the agency to reply in the case notes.',
  ],
];

describe('traveller-flow refusals keep their English', () => {
  it('every keyed refusal says exactly what it always said', () => {
    for (const [key, english] of OLD_ENGLISH) {
      expect([key, keyedError('invalid', key as never).message]).toEqual([key, english]);
    }
  });

  it('the question limit keeps its number as before', () => {
    expect(
      keyedError('invalid', 'request_items.keep_your_question_under', {
        max: REQUEST_QUESTION_MAX_LENGTH,
      }).message,
    ).toBe(
      `Keep your question under ${REQUEST_QUESTION_MAX_LENGTH} characters. You can add more in a second question.`,
    );
  });

  it('lists every key of the catalogue, and is in the services list', () => {
    expect(Object.keys(travellerFlowEn).sort()).toEqual(
      [...OLD_ENGLISH.map(([key]) => key), 'request_items.keep_your_question_under'].sort(),
    );
    for (const key of Object.keys(travellerFlowBn)) expect(travellerFlowEn).toHaveProperty(key);
    for (const key of Object.keys(travellerFlowEn)) expect(serviceMessages.en).toHaveProperty(key);
  });
});
