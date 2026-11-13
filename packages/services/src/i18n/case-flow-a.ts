/** Case-flow refusals (part A). English is the exact sentence the service always returned. */
export const caseFlowAEn = {
  'umpe_trip_companions.not_switched_on': 'Travelling with someone else is not switched on yet.',
  'umpe_trip_companions.trip_companions_max':
    'A trip can include up to {max} people travelling with you.',
  'checklist_wording.wording_max': 'Keep it to {max} characters or fewer.',
  'umpe_package_service.reason_max': 'Keep the reason to {max} characters or fewer.',
  'umpe_trip_companion_papers.too_many': 'You can show up to {max} papers.',
  'umpe_trip_service.trip_full': 'A trip holds up to {max} travellers.',
  'umpe_trip_service.authority_not_confirmed':
    'Confirm on their profile that you may act for this traveller before adding them to a trip.',
  'umpe_trip_service.guardian_not_confirmed':
    'Confirm on their profile that you are the parent or guardian of this child before adding them to a trip.',
  'applicants.applicants_may_only_be_created_by':
    'applicants may only be created by their owning account',
  'applicants.a_display_name_is_required': 'a display name is required',
  'applicants.core_processing_consent_is_required_before':
    'Core processing consent is required before creating records',
  'applicants.confirm_you_have_authority_to_create':
    'confirm you have authority to create a record for this person before continuing',
  'checklist_wording.you_cannot_change_this_list': 'You cannot change this list.',
  'case_flow.only_the_traveller_who_owns_this':
    'Only the traveller who owns this case can do this.',
  'case_flow.that_case_is_not_available': 'That case is not available.',
  'case_flow.that_item_is_not_on_this': 'That item is not on this checklist.',
  'checklist_wording.editing_your_list_is_not_switched':
    'Editing your list is not switched on yet. Try again later.',
  'checklist_wording.this_case_is_finished_so_its':
    'This case is finished, so its list cannot change.',
  'case_flow.this_case_has_no_checklist_yet': 'This case has no checklist yet.',
  'checklist_wording.this_list_has_as_many_changes':
    'This list has as many changes as it can hold.',
  'case_deletion.only_the_owner_of_this_case': 'Only the owner of this case can delete it.',
  'consistency.this_value_cannot_be_shown_right': 'This value cannot be shown right now.',
  'consistency.you_do_not_have_access_to': 'You do not have access to this history.',
  'consistency.that_version_is_not_available': 'That version is not available.',
  'evidence_submissions.evidence_request_not_found': 'evidence request not found',
  'evidence_submissions.document_not_found': 'document not found',
  'evidence_submissions.this_copy_is_no_longer_available':
    'this copy is no longer available to download',
  'evidence_submissions.confirm_it_is_you_to_download': 'confirm it is you to download this file',
  'missions.this_case_is_finished_so_it': 'This case is finished, so it can no longer change.',
  'missions.case_not_found': 'case not found',
  'missions.not_authorized_for_this_case': 'not authorized for this case',
  'missions.applicant_not_found': 'applicant not found',
  'missions.not_authorized_for_this_applicant': 'not authorized for this applicant',
  'missions.snapshot_not_found': 'snapshot not found',
  'missions.a_title_is_required': 'a title is required',
  'missions.core_processing_consent_is_required': 'Core processing consent is required',
  'missions.pack_version_not_found': 'pack version not found',
  'missions.only_a_published_pack_version_can': 'only a PUBLISHED pack version can be attached',
  'missions.case_has_no_attached_pack_version': 'case has no attached pack version',
  'missions.this_case_needs_a_live_applicant':
    'this case needs a live applicant acknowledgement before it can become submission-ready',
  'missions.only_the_owner_of_this_case': 'Only the owner of this case can see what it uses.',
  'missions.this_case_is_finished_so_the':
    'This case is finished, so the files and answers it uses can no longer change.',
  'missions.requirement_not_found_on_this_case':
    "requirement not found on this case's attached pack",
  'missions.a_field_requirement_is_satisfied_by':
    'a FIELD requirement is satisfied by exactly one factId',
  'missions.fact_not_found_for_this_case': 'fact not found for this case',
  'missions.this_fact_does_not_match_the': "this fact does not match the requirement's field",
  'missions.a_document_requirement_is_satisfied_by':
    'a DOCUMENT requirement is satisfied by exactly one documentId',
  'missions.document_not_found_for_this_case': 'document not found for this case',
  'missions.this_document_does_not_match_the':
    "this document does not match the requirement's document type",
  'missions.selection_not_found': 'selection not found',
  'missions.a_description_is_required': 'a description is required',
  'missions.task_not_found': 'task not found',
  'missions.a_timezone_is_required': 'a timezone is required',
  'missions.enter_a_time_zone_name_such': 'enter a time zone name, such as Asia/Dhaka',
  'missions.appointment_not_found': 'appointment not found',
  'missions.only_an_open_appointment_can_be': 'only an OPEN appointment can be decided',
  'missions.no_satisfied_requirements_to_ground_a':
    'no satisfied requirements to ground a letter in yet',
  'missions.only_the_owner_of_this_record':
    'Only the owner of this record can prepare a case again.',
  'missions.give_the_case_a_title': 'Give the case a title.',
  'missions.something_changed_since_you_opened_this':
    'Something changed since you opened this page. Check the list again.',
  'submissions.recording_a_submission_requires_reauthentication':
    'recording a submission requires reauthentication',
  'submissions.a_description_of_the_external_submission':
    'a description of the external submission report is required',
  'submissions.submission_date_time_cannot_be_in': 'submission date/time cannot be in the future',
  'submissions.a_case_must_be_submission_ready':
    'a case must be submission-ready before a submission can be recorded',
  'submissions.this_case_has_no_current_live':
    'this case has no current live acknowledgement to submit',
  'submissions.selected_evidence_was_deleted_and_must':
    'selected evidence was deleted and must be replaced before this case can be submitted',
  'submissions.selected_evidence_has_expired_and_must':
    'selected evidence has expired and must be replaced before this case can be submitted',
  'umpe_guest_agency.no_such_submission': 'no such submission',
  'umpe_guest_agency.this_file_is_not_available': 'this file is not available',
  'umpe_guest_agency.give_the_reason_for_the_hold':
    'Give the reason for the hold, in up to 500 characters.',
  'umpe_guest_collection.no_such_document_request': 'no such document request',
  'umpe_guest_collection.this_request_has_no_email_address':
    'This request has no email address for a code. Ask the agency.',
  'umpe_guest_collection.this_link_can_no_longer_be':
    'This link can no longer be opened without an account. Ask the agency for a new link.',
  'umpe_guest_collection.choose_how_long_the_agency_may':
    'Choose how long the agency may keep your files.',
  'umpe_guest_collection.enter_the_six_digits_from_the': 'Enter the six digits from the email.',
  'umpe_guest_collection.this_code_has_expired_or_was':
    'This code has expired or was replaced. Ask for a new code.',
  'umpe_guest_collection.that_code_is_not_right':
    'That code is not right. Check the newest email and try again ({left, plural, one {# try} other {# tries}} left).',
  'umpe_guest_collection.that_code_has_had_too_many':
    'That code has had too many tries. Ask for a new code.',
  'umpe_guest_uploads.choose_the_file_again': 'Choose the file again.',
  'umpe_guest_uploads.this_file_is_empty': 'This file is empty.',
  'umpe_guest_uploads.choose_an_item_from_the_list': 'Choose an item from the list.',
  'umpe_guest_uploads.tick_the_box_to_confirm_what':
    'Tick the box to confirm what you are sending.',
  'umpe_guest_uploads.this_checklist_cannot_be_used_right':
    'This checklist cannot be used right now. Ask the agency.',
  'umpe_guest_uploads.choose_how_long_the_agency_may':
    'Choose how long the agency may keep your files, then submit.',
  'umpe_guest_uploads.your_documents_were_just_sent_reload':
    'Your documents were just sent. Reload to see them.',
  'umpe_guest_uploads.wait_until_every_file_has_been':
    'Wait until every file has been checked, then submit.',
  'umpe_guest_uploads.place_at_least_one_file_under':
    'Place at least one file under an item, then submit.',
  'umpe_package_service.choosing_copies_is_not_available_yet':
    'Choosing copies is not available yet. Try again later.',
  'umpe_package_service.this_case_is_finished_so_its':
    'This case is finished, so its package cannot change.',
  'umpe_package_service.this_item_is_required_so_it':
    'This item is required, so it cannot be left out. You can leave it missing for now.',
  'umpe_package_service.say_in_a_few_words_why': 'Say in a few words why you are leaving this out.',
  'umpe_package_service.that_copy_is_not_available_for':
    'That copy is not available for this item.',
  'umpe_package_service.confirm_that_you_have_read_the':
    'Confirm that you have read the steps outside VisaStack.',
  'umpe_package_service.preparing_a_handoff_is_not_available':
    'Preparing a handoff is not available yet. Try again later.',
  'umpe_package_service.this_case_is_finished_so_it':
    'This case is finished, so it cannot be prepared again.',
  'umpe_package_service.this_package_is_already_prepared_for':
    'This package is already prepared for handoff.',
  'umpe_package_service.some_items_still_need_attention_before':
    'Some items still need attention before you can prepare the handoff.',
  'umpe_package_service.something_changed_while_preparing_the_handoff':
    'Something changed while preparing the handoff. Review the package and try again.',
  'umpe_package_start.only_the_owner_of_this_traveller':
    'Only the owner of this traveller can start a case.',
  'umpe_package_start.choose_where_you_are_going': 'Choose where you are going.',
  'umpe_package_start.choose_why_you_are_travelling': 'Choose why you are travelling.',
  'umpe_trip_companion_case.this_invitation_is_not_available': 'This invitation is not available.',
  'umpe_trip_companion_email.that_person_is_not_on_this': 'That person is not on this trip.',
  'umpe_trip_companion_papers.that_paper_is_not_available': 'That paper is not available.',
  'umpe_trip_companion_papers.choosing_papers_is_not_switched_on':
    'Choosing papers is not switched on yet.',
  'umpe_trip_companion_papers.choose_travel_bookings_first': 'Choose Travel Bookings first.',
  'umpe_trip_companion_papers.only_bookings_itineraries_invitations_and_accommodation':
    'Only bookings, itineraries, invitations and accommodation papers can be shown to the organiser.',
  'umpe_trip_companions.enter_a_name_of_up_to': 'Enter a name of up to 120 characters.',
  'umpe_trip_companions.enter_a_valid_email_address_or':
    'Enter a valid email address, or leave it empty.',
  'umpe_trip_companions.that_trip_is_not_available': 'That trip is not available.',
  'umpe_trip_companions.too_many_invitations_in_a_short':
    'Too many invitations in a short time. Please try again later.',
  'umpe_trip_companions.that_is_your_own_email_address':
    'That is your own email address. You are already on this trip.',
  'umpe_trip_companions.you_have_already_added_someone_with':
    'You have already added someone with that email to this trip.',
  'umpe_trip_companions.this_person_has_already_joined_the':
    'This person has already joined the trip.',
  'umpe_trip_companions.this_person_has_no_email_address':
    'This person has no email address to send an invitation to.',
  'umpe_trip_companions.too_many_tries_in_a_short':
    'Too many tries in a short time. Please try again later.',
  'umpe_trip_companions.choose_how_much_you_want_to': 'Choose how much you want to share.',
  'umpe_trip_companions.confirm_account_consent_before_joining_a':
    'Confirm account consent before joining a trip.',
  'umpe_trip_service.only_the_account_holder_who_manages':
    'Only the account holder who manages this traveller can do this.',
  'umpe_trip_service.choose_the_traveller_not_one_of':
    'Choose the traveller, not one of their cases.',
  'umpe_trip_service.group_trips_are_not_switched_on':
    'Group trips are not switched on yet. Start each case on its own for now.',
  'umpe_trip_service.the_trip_could_not_be_started': 'The trip could not be started. Try again.',
  'umpe_trip_service.choose_a_document_that_belongs_to':
    'Choose a document that belongs to this traveller.',
  'umpe_trip_service.add_this_traveller_to_the_trip': 'Add this traveller to the trip first.',
  'umpe_trip_service.try_again': 'Try again.',
  'umpe_trip_service.that_document_is_not_available': 'That document is not available.',
  'umpe_trip_service.only_travel_documents_such_as_bookings':
    'Only travel documents such as bookings, itineraries and invitations can be shared across a trip.',
  'umpe_trip_service.that_shared_document_is_not_available':
    'That shared document is not available.',
  'umpe_trip_service.this_document_already_belongs_to_this':
    'This document already belongs to this traveller.',
} as const;

export const caseFlowABn = {
  'applicants.core_processing_consent_is_required_before':
    'রেকর্ড তৈরি করার আগে মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক',
  'consistency.that_version_is_not_available': 'সেই সংস্করণটি পাওয়া যাচ্ছে না।',
  'missions.core_processing_consent_is_required': 'মূল প্রক্রিয়াকরণের সম্মতি আবশ্যক',
  'missions.pack_version_not_found': 'প্যাকের সংস্করণ পাওয়া যায়নি',
  'umpe_guest_collection.this_link_can_no_longer_be':
    'এই লিংকটি আর অ্যাকাউন্ট ছাড়া খোলা যায় না। এজেন্সির কাছে নতুন লিংক চান।',
  'umpe_guest_collection.this_code_has_expired_or_was':
    'এই কোডের মেয়াদ শেষ হয়ে গেছে অথবা এটি বদলে গেছে। নতুন কোড চান।',
  'umpe_trip_companion_case.this_invitation_is_not_available': 'এই আমন্ত্রণ পাওয়া যাচ্ছে না।',
  'umpe_trip_companions.choose_how_much_you_want_to': 'কতটা শেয়ার করতে চান তা বেছে নিন।',
  'umpe_trip_companions.confirm_account_consent_before_joining_a':
    'ভ্রমণে যোগ দেওয়ার আগে অ্যাকাউন্টের সম্মতি নিশ্চিত করুন।',
} as const;
