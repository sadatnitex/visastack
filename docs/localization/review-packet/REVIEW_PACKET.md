# VisaStack localization review packet: 20 user journeys

Status: DRAFT FOR REVIEW. Nothing here is released text. The Bengali on the screenshots is a model draft swapped into exact-match text on real rendered screens; it has no human sign-off.

How to read a journey: each has phone screenshots in three forms, the automated checks that apply, the key strings with their draft Bengali, and an empty sign-off block for the human reviewer.

- **English**: the real screen as the product draws it today, against made-up data.
- **bn-BD draft**: exact-match strings replaced by the register draft. Strings that contain numbers, names or links are not swapped, so these screens are mixed. The swap rate is printed under each image set.
- **RTL probe**: the same English screen mirrored with a right-to-left direction. It tests layout only (mirroring, overflow, clipped text). It is not a translation and not an Arabic draft; no right-to-left language is enabled or justified yet.

Not covered by pictures: screens that need a one-time link or stored requests (journey J16), loading and offline states, server-side validation errors after a button press, emails, PDFs and downloads. Those are listed per journey as untested.

| Journey | Role | Screens shown | Source-only parts |
|---|---|---|---|
| J01 | visitor | 2 of 6 | none |
| J02 | visitor | 2 of 3 | none |
| J03 | visitor | 2 of 4 | none |
| J04 | traveller | 2 of 4 | none |
| J05 | traveller | 2 of 4 | none |
| J06 | traveller | 2 of 3 | none |
| J07 | traveller | 2 of 3 | none |
| J08 | traveller | 2 of 4 | none |
| J09 | traveller | 2 of 3 | none |
| J10 | traveller | 2 of 2 | none |
| J11 | traveller | 2 of 3 | none |
| J12 | invitee | 2 of 5 | none |
| J13 | agency | 2 of 4 | none |
| J14 | agency | 2 of 6 | none |
| J15 | traveller | 2 of 2 | none |
| J16 | guest | 0 of 0 | none |
| J17 | family_guardian | 2 of 4 | none |
| J18 | traveller | 2 of 3 | none |
| J19 | traveller | 2 of 4 | none |
| J20 | visitor | 2 of 4 | 1 screens not rendered |

## J01. Visitor reads the home page and the trust information

- Role: visitor
- States in this journey: populated, public, no sign-in
- Semantic checks to apply: G9 claim strength: no stronger promise than English; official-source wording on trust pages

### Screen: public__home

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J01-public_home-en.jpg) | ![](screens/J01-public_home-bn.jpg) | ![](screens/J01-public_home-rtl.jpg) |

Measured: bn draft swapped 7 of 161 text runs (4%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| Invite-Only Pilot |  | G5_share_lifecycle |  |
| One personal record. Separate cases. Explicit sharing. |  | G8_data_action |  |
| Ready for |  | G1_state_word | no draft |
| Sharing |  | G8_data_action |  |
| Current record · Version 2 |  | G6_copy_version |  |
| Newer copy requested |  | G6_copy_version |  |
| ◯ Sharing |  | G8_data_action |  |
| Previous Version Kept |  | G6_copy_version |  |
| Access Ends 30 November |  | G5_share_lifecycle |  |

### Screen: public__trust

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J01-public_trust-en.jpg) | ![](screens/J01-public_trust-bn.jpg) | ![](screens/J01-public_trust-rtl.jpg) |

Measured: bn draft swapped 3 of 54 text runs (6%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| Sharing Permissions |  | G8_data_action |  |
| Confirmed itinerary |  | G1_state_word | no draft |
| Original files stay protected |  | G8_data_action | no draft |
| Review, pause or end future access in your sharing page. |  | G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack Private Pilot |  |  |  |
| What Works Today |  |  |  |
| VisaStack |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J02. Visitor creates an account and confirms the email address

- Role: visitor
- States in this journey: form, validation, pending verification
- Semantic checks to apply: Verified applies to the email address only

### Screen: public__auth_sign-up

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J02-public_auth_sign-up-en.jpg) | ![](screens/J02-public_auth_sign-up-bn.jpg) | ![](screens/J02-public_auth_sign-up-rtl.jpg) |

Measured: bn draft swapped 3 of 51 text runs (6%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| Keep your details together. Reuse what you need, and choose what you share. |  | G8_data_action |  |
| Access is by invitation. |  | G5_share_lifecycle |  |
| Your Name (Optional) |  | G3_requirement_level |  |
| This acknowledgement does not enable marketing, AI processing or sharing with an agency. |  | G8_data_action |  |
| We will email you a link to confirm your address before you can sign in. |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack Private Pilot |  |  |  |
| What Works Today |  |  |  |

### Screen: public__auth_verify-email

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J02-public_auth_verify-email-en.jpg) | ![](screens/J02-public_auth_verify-email-bn.jpg) | ![](screens/J02-public_auth_verify-email-rtl.jpg) |

Measured: bn draft swapped 3 of 38 text runs (8%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| Keep your details together. Reuse what you need, and choose what you share. |  | G8_data_action |  |
| Send the Link Again |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack Private Pilot |  |  |  |
| What Works Today |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J03. Forgotten password and sign-in recovery

- Role: visitor
- States in this journey: form, sent, expired link, re-authentication
- Semantic checks to apply: expired link wording; Sent is not Received

### Screen: public__auth_forgot-password

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J03-public_auth_forgot-password-en.jpg) | ![](screens/J03-public_auth_forgot-password-bn.jpg) | ![](screens/J03-public_auth_forgot-password-rtl.jpg) |

Measured: bn draft swapped 3 of 34 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| Keep your details together. Reuse what you need, and choose what you share. |  | G8_data_action |  |
| Send Me a Link |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack Private Pilot |  |  |  |
| What Works Today |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |

### Screen: public__auth_reset-password

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J03-public_auth_reset-password-en.jpg) | ![](screens/J03-public_auth_reset-password-bn.jpg) | ![](screens/J03-public_auth_reset-password-rtl.jpg) |

Measured: bn draft swapped 3 of 33 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| Keep your details together. Reuse what you need, and choose what you share. |  | G8_data_action |  |
| That link has expired or is not valid. Ask for a new one. |  | G5_share_lifecycle |  |
| Send Me a New Link |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack Private Pilot |  |  |  |
| What Works Today |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J04. First day: nothing yet, and consent not yet given

- Role: traveller
- States in this journey: empty, consent required
- Semantic checks to apply: consent wording needs qualified legal review; empty-state tone

### Screen: imran__app__home___no-consent-yet

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J04-imran_app_home__no-consent-yet-en.jpg) | ![](screens/J04-imran_app_home__no-consent-yet-bn.jpg) | ![](screens/J04-imran_app_home__no-consent-yet-rtl.jpg) |

Measured: bn draft swapped 5 of 75 text runs (7%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |
| How It Works |  |  |  |
| Workspace |  |  |  |

### Screen: imran__app_applicants__no-consent-yet

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J04-imran_app_applicants_no-consent-yet-en.jpg) | ![](screens/J04-imran_app_applicants_no-consent-yet-bn.jpg) | ![](screens/J04-imran_app_applicants_no-consent-yet-rtl.jpg) |

Measured: bn draft swapped 7 of 81 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |
| How It Works |  |  |  |
| Workspace |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J05. Traveller home and profile review

- Role: traveller
- States in this journey: populated, saved, long name, Bengali name
- Semantic checks to apply: Saved is not Submitted; bidi names and numbers

### Screen: rahim__app__home_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J05-rahim_app_home_-en.jpg) | ![](screens/J05-rahim_app_home_-bn.jpg) | ![](screens/J05-rahim_app_home_-rtl.jpg) |

Measured: bn draft swapped 40 of 278 text runs (14%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 5, bn 5, RTL 5.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Sent Back for a Fix |  | G1_state_word |  |
| The agency looked at what you sent and asked for a new one. |  | G1_state_word |  |
| Sharing Invitations Waiting for Your Answer |  | G8_data_action |  |
| Someone wants to share their information with you. Nothing is shared until you accept. |  | G5_share_lifecycle, G8_data_action |  |
| Pick a checklist to see what is ready |  | G1_state_word |  |
| Sends scan pictures, not just text, to an AI. |  | G2_safety_check |  |
| Let Me Share with Others |  | G8_data_action |  |

### Screen: rahim__app_applicant__id_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J05-rahim_app_applicant_id_-en.jpg) | ![](screens/J05-rahim_app_applicant_id_-bn.jpg) | ![](screens/J05-rahim_app_applicant_id_-rtl.jpg) |

Measured: bn draft swapped 15 of 200 text runs (8%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Everything: upcoming dates, recent activity, profile and sharing. |  | G8_data_action |  |
| Pick a checklist to see what is ready |  | G1_state_word |  |
| Manage Sharing → |  | G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J06. Traveller uploads and manages documents

- Role: traveller
- States in this journey: populated, empty, format checked, held for safety
- Semantic checks to apply: Format checked is not virus scanned; Held for safety is not deleted

### Screen: rahim__app_applicant__id__documents

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J06-rahim_app_applicant_id_documents-en.jpg) | ![](screens/J06-rahim_app_applicant_id_documents-bn.jpg) | ![](screens/J06-rahim_app_applicant_id_documents-rtl.jpg) |

Measured: bn draft swapped 26 of 428 text runs (6%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 18, bn 18, RTL 18.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Ready to Use |  | G1_state_word |  |
| Held for Safety |  | G2_safety_check |  |
| Format Checked |  | G2_safety_check |  |
| Reviewed and Approved |  | G1_state_word |  |
| Safe Copy: Not Prepared Yet |  | G8_data_action, G9_claim_strength |  |
| File type checked. Not scanned for viruses. |  | G2_safety_check |  |
| Safe Copy |  | G8_data_action, G9_claim_strength |  |

### Screen: rahim__app_applicant__id__documents_add

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J06-rahim_app_applicant_id_documents_add-en.jpg) | ![](screens/J06-rahim_app_applicant_id_documents_add-bn.jpg) | ![](screens/J06-rahim_app_applicant_id_documents_add-rtl.jpg) |

Measured: bn draft swapped 11 of 366 text runs (3%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| the text of a document is sent to an AI service to suggest values. You approve each one. |  | G1_state_word | no draft |
| the picture of a scan is sent to an AI service to read it. This shares more than text alone. |  | G1_state_word, G2_safety_check | no draft |
| Every file you add now is saved under this person. You can change this between files. |  | G1_state_word |  |
| Kind of Document (Optional) |  | G3_requirement_level |  |
| Residence Permit |  | G7_country_role |  |
| Temporary Residence Permit |  | G7_country_role |  |
| Permanent Residence |  | G7_country_role, G8_data_action |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J07. A person approves or rejects AI suggestions from a document

- Role: traveller
- States in this journey: awaiting review, approved, rejected
- Semantic checks to apply: Approved is a person's approval of a suggestion, not a visa decision; AI never changes the profile alone

### Screen: rahim__app_applicant__id__review

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J07-rahim_app_applicant_id_review-en.jpg) | ![](screens/J07-rahim_app_applicant_id_review-bn.jpg) | ![](screens/J07-rahim_app_applicant_id_review-rtl.jpg) |

Measured: bn draft swapped 7 of 136 text runs (5%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Details we read from your documents. Nothing is added to your profile until you accept it. |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |

### Screen: rahim__app_applicant__id__evidence

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J07-rahim_app_applicant_id_evidence-en.jpg) | ![](screens/J07-rahim_app_applicant_id_evidence-bn.jpg) | ![](screens/J07-rahim_app_applicant_id_evidence-rtl.jpg) |

Measured: bn draft swapped 14 of 239 text runs (6%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 8, bn 8, RTL 8.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| An agency is asking you for this. It is not a government rule. |  | G4_who_is_asking |  |
| Browse: requests being checked or finished. |  | G2_safety_check |  |
| Reviewed |  | G1_state_word |  |
| Sent |  | G1_state_word |  |
| The agency can download this exact copy while it has access. |  | G6_copy_version |  |
| Sent Back for a Fix |  | G1_state_word |  |
| Some earlier sends have no time on record. |  | G6_copy_version |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J08. Start a case and read readiness with unknown requirements

- Role: traveller
- States in this journey: ready, needs more, manual only
- Semantic checks to apply: Mandatory vs optional vs unknown; Ready is not Submitted

### Screen: rahim__app_mission_start

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J08-rahim_app_mission_start-en.jpg) | ![](screens/J08-rahim_app_mission_start-bn.jpg) | ![](screens/J08-rahim_app_mission_start-rtl.jpg) |

Measured: bn draft swapped 4 of 111 text runs (4%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |
| How It Works |  |  |  |
| Workspace |  |  |  |

### Screen: rahim__app_mission__id_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J08-rahim_app_mission_id_-en.jpg) | ![](screens/J08-rahim_app_mission_id_-bn.jpg) | ![](screens/J08-rahim_app_mission_id_-rtl.jpg) |

Measured: bn draft swapped 64 of 681 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 4, bn 4, RTL 4.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| You have not confirmed this case yet |  | G1_state_word |  |
| Some required items are missing, out of date or do not match. |  | G3_requirement_level |  |
| Not Applicable |  | G3_requirement_level |  |
| Optional Not Provided |  | G3_requirement_level |  |
| Readiness is completeness only - never an approval likelihood. |  | G9_claim_strength |  |
| Ready for Review |  | G1_state_word |  |
| Ready to Export |  | G1_state_word, G8_data_action |  |
| Submission Ready |  | G1_state_word |  |
| Submitted |  | G1_state_word |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J09. Country guide: what each country asks for

- Role: traveller
- States in this journey: populated, unknown rules
- Semantic checks to apply: no invented official requirement; nationality vs residence vs destination vs place of application

### Screen: rahim__app_countries__list_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J09-rahim_app_countries_list_-en.jpg) | ![](screens/J09-rahim_app_countries_list_-bn.jpg) | ![](screens/J09-rahim_app_countries_list_-rtl.jpg) |

Measured: bn draft swapped 8 of 153 text runs (5%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |

### Screen: rahim__app_countries__iso2_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J09-rahim_app_countries_iso2_-en.jpg) | ![](screens/J09-rahim_app_countries_iso2_-bn.jpg) | ![](screens/J09-rahim_app_countries_iso2_-rtl.jpg) |

Measured: bn draft swapped 9 of 134 text runs (7%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| The Short Version |  | G6_copy_version |  |
| Through a visa application centre |  | G4_who_is_asking |  |
| Official Page |  | G9_claim_strength |  |
| This list may not be complete. Check the official page for everything you need to submit. |  | G9_claim_strength |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J10. Share a record with an agency and choose what they can see

- Role: traveller
- States in this journey: pending acceptance, active, scope
- Semantic checks to apply: Link opened is not grant accepted; scope wording

### Screen: rahim__app_applicant__id__sharing

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J10-rahim_app_applicant_id_sharing-en.jpg) | ![](screens/J10-rahim_app_applicant_id_sharing-bn.jpg) | ![](screens/J10-rahim_app_applicant_id_sharing-rtl.jpg) |

Measured: bn draft swapped 24 of 241 text runs (10%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| New Sharing Request |  | G8_data_action |  |
| About Sharing |  | G8_data_action |  |
| Pausing or revoking stops access now; copies already downloaded cannot be erased. |  | G5_share_lifecycle |  |
| What actually happened to your data, not just what a grant permits. |  | G4_who_is_asking |  |
| Back to Sharing |  | G8_data_action |  |
| Let This Agency Use AI Tools on What I Share | আমি যা শেয়ার করি, তাতে এই এজেন্সিকে এআই টুল ব্যবহার করতে দিন | G8_data_action | PASS |
| Grant Access |  | G4_who_is_asking |  |

### Screen: rahim__app_applicant__id__outputs

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J10-rahim_app_applicant_id_outputs-en.jpg) | ![](screens/J10-rahim_app_applicant_id_outputs-bn.jpg) | ![](screens/J10-rahim_app_applicant_id_outputs-rtl.jpg) |

Measured: bn draft swapped 18 of 264 text runs (7%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 7, bn 7, RTL 7.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Confirmed Information Sheet |  | G1_state_word |  |
| The details you have confirmed, laid out to copy into a form. |  | G1_state_word |  |
| Details that only some purposes need: study, work, business, family, official. |  | G9_claim_strength |  |
| As Standard, plus suggestions that are not confirmed yet, labelled as such. |  | G1_state_word |  |
| Destination |  | G7_country_role |  |
| Required Items Ready |  | G1_state_word, G3_requirement_level |  |
| Completeness only. It says nothing about whether an application will be accepted |  | G1_state_word, G5_share_lifecycle |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J11. Revoke access and understand the copy already kept

- Role: traveller
- States in this journey: revoked, expired, history
- Semantic checks to apply: Revoked does not claim a downloaded copy was taken back

### Screen: rahim__app_applicant__id__sharing

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J11-rahim_app_applicant_id_sharing-en.jpg) | ![](screens/J11-rahim_app_applicant_id_sharing-bn.jpg) | ![](screens/J11-rahim_app_applicant_id_sharing-rtl.jpg) |

Measured: bn draft swapped 24 of 241 text runs (10%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| New Sharing Request |  | G8_data_action |  |
| About Sharing |  | G8_data_action |  |
| Pausing or revoking stops access now; copies already downloaded cannot be erased. |  | G5_share_lifecycle |  |
| What actually happened to your data, not just what a grant permits. |  | G4_who_is_asking |  |
| Back to Sharing |  | G8_data_action |  |
| Let This Agency Use AI Tools on What I Share | আমি যা শেয়ার করি, তাতে এই এজেন্সিকে এআই টুল ব্যবহার করতে দিন | G8_data_action | PASS |
| Grant Access |  | G4_who_is_asking |  |

### Screen: rahim__app_shared__list_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J11-rahim_app_shared_list_-en.jpg) | ![](screens/J11-rahim_app_shared_list_-bn.jpg) | ![](screens/J11-rahim_app_shared_list_-rtl.jpg) |

Measured: bn draft swapped 9 of 106 text runs (8%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Someone granted you access to their records. Access only begins once you accept. |  | G5_share_lifecycle |  |
| Accept Access |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J12. Someone receives an invitation or a shared record

- Role: invitee
- States in this journey: awaiting acceptance, accepted
- Semantic checks to apply: Accepted is not Approved

### Screen: rahim__app_shared__list_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J12-rahim_app_shared_list_-en.jpg) | ![](screens/J12-rahim_app_shared_list_-bn.jpg) | ![](screens/J12-rahim_app_shared_list_-rtl.jpg) |

Measured: bn draft swapped 9 of 106 text runs (8%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Someone granted you access to their records. Access only begins once you accept. |  | G5_share_lifecycle |  |
| Accept Access |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |

### Screen: rahim__app_shared__grantId_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J12-rahim_app_shared_grantId_-en.jpg) | ![](screens/J12-rahim_app_shared_grantId_-bn.jpg) | ![](screens/J12-rahim_app_shared_grantId_-rtl.jpg) |

Measured: bn draft swapped 7 of 105 text runs (7%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J13. New agency sets up the team and invites clients

- Role: agency
- States in this journey: empty, first run
- Semantic checks to apply: agency request vs grant vs government application

### Screen: agencyNew__app_agency__new-agency

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J13-agencyNew_app_agency_new-agency-en.jpg) | ![](screens/J13-agencyNew_app_agency_new-agency-bn.jpg) | ![](screens/J13-agencyNew_app_agency_new-agency-rtl.jpg) |

Measured: bn draft swapped 17 of 85 text runs (20%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |
| How It Works |  |  |  |
| Workspace |  |  |  |

### Screen: agencyNew__app_agency__orgId___new-agency

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J13-agencyNew_app_agency_orgId__new-agency-en.jpg) | ![](screens/J13-agencyNew_app_agency_orgId__new-agency-bn.jpg) | ![](screens/J13-agencyNew_app_agency_orgId__new-agency-rtl.jpg) |

Measured: bn draft swapped 89 of 170 text runs (52%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 4, bn 4, RTL 4.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Invite a Client | ক্লায়েন্টকে আমন্ত্রণ জানান | G5_share_lifecycle | PASS |
| Submission Ready |  | G1_state_word |  |
| Submitted |  | G1_state_word |  |
| Ready for Review |  | G1_state_word |  |
| Ready to Export |  | G1_state_word, G8_data_action |  |
| Destination |  | G7_country_role |  |
| No cases are reachable yet - a traveller must grant this organization access to a specific case. | পৌঁছানো যায় এমন কোনো কেস এখনো নেই - কোনো ভ্রমণকারীকে নির্দিষ্ট একটি কেসে এই প্রতিষ্ঠানকে অ্যাক্সেস দিতে হবে। | G4_who_is_asking | PASS |
| Once a client accepts, their cases appear here with how many checklist items are ready. | ক্লায়েন্ট গ্রহণ করলে তাঁদের কেস এখানে দেখা যাবে, সঙ্গে চেকলিস্টের কয়টি আইটেম প্রস্তুত তা-ও থাকবে। | G1_state_word | PASS |
| About This Version |  | G6_copy_version |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J14. Agency works its cases and reviews evidence

- Role: agency
- States in this journey: populated, owner vs member
- Semantic checks to apply: Reviewed is not Approved or Verified

### Screen: agencyOwner__app_agency__orgId_

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J14-agencyOwner_app_agency_orgId_-en.jpg) | ![](screens/J14-agencyOwner_app_agency_orgId_-bn.jpg) | ![](screens/J14-agencyOwner_app_agency_orgId_-rtl.jpg) |

Measured: bn draft swapped 173 of 406 text runs (43%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 4, bn 4, RTL 4.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Invite a Client | ক্লায়েন্টকে আমন্ত্রণ জানান | G5_share_lifecycle | PASS |
| Submission Ready |  | G1_state_word |  |
| Submitted |  | G1_state_word |  |
| Ready for Review |  | G1_state_word |  |
| Ready to Export |  | G1_state_word, G8_data_action |  |
| Destination |  | G7_country_role |  |
| Traveller Confirmed | ভ্রমণকারী নিশ্চিত করেছেন | G1_state_word | PASS |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |

### Screen: agencyOwner__app_agency__orgId__cases

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J14-agencyOwner_app_agency_orgId_cases-en.jpg) | ![](screens/J14-agencyOwner_app_agency_orgId_cases-bn.jpg) | ![](screens/J14-agencyOwner_app_agency_orgId_cases-rtl.jpg) |

Measured: bn draft swapped 44 of 205 text runs (21%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Assign a team member and leave case notes on any case this organization has a grant for. | যে কেসে এই প্রতিষ্ঠানের অ্যাক্সেস-অনুমতি আছে, সেখানে টিমের একজন সদস্যকে দায়িত্ব দিন এবং কেসের নোট রাখুন। | G4_who_is_asking | PASS |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |
| How It Works |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J15. Exact-copy receipt: what was sent, frozen at that moment

- Role: traveller
- States in this journey: populated
- Semantic checks to apply: Current copy vs earlier document vs exact copy; no Version 2 wording

### Screen: rahim__app_mission__id__snapshots

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J15-rahim_app_mission_id_snapshots-en.jpg) | ![](screens/J15-rahim_app_mission_id_snapshots-bn.jpg) | ![](screens/J15-rahim_app_mission_id_snapshots-rtl.jpg) |

Measured: bn draft swapped 5 of 87 text runs (6%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |
| How It Works |  |  |  |
| Workspace |  |  |  |

### Screen: rahim__app_applicant__id__outputs

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J15-rahim_app_applicant_id_outputs-en.jpg) | ![](screens/J15-rahim_app_applicant_id_outputs-bn.jpg) | ![](screens/J15-rahim_app_applicant_id_outputs-rtl.jpg) |

Measured: bn draft swapped 18 of 264 text runs (7%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 7, bn 7, RTL 7.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Confirmed Information Sheet |  | G1_state_word |  |
| The details you have confirmed, laid out to copy into a form. |  | G1_state_word |  |
| Details that only some purposes need: study, work, business, family, official. |  | G9_claim_strength |  |
| As Standard, plus suggestions that are not confirmed yet, labelled as such. |  | G1_state_word |  |
| Destination |  | G7_country_role |  |
| Required Items Ready |  | G1_state_word, G3_requirement_level |  |
| Completeness only. It says nothing about whether an application will be accepted |  | G1_state_word, G5_share_lifecycle |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J16. Guest request: an agency asks a person for documents; the guest uploads without an account

- Role: guest
- States in this journey: link opened, identity proof, upload, done, expired
- Semantic checks to apply: Link opened is not access granted; guest has no wallet
- Note: Not rendered in the preview world: these screens need a one-time link and stored requests. Source rows only.
- No rendered screen is available for this journey. The strings below come from source files only.

| Source | English | bn-BD draft | Check |
|---|---|---|---|
| collection/actions.ts:47 | This request is not available. Reload the page and try again. |  |  |
| collection/actions.ts:90 | Choose a destination. |  |  |
| collection/actions.ts:95 | Choose a purpose, or Not Sure Yet. |  |  |
| collection/actions.ts:101 | Enter a valid due date. |  |  |
| collection/actions.ts:176 | Checklist updated. |  |  |
| collection/actions.ts:190 | Choose a checklist. |  |  |
| collection/actions.ts:202 | Official checklist applied. |  |  |
| collection/actions.ts:202 | Now your agency checklist. |  |  |
| collection/actions.ts:221 | Revision {revisionNo} issued. Copy the link now: it is shown only once. |  |  |
| collection/actions.ts:241 | New link ready. Copy it now: it is shown only once. |  |  |
| collection/actions.ts:250 | Email accepted for delivery. That does not prove it reached the inbox. |  |  |
| collection/actions.ts:251 | Email queued. It will be retried if the first try did not go through. |  |  |
| collection/actions.ts:252 | The email could not be sent. Copy a link and share it yourself instead. |  |  |
| collection/actions.ts:264 | Enter an email address. |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J17. Family member or guardian manages a minor or spouse

- Role: family_guardian
- States in this journey: populated, empty, long and Bengali names
- Semantic checks to apply: gender-neutral wording; relationship labels

### Screen: rahim__app_applicants

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J17-rahim_app_applicants-en.jpg) | ![](screens/J17-rahim_app_applicants-bn.jpg) | ![](screens/J17-rahim_app_applicants-rtl.jpg) |

Measured: bn draft swapped 7 of 116 text runs (6%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 2, bn 2, RTL 2.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |

### Screen: rahim__app_applicant__id__documents__spouse

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J17-rahim_app_applicant_id_documents_spouse-en.jpg) | ![](screens/J17-rahim_app_applicant_id_documents_spouse-bn.jpg) | ![](screens/J17-rahim_app_applicant_id_documents_spouse-rtl.jpg) |

Measured: bn draft swapped 17 of 383 text runs (4%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 6, bn 6, RTL 6.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Ready to Use |  | G1_state_word |  |
| Format Checked |  | G2_safety_check |  |
| Reviewed and Approved |  | G1_state_word |  |
| Safe Copy: Not Prepared Yet |  | G8_data_action, G9_claim_strength |  |
| File type checked. Not scanned for viruses. |  | G2_safety_check |  |
| Safe Copy |  | G8_data_action, G9_claim_strength |  |
| Prepare Safe Copy |  | G8_data_action, G9_claim_strength |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J18. Privacy: export, remove and delete

- Role: traveller
- States in this journey: populated
- Semantic checks to apply: export vs share vs delete vs permanent erasure; legal hold

### Screen: rahim__app_privacy

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J18-rahim_app_privacy-en.jpg) | ![](screens/J18-rahim_app_privacy-bn.jpg) | ![](screens/J18-rahim_app_privacy-rtl.jpg) |

Measured: bn draft swapped 19 of 185 text runs (10%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Export everything, review your consent history, or delete your account. |  | G8_data_action |  |
| Glance: your three rights, each one tap away, and the export downloads. |  | G8_data_action |  |
| Browse: what an export holds, and your consent history. |  | G8_data_action |  |
| Export Your Data |  | G8_data_action |  |
| Delete Your Account |  | G8_data_action |  |
| Download Export (JSON) |  | G8_data_action |  |
| Download Export (CSV/ZIP) |  | G8_data_action |  |

### Screen: rahim__app_applicant__id__removal-records

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J18-rahim_app_applicant_id_removal-records-en.jpg) | ![](screens/J18-rahim_app_applicant_id_removal-records-bn.jpg) | ![](screens/J18-rahim_app_applicant_id_removal-records-rtl.jpg) |

Measured: bn draft swapped 8 of 98 text runs (8%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 3, bn 3, RTL 3.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Removal Records |  | G8_data_action |  |
| Removed from VisaStack. Backup copies expire within 90 days and are never brought back. |  | G5_share_lifecycle, G9_claim_strength |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J19. Reminders, expiry dates and notifications

- Role: traveller
- States in this journey: populated, empty
- Semantic checks to apply: date and number formats; email and notification wording

### Screen: rahim__app_notifications

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J19-rahim_app_notifications-en.jpg) | ![](screens/J19-rahim_app_notifications-bn.jpg) | ![](screens/J19-rahim_app_notifications-rtl.jpg) |

Measured: bn draft swapped 12 of 130 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 4, bn 4, RTL 4.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| Everything: the older ones you have read. |  | G6_copy_version |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |

### Screen: rahim__app_applicant__id__expiry

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J19-rahim_app_applicant_id_expiry-en.jpg) | ![](screens/J19-rahim_app_applicant_id_expiry-bn.jpg) | ![](screens/J19-rahim_app_applicant_id_expiry-rtl.jpg) |

Measured: bn draft swapped 16 of 181 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 4, bn 4, RTL 4.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |
| Privacy and Control |  |  |  |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |

## J20. Error, access-denied and plan screens

- Role: visitor
- States in this journey: denied, not found, payment result
- Semantic checks to apply: blame-free error wording; no stronger payment claim than English
- Not rendered (untested): rahim__app_account_plan_billing

### Screen: public__pilot-access-denied

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J20-public_pilot-access-denied-en.jpg) | ![](screens/J20-public_pilot-access-denied-bn.jpg) | ![](screens/J20-public_pilot-access-denied-rtl.jpg) |

Measured: bn draft swapped 3 of 25 text runs (12%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 0, bn 0, RTL 0.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Test version. Made-up details only. |  | G6_copy_version |  |
| This pilot is invite-only |  | G5_share_lifecycle |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack Private Pilot |  |  |  |
| What Works Today |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |

### Screen: rahim__app_account_plan

| English | bn-BD draft | RTL probe |
|---|---|---|
| ![](screens/J20-rahim_app_account_plan-en.jpg) | ![](screens/J20-rahim_app_account_plan-bn.jpg) | ![](screens/J20-rahim_app_account_plan-rtl.jpg) |

Measured: bn draft swapped 16 of 169 text runs (9%). Sideways overflow in pixels: English 0, bn 0, RTL 0. Clipped text blocks: English 10, bn 10, RTL 10.

| English on screen | bn-BD draft | Guardrail tags | Automated check |
|---|---|---|---|
| Sharing & Requests |  | G8_data_action |  |
| Sharing |  | G8_data_action |  |
| Sharing follows your saved permissions. |  | G1_state_word, G8_data_action |  |
| AI App Original Files |  | G8_data_action |  |
| About This Version |  | G6_copy_version |  |
| Skip to Content |  |  |  |
| VisaStack |  |  |  |
| Menu |  |  |  |
| Product |  |  |  |
| For Agencies | এজেন্সির জন্য |  | PASS |

Human review sign-off (to be completed by the editor and, for legal wording, a qualified reviewer):

| Check | Result | Reviewer | Date |
|---|---|---|---|
| Meaning matches English | PENDING | | |
| Natural bn-BD wording | PENDING | | |
| Narrow phone fit | PENDING | | |
| Screen reader names | PENDING | | |
