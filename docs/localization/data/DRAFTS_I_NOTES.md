# Bengali drafts batch I (13 Nov 2026)

Drafts written for one catalogue key each. They are machine drafts, not reviewed by a person. A draft reaches a screen only through `node scripts/i18n/codemod.mjs --refill-bn`, which applies every gate a key draft has: the exact English, the automated checks, the holds, no legal, consent, privacy, payment or official wording, matching placeholders and plural shape, and matching edge spaces.

## What is in the batch

| File | Keys | State |
|---|---|---|
| `drafts/no-census-I.jsonl` | 91 | Answer from Your Records (the `evidence-answer` catalogue). Filled in this pull request: all 91 pass the gates and each is rendered under Bengali by a test |
| `drafts/staged-key-drafts-I.jsonl` | 56 | Other screens: keys with no draft, a plural message, or placeholder names that differ from the register row. STAGED, not read by the refill tool (its name does not start with `no-census-`). 54 pass every gate today and 2 are refused (below) |

A staged row goes live in a refill pull request that moves the row into a `no-census-*.jsonl` file, gives the key a sources entry where it has none, and adds a test that renders it under Bengali. Keeping them staged means a plain `--refill-bn` on main fills nothing from this batch that no test renders.

Six staged keys have no entry in their surface's sources file yet and need a `null` entry before a key draft can fill them: `appAccount.appAccountPage.language`, `appAccount.appAccountPage.preferences`, and the four `componentsMore.safeCopyEditor.*` keys (`acceptBoxNumber`, `removeBoxNumber`, `selectBoxNumber`, `tryAgainToShowPageNumber`).

## Staged and refused by the gate (stay English)

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

- The checker reads plural messages: the plural syntax the English also has (`{count, plural,` and the branch names that open a branch of that plural) is not counted as English left in the Bengali. An English word inside a branch, in front of a placeholder outside the plural, or plural syntax the English does not have, still fails.
- A key draft may carry a plural message when its variables, plural variables and nesting match the English exactly and every plural has an `other` branch. The web translator formats the same plural subset in both languages.
- A key whose register row is in the ordinary queue, released and passing, but words the plural with an English-only switch or names a placeholder differently from the catalogue, may be filled from a draft written for that key. A held group, an unreleased queue, a failing row or a group in a specialist queue never falls back.

## Known gaps on the Answer from Your Records screens

- The page title, the way back, the empty-state title and action, and the reference label on the receipt are passed as plain strings, so their Bengali carries no language mark of its own (the page is still marked English). The tests pin this list so it can only get shorter.
- The sentence the send answers with is a plain string from the server and is shown as sent.
- The date words beside each copy on a request (expires, expired, dates disagree) are passed to the form as plain strings.
- Dates and times inside these sentences are worded by the existing formatters, not by this batch.
- The catalogue file is written by the same generator as every other catalogue, so its header speaks of the codemod and the register; for this catalogue the keys were written with the screen and the Bengali comes from `drafts/no-census-I.jsonl`.
- The fallback for placeholder names and plural shape works around a census that is older than the code. Refreshing the census, so that each register row fits its key, is the deeper fix and is not part of this batch.
