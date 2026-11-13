# Bengali refill leftovers

Keys in the live catalogues that still show English under Bengali after the refill of 13 Nov 2026 (`node scripts/i18n/codemod.mjs --refill-bn`), for a reason the next drafting batch or a code change can fix. Generated from the catalogues and `VISASTACK_TRANSLATION_REGISTER.csv` on main at b6054a0 (drafts A to H and their corrections). The refill changes none of these rows.

Counts at b6054a0: 1,466 English-only keys; 1,204 have a passing draft and are filled by the refill pull requests (split by surface, about 400 keys each); the rest are below.

Not listed row by row:

- Held by the HOLDBACK map in `scripts/i18n/register.mjs`: 105 keys. English by decision; the map is unchanged.
- In the official visa requirement queue, which is not released: 47 keys.
- The `home` surface (25 fillable keys) and `layout.tsx`: owned by the landing pull request #561.
- The document removal keys of `app-applicant` (`appApplicantIdDocumentsManage...`): owned by the removal screens pull request (services S1c); filled once it merges.

## What each reason needs

- Fails the refill tool checks: a draft exists and passes the register checks, but it cannot be placed safely. `bn_placeholders_differ`: the draft's `{placeholders}` do not match the English. `english_is_plural_message`: the English is a plural message, which the refill never fills. Fix: a corrected draft in `data/drafts/bn-BD.corrections.jsonl` (for a plural, a Bengali plural message).
- Maps to more than one register group: the same English has two or more meanings in the register, so the catalogue key cannot pick one. Fix: pin the key to one group in its `.sources.json`, or merge the groups.
- Has no register group: the key was created after the census, or its text is not in the register. Fix: add it to the census and the register, then draft it.
- No Bengali draft yet: the register row exists with no draft. Fix: the next drafting batch.

## Keys by reason

| Reason (count) | Surface | Key | English | Detail |
| --- | --- | --- | --- | --- |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidCollectionRequestPage.noteNote` | Note: {note} | SG-50ceaac3: bn_placeholders_differ |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidDoNextList.showingLengthOfLength2TheRest` | Showing {length} of {length2}. The rest are in the case list below. | SG-81ea1b3d: bn_placeholders_differ |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidPage.attentionDetailsPluralAgreeAResponse` | Attention Details: {plural} {agree} a response | SG-98550bda: bn_placeholders_differ |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidPage.finishAgencySetupLengthOfLength2` | Finish agency setup: {length} of {length2} complete | SG-e9b5ecc2: bn_placeholders_differ |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidPage.openrequestsOpenRequests` | {openRequests, plural, =1 {{openRequests} open request} other {{openRequests} open requests}} | SG-950506d5: english_is_plural_message |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidPage.overduetasksOverdueTasks` | {overdueTasks, plural, =1 {{overdueTasks} overdue task} other {{overdueTasks} overdue tasks}} | SG-3f00d6f6: english_is_plural_message |
| Fails the refill tool checks (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.reasonDecisionreason` | Reason: {decisionReason} | SG-f952f73c: bn_placeholders_differ |
| Fails the refill tool checks (19) | app-applicant | `appApplicant.appApplicantIdImportImportPanel.theHourlyUploadLimitWasReached` | {held, plural, =1 {The hourly upload limit was reached, so {held} file is waiting. Nothing more is sent until you try again.} other {The hourly upload limit was reached, so {held} files are waiting. Nothing more is sent until you try again.}} | SG-8dc7be44: english_is_plural_message |
| Fails the refill tool checks (19) | app-applicant | `appApplicant.appApplicantIdProfileEditor.suggestedlockedcountSuggestedSectionsAreStillLoc` | {suggestedLockedCount, plural, =1 {{suggestedLockedCount} suggested section is still locked.} other {{suggestedLockedCount} suggested sections are still locked.}} | SG-7ac81355: english_is_plural_message |
| Fails the refill tool checks (19) | applicant-calendar | `applicantCalendar.appApplicantIdCalendarPage.oneFileHoldsUpToCalendar` | {leftOut, plural, =1 {One file holds up to {CALENDAR_EXPORT_LIMIT} events, so the last {plural} you chose is left out. Download them in a second file.} other {One file holds up to {CALENDAR_EXPORT_LIMIT} events, so the last {plural} you chose are left out. Download them in a second file.}} | SG-8735373c: english_is_plural_message |
| Fails the refill tool checks (19) | applicant-insights | `applicantInsights.appApplicantIdInsightsPage.coveredOfPluralHaveASupporting` | {covered, plural, =1 {{covered} of {plural} has a supporting document.} other {{covered} of {plural} have a supporting document.}} | SG-2782e738: english_is_plural_message |
| Fails the refill tool checks (19) | applicant-sharing | `applicantSharing.appApplicantIdSharingScopeExpansionForm.lengthNewDocumentsNowMatchThis` | {length, plural, =1 {{length} new document now match this grant category. They stay hidden from the recipient until you confirm including them.} other {{length} new documents now match this grant categories. They stay hidden from the recipient until you confirm including them.}} | SG-938a9ab6: english_is_plural_message |
| Fails the refill tool checks (19) | collect | `collect.collectGuestProgress.placedFilesPlaced` | {placed, plural, =1 {{placed} File Placed} other {{placed} Files Placed}} | SG-03c70b5e: english_is_plural_message |
| Fails the refill tool checks (19) | collect | `collect.collectRetentionChoice.howLongWhoMayKeepYour` | How Long {who} May Keep Your Files | SG-433f4649: bn_placeholders_differ |
| Fails the refill tool checks (19) | components | `components.documentWalletBrowser.notsortedAgreeAKind` | {notSorted, plural, one {# Needs a Kind} other {# Need a Kind}} | SG-1abdccff: english_is_plural_message |
| Fails the refill tool checks (19) | components | `components.documentWalletBrowser.notsortedDocumentsHaveNoKindSet` | {notSorted, plural, =1 {{notSorted} document has no kind set yet, so it is in no category and left out when you share by category. Open a document and choose its kind.} other {{notSorted} documents have no kind set yet, so they are in no category and left out when you share by category. Open a document and choose its kind.}} | SG-9fa701af: english_is_plural_message |
| Fails the refill tool checks (19) | components-more | `componentsMore.caseListRow.nextStep` | Next: {step} | SG-c08c7130: bn_placeholders_differ |
| Fails the refill tool checks (19) | components-more | `componentsMore.casePreparationSummary.satisfiedrequiredOfRequiredcount` | {satisfiedRequired} of {requiredCount} | SG-8b52c7eb: bn_placeholders_differ |
| Fails the refill tool checks (19) | components-more | `componentsMore.safeCopyEditor.doneOfTotal` | {done} of {total} | SG-a010d231: bn_placeholders_differ |
| Maps to more than one register group (18) | app-account | `appAccount.appAccountPage.openPrivacy` | Open Privacy | SG-8c4aa9ee, SG-f229b451 |
| Maps to more than one register group (18) | app-account | `appAccount.appAccountPage.optional` | Optional | SG-418be079, SG-5ee71201, SG-d1fb96fc, SG-ea785410 |
| Maps to more than one register group (18) | app-account | `appAccount.appAccountPage.plan` | Plan | SG-3d7c2fb7, SG-c4883177, SG-f0095d07 |
| Maps to more than one register group (18) | app-account | `appAccount.appAccountPage.planUsage` | Plan & Usage | SG-7b7c3f23, SG-871651c9, SG-fdc12380 |
| Maps to more than one register group (18) | app-account | `appAccount.appAccountPage.platformAdministration` | Platform Administration | SG-0a5a8278, SG-510179d7 |
| Maps to more than one register group (18) | app-account | `appAccount.appAccountPage.privacy` | Privacy | SG-5a84f019, SG-d70ff269, SG-e0e720e4, SG-ece02514 |
| Maps to more than one register group (18) | app-agency | `appAgency.appAgencyOrgidCollectionPage.waitingForReview` | Waiting for Review | SG-475541d2, SG-9836ad60 |
| Maps to more than one register group (18) | app-agency | `appAgency.appAgencyOrgidPlanPage.planUsage` | Plan & Usage | SG-871651c9, SG-fdc12380 |
| Maps to more than one register group (18) | app-agency | `appAgency.appAgencyPage.new` | New | SG-1c7dd3c9, SG-75178955, SG-93996def, SG-bfb7ed7c, SG-cd794e25 |
| Maps to more than one register group (18) | app-agency | `appAgency.appAgencyPage.organizations` | Organizations | SG-119701f4, SG-e4c5994b |
| Maps to more than one register group (18) | app-applicant | `appApplicant.appApplicantIdExpiryPage.datesExpiry` | Dates & Expiry | SG-013b0371, SG-30fa0d28 |
| Maps to more than one register group (18) | app-client-invitations | `appClientInvitations.appClientInvitationsAcceptPage.invitation` | Invitation | SG-6c4c0ce5, SG-71141c69 |
| Maps to more than one register group (18) | applicant-evidence | `applicantEvidence.appApplicantIdEvidenceRequestPanes.addDocuments` | Add Documents | SG-24f38a0f, SG-3cb299a1, SG-72122edf, SG-b296ba95 |
| Maps to more than one register group (18) | auth | `auth.authAuthUi.visastack` | VisaStack | SG-0cf92116, SG-57d3e0a6, SG-5c746f82, SG-7973930a, SG-8d12f7ed, SG-c1e30cfa |
| Maps to more than one register group (18) | home | `home.page.bankStatement` | Bank Statement | SG-0a7e7f1d, SG-2be9b102, SG-7d678a24, SG-c8f3a3d4, SG-f8daffe2 |
| Maps to more than one register group (18) | home | `home.page.employmentLetteraaddbb` | Employment Letter | SG-afec0b93, SG-bee016f1 |
| Maps to more than one register group (18) | home | `home.page.forAgencies` | For Agencies | SG-19cc3369, SG-28e4a888, SG-4f434b04 |
| Maps to more than one register group (18) | oauth | `oauth.oauthAuthorizePage.aiAppAccess` | AI App Access | SG-3fb2aa39, SG-cc574f29 |
| Has no register group (54) | app-account | `appAccount.appAccountPage.language` | Language | no register group in the sources map |
| Has no register group (54) | app-account | `appAccount.appAccountPage.preferences` | Preferences | no register group in the sources map |
| Has no register group (54) | app-account | `appAccount.appAccountPlanBillingPage.downloadInvoicePdf` | Download Invoice (PDF) | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidClientsPage.all` | All | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.yourAgencySOwnChecklist` | Your Agency's Own Checklist | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidCollectionRequestPage.documentRequest` | Document Request: | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidEvidenceCopies.downloadSentFile` | Download Sent File | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidEvidenceCopies.fingerprint` | Fingerprint | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidEvidencePicker.lengthOfLength2` | {length} of {length2} | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidPage.waitingontravellersWaitingOnTravellersWaitingona` | {waitingOnTravellers, plural, =1 {{waitingOnTravellers} waiting on a traveller, {waitingOnAgency} waiting on you} other {{waitingOnTravellers} waiting on travellers, {waitingOnAgency} waiting on you}} | no register group in the sources map |
| Has no register group (54) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadInvoicePdf` | Download Invoice (PDF) | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdAiReview.bothAreRightItChanged` | Both Are Right, It Changed | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdAiReview.foundAs` | Found as | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdAiReview.keepMyCurrentValue` | Keep My Current Value | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdAiReview.theAppSReasonInIts` | The app’s reason, in its own words: | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdDocumentsManageDeleteDeleteAction.documentnameIsAnExactCopyThe` | {documentName} is an exact copy. The identical copy that stays is | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdDocumentsNeedsDecision.sortedForYou` | Sorted for You | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdPage.nothingNeedsADecisionRightNow` | Nothing needs a decision right now. | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdProfileEditor.useThisSection` | Use This Section | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdRecordBrowser.searchYourRecord` | Search Your Record | no register group in the sources map |
| Has no register group (54) | app-applicant | `appApplicant.appApplicantIdReviewPage.pluralFoundInPlural2AcceptThe` | {plural} found in {plural2}. Accept the clear ones at once, or one by one. Sensitive details, such as an ID number, are always decided one at a time. | no register group in the sources map |
| Has no register group (54) | app-client-invitations | `appClientInvitations.appClientInvitationsAcceptAcceptForm.createANewProfile` | Create a New Profile | no register group in the sources map |
| Has no register group (54) | app-contributor-requests | `appContributorRequests.appContributorRequestsAcceptSubmitEvidenceForm.alsoAllowThisDocumentToBe` | Also allow this document to be reused for the traveller's future cases (optional - off by default, this file only helps with this one case) | no register group in the sources map |
| Has no register group (54) | app-home | `appHome.appAccountMenu.viewPlan` | View Plan | no register group in the sources map |
| Has no register group (54) | app-mission | `appMission.appMissionIdMissionButtons.noAutomatedRequirementPackCoversThis` | No automated requirement pack covers this route (manual mode) | no register group in the sources map |
| Has no register group (54) | app-sharing-invitations | `appSharingInvitations.appSharingInvitationsAcceptAcceptForm.iHaveReviewedThePurposePermissions` | I have reviewed the purpose, permissions, document scope and expiry and agree to this access. | no register group in the sources map |
| Has no register group (54) | applicant-calendar | `applicantCalendar.appApplicantIdCalendarCalendarSelectAll.selectAll` | Select All | no register group in the sources map |
| Has no register group (54) | applicant-evidence | `applicantEvidence.appApplicantIdEvidenceClearerCopyPanel.uploadAClearerCopy` | Upload a Clearer Copy | no register group in the sources map |
| Has no register group (54) | applicant-evidence | `applicantEvidence.appApplicantIdEvidenceRequestPanes.askTheAgencyAboutThisItem` | Ask the Agency About This Item | no register group in the sources map |
| Has no register group (54) | applicant-evidence | `applicantEvidence.appApplicantIdEvidenceRequestPanes.readRepliesInTheCaseNotes` | Read Replies in the Case Notes | no register group in the sources map |
| Has no register group (54) | applicant-missions | `applicantMissions.appApplicantIdMissionsPage.noCaseIsBeingWorkedOn` | No case is being worked on right now. | no register group in the sources map |
| Has no register group (54) | auth | `auth.authAuthUi.youStayInControlOfYour` | You stay in control of your records and every suggestion you approve. | no register group in the sources map |
| Has no register group (54) | collect | `collect.collectGuestProgress.needslookFilesNeedALook` | {needsLook, plural, =1 {{needsLook} file needs a look} other {{needsLook} files need a look}} | no register group in the sources map |
| Has no register group (54) | components | `components.activityLog.showingLengthOfTheLength2Which` | Showing {length} of the {length2} {which} entries{reach}.{total} | no register group in the sources map |
| Has no register group (54) | components | `components.activityLog.theLengthWhichEntriesReachTotal` | {length, plural, =1 {The {length} {which} entry{reach}.{total}} other {The {length} {which} entries{reach}.{total}}} | no register group in the sources map |
| Has no register group (54) | components | `components.countryBrowser.searchCountries` | Search Countries | no register group in the sources map |
| Has no register group (54) | components | `components.documentWalletBrowser.showThem` | {notSorted, plural, =1 {Show It} other {Show Them}} | no register group in the sources map |
| Has no register group (54) | components | `components.timeZoneSelect.utc` | UTC | no register group in the sources map |
| Has no register group (54) | components-more | `componentsMore.safeCopyEditor.acceptBoxNumber` | Accept box {number} | no register group in the sources map |
| Has no register group (54) | components-more | `componentsMore.safeCopyEditor.removeBoxNumber` | Remove box {number} | no register group in the sources map |
| Has no register group (54) | components-more | `componentsMore.safeCopyEditor.selectBoxNumber` | Select box {number} | no register group in the sources map |
| Has no register group (54) | components-more | `componentsMore.safeCopyEditor.tryAgainToShowPageNumber` | Try again to show page {number} | no register group in the sources map |
| Has no register group (54) | components-ui-lift | `componentsUiLift.progressMeter.meterName` | {value} of {max} {label} | no register group in the sources map |
| Has no register group (54) | components-ui-lift | `componentsUiLift.progressMeter.meterWords` | {value} of {max} | no register group in the sources map |
| Has no register group (54) | home | `home.page.signInDidnTCompletePlease` | Sign-in didn’t complete. Please try again. If it keeps happening, contact support and quote reference | no register group in the sources map |
| Has no register group (54) | invitation | `invitation.invitationClientInvitationOffer.invitedYouToWorkTogetherOn` | invited you to work together on VisaStack. VisaStack has not finished reviewing them, so you cannot accept yet. | no register group in the sources map |
| Has no register group (54) | oauth | `oauth.oauthAuthorizePage.agency` | Agency: | no register group in the sources map |
| Has no register group (54) | oauth | `oauth.oauthAuthorizePage.isAskingToReadPartsOf` | is asking to read parts of a VisaStack record so it can help you. | no register group in the sources map |
| Has no register group (54) | oauth | `oauth.oauthAuthorizePage.record` | Record: | no register group in the sources map |
| Has no register group (54) | trust | `trust.publicTrustStory.confirmedItinerary` | Confirmed itinerary | no register group in the sources map |
| Has no register group (54) | trust | `trust.publicTrustStory.originalFilesStayProtected` | Original files stay protected | no register group in the sources map |
| Has no register group (54) | trust | `trust.publicTrustStory.passportSummary` | Passport summary | no register group in the sources map |
| Has no register group (54) | trust | `trust.publicTrustStory.startWithYourOwnProfile` | Start with Your Own Profile | no register group in the sources map |
| Has no register group (54) | trust | `trust.publicTrustStory.viewPrivacyDetails` | View Privacy Details | no register group in the sources map |
| No Bengali draft yet (19) | app-account | `appAccount.appAccountPlanBillingPage.paidOn` | Paid On | SG-3cd981dc: not drafted yet |
| No Bengali draft yet (19) | app-account | `appAccount.appAccountPlanBillingPage.period` | Period | SG-c40e40d5: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.claimMethodLabelsPlainamountPaidFormatbillingdat` | {CLAIM_METHOD_LABELS}, {plainAmount}, paid {formatBillingDate} | SG-730611ef: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.due` | Due | SG-c67ea94f: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.itIsDueToday` |  It is due today. | SG-24d72f04: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.itWasDueOnFormatbillingdate` |  It was due on {formatBillingDate}. | SG-e13c9cd3: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paidSoFar` | Paid So Far | SG-1850b262: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.partOfItHasBeenPaid` |  Part of it has been paid. | SG-336f4d1f: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.stillOwed` | Still Owed | SG-cf2b6949: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.howItWasPaid` | How It Was Paid | SG-406de0da: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.invoice` | Invoice | SG-e8602cef: not drafted yet |
| No Bengali draft yet (19) | app-agency | `appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.paymentDate` | Payment Date | SG-ea2e25cd: not drafted yet |
| No Bengali draft yet (19) | app-home | `appHome.appAppNav.platformWorkspace` | Platform Workspace | SG-90d0b908: not drafted yet |
| No Bengali draft yet (19) | app-home | `appHome.appWorkspaceShell.leaveStaffMode` | Leave Staff Mode | SG-1ca7a9dd: not drafted yet |
| No Bengali draft yet (19) | app-home | `appHome.appWorkspaceShell.operationsAndBilling` | Operations and Billing | SG-c87b844a: not drafted yet |
| No Bengali draft yet (19) | app-home | `appHome.appWorkspaceShell.platformOperations` | Platform Operations | SG-7d3c7c4f: not drafted yet |
| No Bengali draft yet (19) | app-home | `appHome.appWorkspaceShell.platformToolsForVisastackStaff` | Platform tools for VisaStack staff. | SG-1f0c08e1: not drafted yet |
| No Bengali draft yet (19) | app-home | `appHome.appWorkspaceShell.staffMode` | Staff Mode | SG-336f5b06: not drafted yet |
| No Bengali draft yet (19) | payments | `payments.paymentsResultPage.invoice` | Invoice | SG-e8602cef: not drafted yet |

## Left English at review in the refill pull requests

Values the refill would place (34 in the first refill pull request), left in English because the sentence would carry English text inside Bengali, or because a button's spoken name would differ in language from its visible text. The HOLDBACK map was not changed (owner instruction). A later refill run would fill these again, so each needs a decision: a holdback entry with its content reason, or a fix at the call site (then refill).

| Surface | Key | English | Why it stays English |
| --- | --- | --- | --- |
| app-account | `appAccount.appAccountPlanBillingPage.youCanAskForAFull` | You can ask for a full refund until {formatBillingDateTime} (Bangladesh time), ... | `formatBillingDateTime` writes English month names inside the sentence. Fix: a Bengali billing date format. |
| app-account | `appAccount.appAccountPlanPage.everySavedVersionOfEveryDocument` | Every saved version of every document counts. Each file can be up to {uploadLimitLabel}. | `uploadLimitLabel` is an English size label with Latin digits. |
| app-agency | `appAgency.appAgencyOrgidClientsPage.dueFormatdateonly` |  · due {formatDateOnly} | The call site formats the date without the reader language, so it is English. Fix: pass the locale. |
| app-agency | `appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate` | Invited · expires {formatTimestampDate} | Same: the date is formatted in English at both call sites (clients and team pages). |
| app-agency | `appAgency.appAgencyOrgidPage.acknowledgedFormattimestampdate` | Acknowledged {formatTimestampDate} | Same: the date is formatted in English. |
| app-agency | `appAgency.appAgencyOrgidEvidenceCopies.decidedFormatmoment` |  · Decided {formatMoment} | `formatMoment` writes an English date and time. |
| app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aPaymentForThisInvoiceWas` | A payment for this invoice was started at {startedAt}. ... | `startedAt` is an English billing date and time. |
| app-agency | `appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.plainamountStartedFormatbillingdatetime` | {plainAmount}, started {formatBillingDateTime} | `formatBillingDateTime` writes English month names. |
| app-agency | `appAgency.appAgencyOrgidPlanPage.fromFormatbillingdateYourNextBillingPeriod` | From {formatBillingDate}, your next billing period, the price is {formatMoney}. ... | `formatBillingDate` writes English month names. |
| app-agency | `appAgency.appAgencyOrgidSettingsPage.aifeatureoffsentenceConnectedAppsReadNothingUnti` | {aiFeatureOffSentence} Connected apps read nothing until it works again. | The filled-in sentence comes from `aiFeatureOffSentence` in packages/core and is English only. |
| app-agency | `appAgency.appAgencyOrgidCollectionRequestPage.thePersonOpensTheLinkAnd` | The person opens the link ... Each file can be up to {uploadLimitLabel}. | `uploadLimitLabel` is an English size label with Latin digits. |
| app-agency | `appAgency.appAgencyOrgidCollectionRequestPage.issue` | Issue | The heading is the verb (issue the request, beside "Issue Again"); the shared draft means a problem. Fix: pin the key to its own group. |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.saveNoteLabel` | Save Note: {label} | A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button). |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.saveNecessityLabel` | Save Necessity: {label} | Same: visible text "Save Necessity" is English. |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.moveUpLabel` | Move Up: {label} | Same: visible text "Move Up" is English. |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.moveDownLabel` | Move Down: {label} | Same: visible text "Move Down" is English. |
| app-agency | `appAgency.appAgencyOrgidAgencyAiTurnOff.turnOffApplabel` | Turn Off {appLabel} | Same: visible text "Turn Off" is English. |
| app-agency | `appAgency.appAgencyOrgidChecklistsChecklistForms.makeItOurOwnName` | Make It Our Own: {name} | Same: visible text "Make It Our Own" is English. |
| app-agency | `appAgency.appAgencyOrgidEvidencePicker.missingForThisCase` | Missing for This Case | The section name; its visible heading button "Missing for This Case" is an English literal. |
| app-home | `appHome.appFirstRun.seeYourCountrynameChecklist` | See Your {countryName} Checklist | The country name comes from an English-only list. |
| app-home | `appHome.appWorkspaceShell.nameCaptionSwitchWorkspace` | {name}, {caption}, Switch Workspace | `caption` is an English workspace caption (for example "Agency Workspace"). |
| app-account | `appAccount.appAccountPage.whatsapp` | WhatsApp | The draft is the English brand name unchanged; filling it would mark an English word as Bengali. |
| app-agency | `appAgency.appAgencyOrgidBrandingForm.087a68` | #087a68 | A colour code; the draft is the same text. |
| app-home | `appHome.appWorkspaceRecordToolbar.visastack` | VisaStack | The product name; the draft is the same text. |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.noteLabel` | Note: {label} | `label` is the English checklist item label, and the Save Note button beside it stays English. |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionForms.howNecessaryLabel` | How Necessary: {label} | Same: English checklist item label inside the sentence. |
| app-agency | `appAgency.appAgencyOrgidCollectionCollectionReviewForms.noteOnLabel` | Note on {label} | Same: English checklist item label inside the sentence. |
| app-agency | `appAgency.appAgencyOrgidChecklistsEditPage.forInterpretation` | For: {interpretation} | `interpretation` is English checklist text. |
| app-agency | `appAgency.appAgencyOrgidEvidencePicker.pickedSelected` | , {picked} selected | Joined onto the English "{length} of {length2}" in one button name, which would mix languages and digit systems. |
| app-agency | `appAgency.appAgencyOrgidCollectionPage.waitingWaitingForReview` | {waiting} Waiting for Review | Sits beside the English answer total and the English "Waiting for Review" filter (that key maps to two register groups). |
| app-agency | `appAgency.appAgencyOrgidCollectionPage.needscorrectionNeedsCorrection` | {needsCorrection} Needs Correction | Same row as above. |
| app-agency | `appAgency.appAgencyOrgidAgencyAiSettingForm.iConfirmThisStatementForOrganizationname` | I Confirm This Statement for {organizationName} | It confirms the English AI statement (`agencyAiStatement` in lib/agency-ai.ts) beside the English Turn On button; the confirmation and what it confirms stay in one language. |
| app-agency | `appAgency.appAgencyOrgidEvidenceCopies.sendRoundnoTitle` | Send {roundNo}: {title} | The rest of the earlier-send card (status pill, "Sent ... Decided ..." line) is English. |
| app-countries | `appCountries.appCountriesCountryView.onlyWhenOnlywhen` | Only when: {onlyWhen} | `onlyWhen` is English official visa rule text. |

## Left English at review in refill 3

Refill 3 filled 215 keys of the applicant record screens (calendar, requests, insights, case history, cases, summaries, sharing), document collection, invitation, payments, status and trust. These 67 have a passing draft and stay English for the reason given; HOLDBACK is unchanged.

| Surface | Key | Why it stays English |
| --- | --- | --- |
| applicant-calendar | `applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.anyoneWhoHasThisLinkCan` | The calendar test pins this privacy line out of the Bengali catalogue; releasing it is a separate decision, not a refill. |
| applicant-calendar | `applicantCalendar.appApplicantIdCalendarPage.theFileWillHoldPluralAs` | `plural()` writes an English noun ("1 event"). |
| applicant-evidence | `applicantEvidence.appApplicantIdEvidenceAskAboutItemForm.everyoneWhoCanReadTheShared` | The evidence test pins this who-can-read warning out of the Bengali catalogue (its Send Question button is English). |
| applicant-evidence | `applicantEvidence.appApplicantIdEvidenceRequestPanes.askedFormatmoment` | `formatMoment` writes an English date. |
| applicant-insights | `applicantInsights.appApplicantIdInsightsPage.backsPluralJoin` | `plural()` writes an English noun, and the joined detail names are English. |
| applicant-insights | `applicantInsights.appApplicantIdInsightsPage.backsPluralInJoin` | Same: English noun and English section labels. |
| applicant-insights | `applicantInsights.appApplicantIdInsightsPage.canBackJoin` | The joined section labels are English. |
| applicant-insights | `applicantInsights.appApplicantIdInsightsPage.showingShownOfTotalNoun` | The noun is passed in English ("details to check"). |
| applicant-memory | `applicantMemory.appApplicantIdMemoryComparePage.compareNameThenAndNow` | Spoken name of the Compare link; the name holds an English detail label. |
| applicant-memory | `applicantMemory.appApplicantIdMemoryComparePage.compare` | Visible text of the same link: kept with its spoken name in one language. |
| applicant-missions | `applicantMissions.appApplicantIdMissionsCreateMissionForm.createTheCase` | Names the action bar whose only button, "Create Case", is English. |
| applicant-missions | `applicantMissions.appApplicantIdMissionsPrepareAgainPrepareAgainForm.createTheNewCase` | Same: the bar's button "Create Case" is English. |
| applicant-missions | `applicantMissions.appApplicantIdMissionsPrepareAgainPrepareAgainForm.optional` | Appended to an English checklist item label. |
| applicant-outputs | `applicantOutputs.appApplicantIdOutputsPage.nothingToShow` | Waits for a test: every section a summary builds today has rows or its own note, so no test can show this line yet. |
| applicant-outputs | `applicantOutputs.appApplicantIdOutputsPage.preparedOnLongdayThisIsExactly` | `longDay` writes an English date. |
| applicant-outputs | `applicantOutputs.appApplicantIdOutputsPage.stepNumberOf3` | Spoken before an English step name ("Choose a Summary"). |
| applicant-outputs | `applicantOutputs.appApplicantIdOutputsPage.summaryLabel` | The summary name is English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiConnectionTurnOff.keepItOn` | The other answer, "Yes, Turn Off", is English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiConnections.aifileslineButTurnedOffRightNow` | `aiFilesLine` is English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiConnections.yes` | Answer under an English row name (Full Numbers, Suggest Changes). |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiConnections.no` | Same. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiConnections.yesButTurnedOffRightNow` | Same. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingCaseExceptions.keepItPrivate` | The other answer, "Yes, Allow This Case", is English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingGrantAiChoice.saveAiToolsChoiceForAgencyname` | Spoken name of a button whose visible text "Save" is English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingGrantOpButtons.keepAccess` | The other answer, "Yes, Revoke Access", and its question are English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingGrantPane.organization` | Suffix of a pane title whose status and actions are English. |
| applicant-traveller-manage | `applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.cancel` | The confirmation heading, text and confirm button are English. |
| applicant-traveller-manage | `applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.manageName` | Spoken name of a button whose visible text "Manage" is English. |
| collect | `collect.collectAccountAnswersPage.withdrawnFormattimestampdate` | `formatTimestampDate` is called without the locale: English date. |
| collect | `collect.collectGuestProgress.chooseHowLongWhoMayKeep` | `who` falls back to the English "the agency". |
| collect | `collect.collectRetentionChoice.chooseHowManyDaysAfterThis` | Same: "The agency" fallback is English. |
| collect | `collect.collectGuestFiles.saveTheItemForFilename` | Spoken name of a button whose visible text "Save" is English. |
| collect | `collect.collectGuestProgress.yourSubmission` | An `aria-label` value: the collect language-marking test requires Bengali to be marked, and a label cannot carry `lang`. |
| collect | `collect.collectChecklist.suggestedFromItsNameCheckIt` | Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. |
| collect | `collect.collectGuestDeskFiles.agencyNoteNote` | Same page. |
| collect | `collect.collectGuestDeskFiles.changeItem` | Same page. |
| collect | `collect.collectGuestDeskFiles.filesAlreadyPlaced` | Same page. |
| collect | `collect.collectGuestFiles.checklistItemForFilename` | Same page (its Save button is English). |
| collect | `collect.collectGuestFiles.notPlacedYet` | Same page. |
| collect | `collect.collectGuestProgress.yourFilesAreStillBeingChecked` | Same page. |
| collect | `collect.collectGuestUploader.addYourFiles` | Same page. |
| collect | `collect.collectGuestUploader.dropFilesOrAFolderHere` | Same page. |
| collect | `collect.collectGuestUploader.filesToAdd` | Same page. |
| collect | `collect.collectGuestUploader.tryAgainForName` | Same page. |
| collect | `collect.collectPage.addAndSendYourFiles` | Same page (names the English upload rail). |
| collect | `collect.collectRetentionChoice.days` | Same page (inside the English retention fold). |
| invitation | `invitation.invitationClientInvitationOffer.done` | Spoken after an English step name ("Sign In"). |
| invitation | `invitation.invitationSwitchAccount.notYou` | Shares one line with the English button "Sign In with the Invited Email Address". |
| oauth | `oauth.oauthAuthorizeAgencyConsentForm.howLong` | The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. |
| oauth | `oauth.oauthAuthorizeConsentForm.answerAppname` | Same guard; names a bar of English answers. |
| oauth | `oauth.oauthAuthorizePage.chooseARecord` | Same guard. |
| oauth | `oauth.oauthAuthorizePage.chooseTheRecordThisAppMay` | Same guard. |
| oauth | `oauth.oauthAuthorizePage.connectAppname` | Same guard. |
| oauth | `oauth.oauthAuthorizePage.connectForAnAgency` | Same guard. |
| oauth | `oauth.oauthAuthorizePage.orConnectItForAnAgency` | Same guard. |
| oauth | `oauth.oauthAuthorizePage.thisAppRunsOnThisComputer` | Same guard. |
| oauth | `oauth.oauthAuthorizePage.youHaveNoRecordsToConnect` | Same guard. |
| payments | `payments.paymentsResultPage.purchase` | The payment result test keeps the purchase and invoice line identical to English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOffAppnameFromItsNext` | The question's answers, "Yes, Turn Off" and Keep It On, are English; the confirmation stays one language. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelWillBeAbleToSee` | Same: its answers "Yes, Allow This Case" and Keep It Private are English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiDrafts.showDraft` | The copy-failure message names it in English ("Choose Show Draft"). |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiDrafts.copyDraft` | Sits next to the English Delete Draft button, and the copy message names Show Draft in English. |
| applicant-sharing | `applicantSharing.appApplicantIdSharingAiDrafts.copyDraftTitle` | Spoken name of Copy Draft, which stays English. |
| payments | `payments.paymentsResultPage.checkAgain` | The English payment message names it ("choose Check Again"). |
| payments | `payments.paymentsResultPage.goToPlanUsage` | The English payment message names it ("go back to Plan & Usage"). |
| applicant-missions | `applicantMissions.appApplicantIdMissionsCreateMissionForm.notSureYet` | Also an option of the English purpose list, under an English question. |
| applicant-insights | `applicantInsights.appApplicantIdInsightsPage.openDocuments` | The Details to Check card on the same page writes Open Documents in English. |
