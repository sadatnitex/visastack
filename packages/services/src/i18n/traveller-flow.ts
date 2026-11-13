/**
 * Traveller-flow refusals (profile, sections, request questions, contributor and agency
 * invitations, account deletion, WhatsApp link, workspace search). `en` is the exact English each
 * refusal has always carried. `bn` holds only wording whose automated checks passed in the
 * translation register (filled by scripts/i18n/refill-services.mjs); the rest shows English.
 */
export const travellerFlowEn = {
  'profile.applicant_not_found': 'applicant not found',
  'profile.core_processing_consent_is_required':
    'Core processing consent is required to edit facts',
  'profile.enter_a_real_date': 'enter a real date, as year, month and day',
  'profile_sections.core_processing_consent_is_required':
    'Core processing consent is required to change a profile',
  'profile_sections.this_section_is_always_open':
    'this section is always open and cannot be closed',
  'request_items.only_the_owner_of_this_record': 'Only the owner of this record can do this.',
  'request_items.write_your_question_first': 'Write your question first.',
  'request_items.request_not_found': 'request not found',
  'request_items.this_request_cannot_take_a_question': 'This request cannot take a question yet.',
  'contributor_requests.request_not_found': 'request not found',
  'contributor_requests.already_used_or_revoked': 'this request has already been used or revoked',
  'contributor_requests.this_request_has_expired': 'this request has expired',
  'contributor_requests.sent_to_a_different_email':
    'this request was sent to a different email address',
  'contributor_requests.not_in_a_completable_state':
    'contributor request not in a completable state',
  'client_invitations.use_the_email_address_that_received':
    'Use the email address that received this invitation.',
  'client_invitations.this_invitation_can_no_longer_be_used':
    'This invitation can no longer be used. Ask the agency to send you a new one by email.',
  'client_invitations.invitation_not_found': 'invitation not found',
  'client_invitations.already_used_or_revoked': 'this invitation has already been used or revoked',
  'client_invitations.this_invitation_has_expired': 'this invitation has expired',
  'invitations.invitation_not_found': 'invitation not found',
  'invitations.already_used_or_revoked': 'this invitation has already been used or revoked',
  'invitations.this_invitation_has_expired': 'this invitation has expired',
  'invitations.sent_to_a_different_email': 'this invitation was sent to a different email address',
  'invitations.no_longer_taking_new_members': 'this agency is no longer taking new members',
  'deletion.only_request_its_own_deletion': 'an account may only request its own deletion',
  'deletion.a_deletion_request_is_already_pending': 'a deletion request is already pending',
  'deletion.an_active_legal_hold_blocks_deletion': 'an active legal hold blocks deletion',
  'deletion.only_cancel_its_own_deletion': 'an account may only cancel its own deletion',
  'deletion.no_pending_deletion_request': 'no pending deletion request',
  'whatsapp_link.agree_to_receive_messages_first':
    'Agree to receive VisaStack messages on WhatsApp first.',
  'whatsapp_link.whatsapp_is_not_available_yet': 'WhatsApp is not available yet.',
  'whatsapp_link.please_try_again': 'Please try again.',
  'workspace_search.choose_an_available_workspace': 'Choose an available workspace.',
  'workspace_search.use_between_2_and_80_characters': 'Use between 2 and 80 characters.',
  'workspace_search.this_agency_workspace_is_unavailable': 'This agency workspace is unavailable.',
  'workspace_search.this_traveller_workspace_is_unavailable':
    'This traveller workspace is unavailable.',
  'request_items.keep_your_question_under':
    'Keep your question under {max} characters. You can add more in a second question.',
  'request_items.you_have_asked_several_questions':
    'You have asked several questions about this item. Wait for the agency to reply in the case notes.',
} as const;

export const travellerFlowBn = {
  'profile.applicant_not_found': 'আবেদনকারী খুঁজে পাওয়া যায়নি',
  'profile.core_processing_consent_is_required': 'তথ্য সম্পাদনা করতে মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক',
  'profile_sections.core_processing_consent_is_required': 'প্রোফাইল বদলাতে মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক',
  'request_items.only_the_owner_of_this_record': 'শুধু এই রেকর্ডের মালিকই এটি করতে পারেন।',
  'request_items.request_not_found': 'অনুরোধটি খুঁজে পাওয়া যায়নি',
  'contributor_requests.request_not_found': 'অনুরোধটি খুঁজে পাওয়া যায়নি',
  'contributor_requests.this_request_has_expired': 'এই অনুরোধের মেয়াদ শেষ হয়ে গেছে',
  'client_invitations.use_the_email_address_that_received':
    'যে ইমেইল ঠিকানায় আপনি এই আমন্ত্রণটি পেয়েছেন, সেটি ব্যবহার করুন।',
  'client_invitations.this_invitation_can_no_longer_be_used':
    'এই আমন্ত্রণ আর ব্যবহার করা যাবে না। এজেন্সিকে ইমেইলে আপনাকে নতুন একটি পাঠাতে বলুন।',
  'client_invitations.invitation_not_found': 'আমন্ত্রণটি খুঁজে পাওয়া যায়নি',
  'client_invitations.already_used_or_revoked': 'এই আমন্ত্রণ আগেই ব্যবহার করা হয়েছে বা প্রত্যাহার করা হয়েছে',
  'client_invitations.this_invitation_has_expired': 'এই আমন্ত্রণের মেয়াদ শেষ হয়ে গেছে',
  'invitations.invitation_not_found': 'আমন্ত্রণটি খুঁজে পাওয়া যায়নি',
  'invitations.already_used_or_revoked': 'এই আমন্ত্রণ আগেই ব্যবহার করা হয়েছে বা প্রত্যাহার করা হয়েছে',
  'invitations.this_invitation_has_expired': 'এই আমন্ত্রণের মেয়াদ শেষ হয়ে গেছে',
  'deletion.an_active_legal_hold_blocks_deletion': 'চালু আইনি হোল্ড থাকায় মুছে ফেলা যাবে না',
} as const;
