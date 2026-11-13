/**
 * Catalogue keys a refill pull request left English at review, each with its reason, copied from
 * docs/localization/data/REFILL_LEFTOVERS.md (the "Left English at review" tables, one key per row).
 * A row whose reason reads "Same" carries the reason of the row above it.
 * They join KEY_HOLDBACK in refill.mjs, so a plain `codemod.mjs --refill-bn` never fills them: the
 * reasons are technical (English text filled into a Bengali sentence, a button whose spoken name
 * would differ from its text, a guard test, a page still to be converted), not content holds, so
 * they are not in HOLDBACK. refill-holds.test.mjs keeps this list and the tables the same.
 * Remove a key here and from its table together, once its call site or page is fixed.
 */
export const REFILL_REVIEW_HOLDS = /** @type {const} */ ([
  [
    'appAccount.appAccountPlanBillingPage.youCanAskForAFull',
    'Left English at review (refill 1): `formatBillingDateTime` writes English month names inside the sentence. Fix: a Bengali billing date format.',
  ],
  [
    'appAccount.appAccountPlanPage.everySavedVersionOfEveryDocument',
    'Left English at review (refill 1): `uploadLimitLabel` is an English size label with Latin digits.',
  ],
  [
    'appAgency.appAgencyOrgidClientsPage.dueFormatdateonly',
    'Left English at review (refill 1): The call site formats the date without the reader language, so it is English. Fix: pass the locale.',
  ],
  [
    'appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate',
    'Left English at review (refill 1): The call site formats the date without the reader language, so it is English. Fix: pass the locale. the date is formatted in English at both call sites (clients and team pages).',
  ],
  [
    'appAgency.appAgencyOrgidPage.acknowledgedFormattimestampdate',
    'Left English at review (refill 1): The call site formats the date without the reader language, so it is English. Fix: pass the locale. the date is formatted in English.',
  ],
  [
    'appAgency.appAgencyOrgidEvidenceCopies.decidedFormatmoment',
    'Left English at review (refill 1): `formatMoment` writes an English date and time.',
  ],
  [
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aPaymentForThisInvoiceWas',
    'Left English at review (refill 1): `startedAt` is an English billing date and time.',
  ],
  [
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.plainamountStartedFormatbillingdatetime',
    'Left English at review (refill 1): `formatBillingDateTime` writes English month names.',
  ],
  [
    'appAgency.appAgencyOrgidPlanPage.fromFormatbillingdateYourNextBillingPeriod',
    'Left English at review (refill 1): `formatBillingDate` writes English month names.',
  ],
  [
    'appAgency.appAgencyOrgidSettingsPage.aifeatureoffsentenceConnectedAppsReadNothingUnti',
    'Left English at review (refill 1): The filled-in sentence comes from `aiFeatureOffSentence` in packages/core and is English only.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionRequestPage.thePersonOpensTheLinkAnd',
    'Left English at review (refill 1): `uploadLimitLabel` is an English size label with Latin digits.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionRequestPage.issue',
    'Left English at review (refill 1): The heading is the verb (issue the request, beside "Issue Again"); the shared draft means a problem. Fix: pin the key to its own group.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionForms.saveNoteLabel',
    'Left English at review (refill 1): A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button).',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionForms.saveNecessityLabel',
    'Left English at review (refill 1): A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button). visible text "Save Necessity" is English.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionForms.moveUpLabel',
    'Left English at review (refill 1): A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button). visible text "Move Up" is English.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionForms.moveDownLabel',
    'Left English at review (refill 1): A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button). visible text "Move Down" is English.',
  ],
  [
    'appAgency.appAgencyOrgidAgencyAiTurnOff.turnOffApplabel',
    'Left English at review (refill 1): A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button). visible text "Turn Off" is English.',
  ],
  [
    'appAgency.appAgencyOrgidChecklistsChecklistForms.makeItOurOwnName',
    'Left English at review (refill 1): A button name: its visible text "Save Note" is an English literal, so its spoken name stays English (one language per button). visible text "Make It Our Own" is English.',
  ],
  [
    'appAgency.appAgencyOrgidEvidencePicker.missingForThisCase',
    'Left English at review (refill 1): The section name; its visible heading button "Missing for This Case" is an English literal.',
  ],
  [
    'appHome.appFirstRun.seeYourCountrynameChecklist',
    'Left English at review (refill 1): The country name comes from an English-only list.',
  ],
  [
    'appHome.appWorkspaceShell.nameCaptionSwitchWorkspace',
    'Left English at review (refill 1): `caption` is an English workspace caption (for example "Agency Workspace").',
  ],
  [
    'appAccount.appAccountPage.whatsapp',
    'Left English at review (refill 1): The draft is the English brand name unchanged; filling it would mark an English word as Bengali.',
  ],
  [
    'appAgency.appAgencyOrgidBrandingForm.087a68',
    'Left English at review (refill 1): A colour code; the draft is the same text.',
  ],
  [
    'appHome.appWorkspaceRecordToolbar.visastack',
    'Left English at review (refill 1): The product name; the draft is the same text.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionForms.noteLabel',
    'Left English at review (refill 1): `label` is the English checklist item label, and the Save Note button beside it stays English.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionForms.howNecessaryLabel',
    'Left English at review (refill 1): `label` is the English checklist item label, and the Save Note button beside it stays English. English checklist item label inside the sentence.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.noteOnLabel',
    'Left English at review (refill 1): `label` is the English checklist item label, and the Save Note button beside it stays English. English checklist item label inside the sentence.',
  ],
  [
    'appAgency.appAgencyOrgidChecklistsEditPage.forInterpretation',
    'Left English at review (refill 1): `interpretation` is English checklist text.',
  ],
  [
    'appAgency.appAgencyOrgidEvidencePicker.pickedSelected',
    'Left English at review (refill 1): Joined onto the English "{length} of {length2}" in one button name, which would mix languages and digit systems.',
  ],
  [
    'appAgency.appAgencyOrgidCollectionPage.waitingWaitingForReview',
    'Left English at review (refill 1): Sits beside the English answer total and the English "Waiting for Review" filter (that key maps to two register groups).',
  ],
  [
    'appAgency.appAgencyOrgidCollectionPage.needscorrectionNeedsCorrection',
    'Left English at review (refill 1): Sits beside the English answer total and the English "Waiting for Review" filter (that key maps to two register groups). row as above.',
  ],
  [
    'appAgency.appAgencyOrgidAgencyAiSettingForm.iConfirmThisStatementForOrganizationname',
    'Left English at review (refill 1): It confirms the English AI statement (`agencyAiStatement` in lib/agency-ai.ts) beside the English Turn On button; the confirmation and what it confirms stay in one language.',
  ],
  [
    'appAgency.appAgencyOrgidEvidenceCopies.sendRoundnoTitle',
    'Left English at review (refill 1): The rest of the earlier-send card (status pill, "Sent ... Decided ..." line) is English.',
  ],
  [
    'appCountries.appCountriesCountryView.onlyWhenOnlywhen',
    'Left English at review (refill 1): `onlyWhen` is English official visa rule text.',
  ],
  [
    'appApplicant.appApplicantIdAiReview.aiThinksThisIsATolowercase',
    'Left English at review (refill 2): The document type is filled in as an English word.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.thisLabelEndedPosition',
    'Left English at review (refill 2): The profile group label is English.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.labelMarkedAsNotApplyingTo',
    'Left English at review (refill 2): The field label is English.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.somethingElseInLabel',
    'Left English at review (refill 2): The section label is English.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.whereThisCameFromTheDocument',
    'Left English at review (refill 2): The document type label is English.',
  ],
  [
    'appApplicant.appApplicantIdDocumentsNeedsDecision.whichPersonIsLabelFor',
    'Left English at review (refill 2): The fallback label "File Added {date}" is English.',
  ],
  [
    'appApplicant.appApplicantIdAiReview.clear',
    'Left English at review (refill 2): Wrong sense: the badge means readable; the draft is the verb (empty it).',
  ],
  [
    'appApplicant.appApplicantIdDocumentSuggestionCard.clear',
    'Left English at review (refill 2): Wrong sense: the badge means readable; the draft is the verb (empty it). wrong sense as above.',
  ],
  [
    'appApplicant.appApplicantIdReviewFlowSteps.done',
    'Left English at review (refill 2): Joined to an English step name (", done").',
  ],
  [
    'appApplicant.appApplicantIdReviewFlowSteps.next',
    'Left English at review (refill 2): Joined to an English step name (", done").',
  ],
  [
    'appApplicant.appApplicantIdReviewFlowSteps.now',
    'Left English at review (refill 2): Joined to an English step name (", done").',
  ],
  [
    'appApplicant.appApplicantIdAiReview.pleaseCheck',
    'Left English at review (refill 2): Pair of the English "Clear" badge.',
  ],
  [
    'appApplicant.appApplicantIdDocumentSuggestionCard.pleaseCheck',
    'Left English at review (refill 2): Pair of the English "Clear" badge.',
  ],
  [
    'appApplicant.appApplicantIdAiReview.useThisDocumentSValue',
    'Left English at review (refill 2): One option of a radio group whose other options and Save button are English.',
  ],
  [
    'appApplicant.appApplicantIdAiReview.useTheSuggestedValue',
    'Left English at review (refill 2): One option of a radio group whose other options and Save button are English. radio group.',
  ],
  [
    'appApplicant.appApplicantIdAiReview.yourProfileAlreadyHasADifferent',
    'Left English at review (refill 2): Legend of the same radio group (its other form is English).',
  ],
  [
    'appApplicant.appApplicantIdAiReview.dateItChanged',
    'Left English at review (refill 2): Label under the English "Both Are Right, It Changed" option.',
  ],
  [
    'appApplicant.appApplicantIdDocumentSuggestionCard.edit',
    'Left English at review (refill 2): Between the English Accept and Skip buttons.',
  ],
  [
    'appApplicant.appApplicantIdDocumentUploader.addedAsTitle',
    'Left English at review (refill 2): The title is built from English document type labels.',
  ],
  [
    'appApplicant.appApplicantIdDocumentsNeedsDecision.openDocumentTitle',
    'Left English at review (refill 2): The title is built from English document type labels. English document title in the spoken name.',
  ],
  [
    'appApplicant.appApplicantIdDocumentsNeedsDecision.titleHadAlreadyExpiredOnThe',
    'Left English at review (refill 2): The title is built from English document type labels. English document title.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.area',
    'Left English at review (refill 2): Wrong sense: "area" is a profile section here, the draft means a locality.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.eGPassportAddressEmployer',
    'Left English at review (refill 2): The search matches English labels only, so Bengali example words would find nothing.',
  ],
  [
    'appApplicant.appApplicantIdProfileEditor.lockedAndNotCountedTickUse',
    'Left English at review (refill 2): Names the checkbox "Use This Section", which is English.',
  ],
  [
    'appApplicant.appApplicantIdRecordPage.currentVersionMeansThisIsThe',
    'Left English at review (refill 2): Explains the "Current Version" badge, which is English.',
  ],
  [
    'appPrivacy.appPrivacyDeletionPanel.keepMyAccount',
    'Left English at review (refill 2): The other answer of the deletion confirmation is English.',
  ],
  [
    'appPrivacy.appPrivacyLargeExportPanel.expired',
    'Left English at review (refill 2): Unreachable: the panel shows only an active export.',
  ],
  [
    'appPrivacy.appPrivacyLargeExportPanel.expiresFormatdatetime',
    'Left English at review (refill 2): `formatDateTime` writes an English date.',
  ],
  [
    'appShared.appSharedGrantidPage.expiresFormattimestampdate',
    'Left English at review (refill 2): The date is formatted in English.',
  ],
  [
    'appSharingInvitations.appSharingInvitationsAcceptPage.pluralCapturedWhenInvited',
    'Left English at review (refill 2): `plural()` writes an English noun.',
  ],
  [
    'appSharingInvitations.appSharingInvitationsAcceptPage.leaveWithoutAccepting',
    'Left English at review (refill 2): The other answer, Accept Shared Access, is English.',
  ],
  [
    'appTrips.appTripsTripForms.sendAgainName',
    'Left English at review (refill 2): Spoken name of a button whose visible text "Send Again" is English.',
  ],
  [
    'appTrips.appTripsTripForms.yesRemoveName',
    'Left English at review (refill 2): Spoken name of a button whose visible text "Send Again" is English. visible "Yes, Remove" is English.',
  ],
  [
    'appTrips.appTripsTripForms.stopSharingDocumentname',
    'Left English at review (refill 2): Spoken name of a button whose visible text "Send Again" is English. visible "Stop Sharing" is English.',
  ],
  [
    'appTrips.appTripsIdPage.destinationForPurpose',
    'Left English at review (refill 2): Destination and purpose are English names.',
  ],
  [
    'appTrips.appTripsTripForms.keep',
    'Left English at review (refill 2): The other answer, "Yes, Remove", is English.',
  ],
  [
    'appTripInvitations.appTripInvitationsIdJoinedTripForms.stay',
    'Left English at review (refill 2): The other answer, "Yes, Leave This Trip", is English.',
  ],
  [
    'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.anyoneWhoHasThisLinkCan',
    'Left English at review (refill 3): The calendar test pins this privacy line out of the Bengali catalogue; releasing it is a separate decision, not a refill.',
  ],
  [
    'applicantCalendar.appApplicantIdCalendarPage.theFileWillHoldPluralAs',
    'Left English at review (refill 3): `plural()` writes an English noun ("1 event").',
  ],
  [
    'applicantEvidence.appApplicantIdEvidenceAskAboutItemForm.everyoneWhoCanReadTheShared',
    'Left English at review (refill 3): The evidence test pins this who-can-read warning out of the Bengali catalogue (its Send Question button is English).',
  ],
  [
    'applicantEvidence.appApplicantIdEvidenceRequestPanes.askedFormatmoment',
    'Left English at review (refill 3): `formatMoment` writes an English date.',
  ],
  [
    'applicantInsights.appApplicantIdInsightsPage.backsPluralJoin',
    'Left English at review (refill 3): `plural()` writes an English noun, and the joined detail names are English.',
  ],
  [
    'applicantInsights.appApplicantIdInsightsPage.backsPluralInJoin',
    'Left English at review (refill 3): `plural()` writes an English noun, and the joined detail names are English. English noun and English section labels.',
  ],
  [
    'applicantInsights.appApplicantIdInsightsPage.canBackJoin',
    'Left English at review (refill 3): The joined section labels are English.',
  ],
  [
    'applicantInsights.appApplicantIdInsightsPage.showingShownOfTotalNoun',
    'Left English at review (refill 3): The noun is passed in English ("details to check").',
  ],
  [
    'applicantMemory.appApplicantIdMemoryComparePage.compareNameThenAndNow',
    'Left English at review (refill 3): Spoken name of the Compare link; the name holds an English detail label.',
  ],
  [
    'applicantMemory.appApplicantIdMemoryComparePage.compare',
    'Left English at review (refill 3): Visible text of the same link: kept with its spoken name in one language.',
  ],
  [
    'applicantMissions.appApplicantIdMissionsCreateMissionForm.createTheCase',
    'Left English at review (refill 3): Names the action bar whose only button, "Create Case", is English.',
  ],
  [
    'applicantMissions.appApplicantIdMissionsPrepareAgainPrepareAgainForm.createTheNewCase',
    'Left English at review (refill 3): Names the action bar whose only button, "Create Case", is English. the bar\'s button "Create Case" is English.',
  ],
  [
    'applicantMissions.appApplicantIdMissionsPrepareAgainPrepareAgainForm.optional',
    'Left English at review (refill 3): Appended to an English checklist item label.',
  ],
  [
    'applicantOutputs.appApplicantIdOutputsPage.nothingToShow',
    'Left English at review (refill 3): Waits for a test: every section a summary builds today has rows or its own note, so no test can show this line yet.',
  ],
  [
    'applicantOutputs.appApplicantIdOutputsPage.preparedOnLongdayThisIsExactly',
    'Left English at review (refill 3): `longDay` writes an English date.',
  ],
  [
    'applicantOutputs.appApplicantIdOutputsPage.stepNumberOf3',
    'Left English at review (refill 3): Spoken before an English step name ("Choose a Summary").',
  ],
  [
    'applicantOutputs.appApplicantIdOutputsPage.summaryLabel',
    'Left English at review (refill 3): The summary name is English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.keepItOn',
    'Left English at review (refill 3): The other answer, "Yes, Turn Off", is English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiConnections.aifileslineButTurnedOffRightNow',
    'Left English at review (refill 3): `aiFilesLine` is English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiConnections.yes',
    'Left English at review (refill 3): Answer under an English row name (Full Numbers, Suggest Changes).',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiConnections.no',
    'Left English at review (refill 3): Answer under an English row name (Full Numbers, Suggest Changes).',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiConnections.yesButTurnedOffRightNow',
    'Left English at review (refill 3): Answer under an English row name (Full Numbers, Suggest Changes).',
  ],
  [
    'applicantSharing.appApplicantIdSharingCaseExceptions.keepItPrivate',
    'Left English at review (refill 3): The other answer, "Yes, Allow This Case", is English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingGrantAiChoice.saveAiToolsChoiceForAgencyname',
    'Left English at review (refill 3): Spoken name of a button whose visible text "Save" is English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingGrantOpButtons.keepAccess',
    'Left English at review (refill 3): The other answer, "Yes, Revoke Access", and its question are English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingGrantPane.organization',
    'Left English at review (refill 3): Suffix of a pane title whose status and actions are English.',
  ],
  [
    'applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.cancel',
    'Left English at review (refill 3): The confirmation heading, text and confirm button are English.',
  ],
  [
    'applicantTravellerManage.appApplicantIdTravellerManageTravellerManageMenu.manageName',
    'Left English at review (refill 3): Spoken name of a button whose visible text "Manage" is English.',
  ],
  [
    'collect.collectAccountAnswersPage.withdrawnFormattimestampdate',
    'Left English at review (refill 3): `formatTimestampDate` is called without the locale: English date.',
  ],
  [
    'collect.collectGuestProgress.chooseHowLongWhoMayKeep',
    'Left English at review (refill 3): `who` falls back to the English "the agency".',
  ],
  [
    'collect.collectRetentionChoice.chooseHowManyDaysAfterThis',
    'Left English at review (refill 3): `who` falls back to the English "the agency". "The agency" fallback is English.',
  ],
  [
    'collect.collectGuestFiles.saveTheItemForFilename',
    'Left English at review (refill 3): Spoken name of a button whose visible text "Save" is English.',
  ],
  [
    'collect.collectGuestProgress.yourSubmission',
    'Left English at review (refill 3): An `aria-label` value: the collect language-marking test requires Bengali to be marked, and a label cannot carry `lang`.',
  ],
  [
    'collect.collectChecklist.suggestedFromItsNameCheckIt',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion.",
  ],
  [
    'collect.collectGuestDeskFiles.agencyNoteNote',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestDeskFiles.changeItem',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestDeskFiles.filesAlreadyPlaced',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestFiles.checklistItemForFilename',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page (its Save button is English).",
  ],
  [
    'collect.collectGuestFiles.notPlacedYet',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestProgress.yourFilesAreStillBeingChecked',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestUploader.addYourFiles',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestUploader.dropFilesOrAFolderHere',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestUploader.filesToAdd',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectGuestUploader.tryAgainForName',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page.",
  ],
  [
    'collect.collectPage.addAndSendYourFiles',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page (names the English upload rail).",
  ],
  [
    'collect.collectRetentionChoice.days',
    "Left English at review (refill 3): Guest checklist page: its title, intro, retention fold and trust line are hand-written English; fill with that page's conversion. page (inside the English retention fold).",
  ],
  [
    'invitation.invitationClientInvitationOffer.done',
    'Left English at review (refill 3): Spoken after an English step name ("Sign In").',
  ],
  [
    'invitation.invitationSwitchAccount.notYou',
    'Left English at review (refill 3): Shares one line with the English button "Sign In with the Invited Email Address".',
  ],
  [
    'oauth.oauthAuthorizeAgencyConsentForm.howLong',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too.',
  ],
  [
    'oauth.oauthAuthorizeConsentForm.answerAppname',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard; names a bar of English answers.',
  ],
  [
    'oauth.oauthAuthorizePage.chooseARecord',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'oauth.oauthAuthorizePage.chooseTheRecordThisAppMay',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'oauth.oauthAuthorizePage.connectAppname',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'oauth.oauthAuthorizePage.connectForAnAgency',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'oauth.oauthAuthorizePage.orConnectItForAnAgency',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'oauth.oauthAuthorizePage.thisAppRunsOnThisComputer',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'oauth.oauthAuthorizePage.youHaveNoRecordsToConnect',
    'Left English at review (refill 3): The rest-locale guard holds the whole oauth catalogue in English (AI access consent); its choices are English too. guard.',
  ],
  [
    'payments.paymentsResultPage.purchase',
    'Left English at review (refill 3): The payment result test keeps the purchase and invoice line identical to English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiConnectionTurnOff.turnOffAppnameFromItsNext',
    'Left English at review (refill 3): The question\'s answers, "Yes, Turn Off" and Keep It On, are English; the confirmation stays one language.',
  ],
  [
    'applicantSharing.appApplicantIdSharingCaseExceptions.recipientlabelWillBeAbleToSee',
    'Left English at review (refill 3): The question\'s answers, "Yes, Turn Off" and Keep It On, are English; the confirmation stays one language. its answers "Yes, Allow This Case" and Keep It Private are English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiDrafts.showDraft',
    'Left English at review (refill 3): The copy-failure message names it in English ("Choose Show Draft").',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiDrafts.copyDraft',
    'Left English at review (refill 3): Sits next to the English Delete Draft button, and the copy message names Show Draft in English.',
  ],
  [
    'applicantSharing.appApplicantIdSharingAiDrafts.copyDraftTitle',
    'Left English at review (refill 3): Spoken name of Copy Draft, which stays English.',
  ],
  [
    'payments.paymentsResultPage.checkAgain',
    'Left English at review (refill 3): The English payment message names it ("choose Check Again").',
  ],
  [
    'payments.paymentsResultPage.goToPlanUsage',
    'Left English at review (refill 3): The English payment message names it ("go back to Plan & Usage").',
  ],
  [
    'applicantMissions.appApplicantIdMissionsCreateMissionForm.notSureYet',
    'Left English at review (refill 3): Also an option of the English purpose list, under an English question.',
  ],
  [
    'applicantInsights.appApplicantIdInsightsPage.openDocuments',
    'Left English at review (refill 3): The Details to Check card on the same page writes Open Documents in English.',
  ],
]);
