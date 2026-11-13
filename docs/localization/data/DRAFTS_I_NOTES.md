# Bengali drafts batch I (13 Nov 2026)

Drafts written for one catalogue key each, in `drafts/no-census-I.jsonl`. They are machine drafts, not reviewed by a person. A draft reaches a screen only through `node scripts/i18n/codemod.mjs --refill-bn`, which applies every gate a key draft has: the exact English, the automated checks, the holds, no legal, consent, privacy, payment or official wording, matching placeholders and plural shape, and matching edge spaces.

## What is in the batch

| Part | Keys | State |
|---|---|---|
| Answer from Your Records (`evidence-answer` catalogue) | 91 | Filled in this pull request: all 91 pass and each is rendered under Bengali by a test |
| Other screens (keys with no draft, a plural message, or placeholder names that differ from the register row) | 56 | Drafted only. A later refill pull request fills them, each with a test that renders it |

## Drafted here, refused by the gate (stay English)

| Key | English | Why |
|---|---|---|
| `appHome.appAccountMenu.viewPlan` | View Plan | Payment wording: a key draft can never release it. It needs a register row under the payment sign-off |
| `trust.publicTrustStory.viewPrivacyDetails` | View Privacy Details | Privacy wording: a key draft can never release it. It needs a register row under the privacy sign-off |

## Left English on purpose, not drafted

| Key | Why |
|---|---|
| `appAccount.appAccountPlanBillingPage.downloadInvoicePdf` | Invoice record action (invoices stay English) |
| `appAgency.appAgencyOrgidPage.attentionDetailsPluralAgreeAResponse` | Interpolates English-only words ({plural}, {agree}) |
| `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadInvoicePdf` | Invoice record action (invoices stay English) |
| `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.reasonDecisionreason` | Invoice record content (stays English) |
| `appApplicant.appApplicantIdReviewPage.pluralFoundInPlural2AcceptThe` | Interpolates English-only words ({plural}, {plural2}) |
| `appContributorRequests.appContributorRequestsAcceptSubmitEvidenceForm.alsoAllowThisDocumentToBe` | Consent wording: needs the owner, never a key draft |
| `appMission.appMissionIdMissionButtons.noAutomatedRequirementPackCoversThis` | Requirement pack wording: goes with the case screens batch |
| `appSharingInvitations.appSharingInvitationsAcceptAcceptForm.iHaveReviewedThePurposePermissions` | Consent wording: needs the owner, never a key draft |
| `applicantCalendar.appApplicantIdCalendarPage.oneFileHoldsUpToCalendar` | Interpolates English-only words ({plural}) |
| `applicantInsights.appApplicantIdInsightsPage.coveredOfPluralHaveASupporting` | Interpolates English-only words ({plural}) |
| `components.activityLog.showingLengthOfTheLength2Which` | Interpolates English-only words ({which}, {reach}, {total}) |
| `components.activityLog.theLengthWhichEntriesReachTotal` | Interpolates English-only words ({which}, {reach}, {total}) |
| `components.timeZoneSelect.utc` | UTC is the same in both languages |
| `home.page.signInDidnTCompletePlease` | Landing page keeps this English on purpose (sign-in reference code) |
| `home.page.visastackIsInAPrivatePilot` | Landing page words this from its parts |
| `home.page.visastackIsInPublicBetaSo` | Landing page words this from its parts |
| `oauth.oauthAuthorizePage.agency` | Sign-in with another service: guard tests hold this screen in English |
| `oauth.oauthAuthorizePage.isAskingToReadPartsOf` | Sign-in with another service: guard tests hold this screen in English |
| `oauth.oauthAuthorizePage.record` | Sign-in with another service: guard tests hold this screen in English |

## Tool changes that came with the batch

- The checker reads plural messages: the plural syntax the English also has (`{count, plural,`, `one`, `other`, `=1`) is not counted as English left in the Bengali. An English word inside a plural branch still fails, and so does plural syntax the English does not have.
- A key draft may carry a plural message when its variables, plural variables and nesting match the English exactly and every plural has an `other` branch. The web translator formats the same plural subset in both languages.
- A key whose register row is released and passes, but words the plural with an English-only switch or names a placeholder differently from the catalogue, may be filled from a draft written for that key. A held group, an unreleased queue or a failing row never falls back.

## Known gaps on the Answer from Your Records screens

- The page title, the way back, the empty-state title and action, and the reference label on the receipt are passed as plain strings, so their Bengali carries no language mark of its own (the page is still marked English). The tests pin this list so it can only get shorter.
- The sentence the send answers with is a plain string from the server and is shown as sent.
- The date words beside each copy on a request (expires, expired, dates disagree) are passed to the form as plain strings.
- Dates and times inside these sentences are worded by the existing formatters, not by this batch.
