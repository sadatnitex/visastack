import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-agency surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appAgencyCatalog = defineCatalog({
  en: {
    'appAgency.appAgencyCreateOrgForm.organizationName': 'Organization name',
    'appAgency.appAgencyOrgidActivityPage.caseActivity': 'Case Activity',
    'appAgency.appAgencyOrgidActivityPage.caseActivityEntries': 'Case Activity Entries',
    'appAgency.appAgencyOrgidActivityPage.casesInThisActivity': 'Cases in this activity',
    'appAgency.appAgencyOrgidActivityPage.newCaseNotesAppearHereWhen':
      'New case notes appear here when your team records them on an accessible case.',
    'appAgency.appAgencyOrgidActivityPage.noCaseActivityRecorded': 'No Case Activity Recorded',
    'appAgency.appAgencyOrgidActivityPage.openACase': 'Open a case:',
    'appAgency.appAgencyOrgidActivityPage.recentNotesOnCasesYouCan':
      'Recent notes on cases you can access. This is case activity, not a complete organization audit log.',
    'appAgency.appAgencyOrgidActivityPage.showingNotesFromTheTenMost':
      'Showing notes from the ten most recently updated accessible cases. Open a case for its full history.',
    'appAgency.appAgencyOrgidAgencyAiSettingForm.iConfirmThisStatementForOrganizationname':
      'I Confirm This Statement for {organizationName}',
    'appAgency.appAgencyOrgidAgencyAiSettingForm.statement': 'Statement',
    'appAgency.appAgencyOrgidAgencyAiTurnOff.ended': 'Ended',
    'appAgency.appAgencyOrgidAgencyAiTurnOff.turnOffApplabel': 'Turn Off {appLabel}',
    'appAgency.appAgencyOrgidAiConnectionsPage.aiConnections': 'AI Connections',
    'appAgency.appAgencyOrgidAiConnectionsPage.aiTools': 'AI Tools',
    'appAgency.appAgencyOrgidAiConnectionsPage.anOwnerOrAdminCanConnect':
      'An owner or admin can connect one from the AI app, once AI Connections for This Agency is on in Settings.',
    'appAgency.appAgencyOrgidAiConnectionsPage.eachAppReadsForEachCase':
      'Each app reads, for each case its owner or admin can see, only what that case’s traveller allowed this agency’s AI tools to read. It works for at most 30 days.',
    'appAgency.appAgencyOrgidAiConnectionsPage.noAiAppsConnected': 'No AI Apps Connected',
    'appAgency.appAgencyOrgidBrandingForm.087a68': '#087a68',
    'appAgency.appAgencyOrgidBrandingForm.accentColour': 'Accent Colour',
    'appAgency.appAgencyOrgidBrandingForm.accentColourAsASixDigit':
      'Accent colour as a six-digit code',
    'appAgency.appAgencyOrgidBrandingForm.agencyName': 'Agency Name',
    'appAgency.appAgencyOrgidBrandingForm.agencyWorkspace': 'Agency Workspace',
    'appAgency.appAgencyOrgidBrandingForm.chooseAColour': 'Choose a colour',
    'appAgency.appAgencyOrgidBrandingForm.howItLooks': 'How It Looks',
    'appAgency.appAgencyOrgidBrandingForm.howYourAgencyWillLook': 'How your agency will look',
    'appAgency.appAgencyOrgidBrandingForm.logo': 'Logo',
    'appAgency.appAgencyOrgidBrandingForm.logoImagePngOrJpeg': 'Logo image (PNG or JPEG)',
    'appAgency.appAgencyOrgidBrandingForm.noLogoYetYourInitialsShow':
      'No logo yet. Your initials show instead.',
    'appAgency.appAgencyOrgidBrandingForm.pngOrJpegUpTo2':
      'PNG or JPEG, up to 2 MB. A square or wide logo both work. It sits on a white tile, so a logo with a see-through background looks clean. It is checked to be a real PNG or JPEG image before anyone sees it.',
    'appAgency.appAgencyOrgidBrandingForm.poweredByVisastack': 'Powered by VisaStack',
    'appAgency.appAgencyOrgidBrandingForm.travellersSeeThisOnInvitationsFrom':
      'Travellers see this on invitations from you. Your team sees it at the top of the workspace.',
    'appAgency.appAgencyOrgidBrandingForm.usedForYourMarkAndHighlights':
      'Used for your mark and highlights. Pick one, or type a colour. It must be easy to read on white. Leave it empty to use the VisaStack green.',
    'appAgency.appAgencyOrgidBrandingForm.yourLogoAsItAppears': 'Your logo, as it appears.',
    'appAgency.appAgencyOrgidCaseSearchForm.anyStage': 'Any Stage',
    'appAgency.appAgencyOrgidCaseSearchForm.anyone': 'Anyone',
    'appAgency.appAgencyOrgidCaseSearchForm.assignee': 'Assignee',
    'appAgency.appAgencyOrgidCaseSearchForm.clear': 'Clear',
    'appAgency.appAgencyOrgidCaseSearchForm.clientNameCaseTitleOrCase':
      'Client name, case title, or case ID',
    'appAgency.appAgencyOrgidCaseSearchForm.destination': 'Destination',
    'appAgency.appAgencyOrgidCaseSearchForm.search': 'Search',
    'appAgency.appAgencyOrgidCaseSearchForm.stage': 'Stage',
    'appAgency.appAgencyOrgidCaseTriageSummary.dueDue': 'Due {due}',
    'appAgency.appAgencyOrgidCaseTriageSummary.itemsAskedOfTheTravellerAre':
      'Items asked of the traveller are shown to agency administrators.',
    'appAgency.appAgencyOrgidCaseTriageSummary.nothingHasBeenAskedForOr':
      'Nothing has been asked for or checked yet.',
    'appAgency.appAgencyOrgidCaseTriageSummary.whereThingsStand': 'Where Things Stand',
    'appAgency.appAgencyOrgidCasesListPager.showOlderEntries': 'Show Older Entries',
    'appAgency.appAgencyOrgidCasesPage.aboutCases': 'About Cases',
    'appAgency.appAgencyOrgidCasesPage.askForADocumentOrDetail': 'Ask for a Document or Detail',
    'appAgency.appAgencyOrgidCasesPage.assignATeamMemberAndLeave':
      'Assign a team member and leave case notes on any case this organization has a grant for.',
    'appAgency.appAgencyOrgidCasesPage.cases': 'Cases',
    'appAgency.appAgencyOrgidCasesPage.chooseACaseToOpenIts':
      'Choose a case to open its workspace: its team, notes, tasks and appointments.',
    'appAgency.appAgencyOrgidCasesPage.collaborate': 'Collaborate',
    'appAgency.appAgencyOrgidCasesPage.deadlineFormatdateonly': ' · deadline {formatDateOnly}',
    'appAgency.appAgencyOrgidCasesPage.leaveCaseNotesAndRecordDecisions':
      "Leave case notes and record decisions on cases you're assigned to.",
    'appAgency.appAgencyOrgidCasesPage.noCasesAreReachableYetA':
      'No cases are reachable yet - a traveller must grant this organization access to a specific case.',
    'appAgency.appAgencyOrgidCasesPage.noCasesYet': 'No Cases Yet',
    'appAgency.appAgencyOrgidCasesPage.openCase': 'Open Case',
    'appAgency.appAgencyOrgidCasesPage.openCasedd4d13': 'Open case',
    'appAgency.appAgencyOrgidCasesPage.openNow': 'Open Now',
    'appAgency.appAgencyOrgidCasesPage.thatCaseIsNotOpenTo':
      'That case is not open to you. It may no longer be shared with this organization, or you may not be assigned to it. Choose a case from the list.',
    'appAgency.appAgencyOrgidCasesPage.youArenTAssignedToAny':
      "You aren't assigned to any cases yet. An owner or admin of this organization can assign you to one.",
    'appAgency.appAgencyOrgidChecklistsChecklistForms.documentType': 'Document Type',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.howNecessary': 'How Necessary',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.makeItOurOwnName': 'Make It Our Own: {name}',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.optional': 'Optional',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.recommended': 'Recommended',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.required': 'Required',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.whatTheTravellerReads':
      'What the Traveller Reads',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.whoItIsFor': 'Who It Is For',
    'appAgency.appAgencyOrgidChecklistsEditPage.aChangeIsReadyButNot':
      'A change is ready but not published yet. Publish it to finish.',
    'appAgency.appAgencyOrgidChecklistsEditPage.addAnItem': 'Add an Item',
    'appAgency.appAgencyOrgidChecklistsEditPage.casesOnYourAgencyOfferThis':
      'Cases on your agency offer this version. Open a draft to change it.',
    'appAgency.appAgencyOrgidChecklistsEditPage.draftVersionVersion': 'Draft, Version {version}',
    'appAgency.appAgencyOrgidChecklistsEditPage.finish': 'Finish',
    'appAgency.appAgencyOrgidChecklistsEditPage.forInterpretation': 'For: {interpretation}',
    'appAgency.appAgencyOrgidChecklistsEditPage.items': 'Items',
    'appAgency.appAgencyOrgidChecklistsEditPage.ourList': 'Our List',
    'appAgency.appAgencyOrgidChecklistsEditPage.publishedVersionVersion':
      'Published, Version {version}',
    'appAgency.appAgencyOrgidChecklistsEditPage.readyToPublishVersionVersion':
      'Ready to Publish, Version {version}',
    'appAgency.appAgencyOrgidChecklistsEditPage.thisListHasNoItemsYet':
      'This list has no items yet.',
    'appAgency.appAgencyOrgidChecklistsEditPage.youAreChangingADraftCases':
      'You are changing a draft. Cases keep the published version until you publish.',
    'appAgency.appAgencyOrgidChecklistsPage.checklists': 'Checklists',
    'appAgency.appAgencyOrgidChecklistsPage.country': 'Country',
    'appAgency.appAgencyOrgidChecklistsPage.makeACountryListYourOwn':
      'Make a country list your own. Your cases offer your version, and the shared one stays as it is.',
    'appAgency.appAgencyOrgidChecklistsPage.noSharedListMatches': 'No shared list matches.',
    'appAgency.appAgencyOrgidChecklistsPage.openOurCopy': 'Open Our Copy',
    'appAgency.appAgencyOrgidChecklistsPage.ourLists': 'Our Lists',
    'appAgency.appAgencyOrgidChecklistsPage.showingTheFirstLengthSearchBy':
      'Showing the first {length}. Search by country to narrow the list.',
    'appAgency.appAgencyOrgidChecklistsPage.startFromASharedList': 'Start from a Shared List',
    'appAgency.appAgencyOrgidChecklistsPage.starterListNotOfficial': 'Starter List, Not Official',
    'appAgency.appAgencyOrgidChecklistsPage.youHaveNoListsOfYour':
      'You have no lists of your own yet. Start from a shared list below.',
    'appAgency.appAgencyOrgidClientInvitationForm.addAtLeastOneActiveTeam':
      'Add at least one active team member before inviting a client.',
    'appAgency.appAgencyOrgidClientInvitationForm.caseOwner': 'Case Owner',
    'appAgency.appAgencyOrgidClientInvitationForm.clientEmailAddress': 'Client Email Address',
    'appAgency.appAgencyOrgidClientInvitationForm.janeExampleCom': 'jane@example.com',
    'appAgency.appAgencyOrgidClientInvitationForm.janeTraveller': 'Jane Traveller',
    'appAgency.appAgencyOrgidClientInvitationForm.onlyThatEmailAddressCanAccept':
      'Only that email address can accept.',
    'appAgency.appAgencyOrgidClientInvitationForm.requestedRouteOptional':
      'Requested Route (Optional)',
    'appAgency.appAgencyOrgidClientInvitationForm.travellerName': 'Traveller Name',
    'appAgency.appAgencyOrgidClientInvitationForm.usB1B2BusinessVisa': 'US B1/B2 business visa',
    'appAgency.appAgencyOrgidClientsPage.aboutInvitations': 'About Invitations',
    'appAgency.appAgencyOrgidClientsPage.aboutRequests': 'About Requests',
    'appAgency.appAgencyOrgidClientsPage.activity': 'Activity',
    'appAgency.appAgencyOrgidClientsPage.addPeopleAndRequests': 'Add People and Requests',
    'appAgency.appAgencyOrgidClientsPage.all': 'All',
    'appAgency.appAgencyOrgidClientsPage.askATravellerForASpecific':
      'Ask a traveller for a specific detail or document. They decide whether to fulfil it.',
    'appAgency.appAgencyOrgidClientsPage.cannotBeAcceptedRevokeAndInvite':
      'Cannot be accepted · revoke and invite again by email',
    'appAgency.appAgencyOrgidClientsPage.clients': 'Clients',
    'appAgency.appAgencyOrgidClientsPage.collect': 'Collect',
    'appAgency.appAgencyOrgidClientsPage.document': 'Document',
    'appAgency.appAgencyOrgidClientsPage.dueFormatdateonly': ' · due {formatDateOnly}',
    'appAgency.appAgencyOrgidClientsPage.evidenceRequests': 'Evidence Requests',
    'appAgency.appAgencyOrgidClientsPage.evidenceRequestsByStatus': 'Evidence requests by status',
    'appAgency.appAgencyOrgidClientsPage.expiredFormattimestampdateInviteAgain':
      'Expired {formatTimestampDate} · invite again',
    'appAgency.appAgencyOrgidClientsPage.field': 'Field',
    'appAgency.appAgencyOrgidClientsPage.forPeopleWhoAreAlreadyYour':
      'For people who are already your clients.',
    'appAgency.appAgencyOrgidClientsPage.intake': 'Intake',
    'appAgency.appAgencyOrgidClientsPage.inviteAClient': 'Invite a Client',
    'appAgency.appAgencyOrgidClientsPage.inviteATravellerAsANew':
      'Invite a traveller as a new client. They alone choose which of their own traveller profiles the resulting case attaches to, and their acceptance is what actually grants this organization access, never the invitation itself.',
    'appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate':
      'Invited · expires {formatTimestampDate}',
    'appAgency.appAgencyOrgidClientsPage.invitingClientsAndRequestingEvidenceAre':
      "Inviting clients and requesting evidence are limited to this organization's owners and admins.",
    'appAgency.appAgencyOrgidClientsPage.noClientsInvitedYet': 'No Clients Invited Yet',
    'appAgency.appAgencyOrgidClientsPage.noEvidenceRequestsYet': 'No Evidence Requests Yet',
    'appAgency.appAgencyOrgidClientsPage.noRequestsInThisView': 'No requests in this view.',
    'appAgency.appAgencyOrgidClientsPage.pendingInvitations': 'Pending Invitations',
    'appAgency.appAgencyOrgidClientsPage.requestEvidence': 'Request Evidence',
    'appAgency.appAgencyOrgidClientsPage.requestReference': 'Request Reference',
    'appAgency.appAgencyOrgidClientsPage.theRequestYouFollowedALink':
      'The request you followed a link to',
    'appAgency.appAgencyOrgidClientsPage.thisIsWhereYouAskA':
      'This is where you ask a client for a specific document or detail. You will see here when it arrives and when it is overdue.',
    'appAgency.appAgencyOrgidClientsPage.thisIsWhereYouInviteThe':
      'This is where you invite the people you help. Each one gets a link, creates their file, and chooses what to share with you. Start with the form below.',
    'appAgency.appAgencyOrgidCollectionCollectionForms.checklistToFollow': 'Checklist to Follow',
    'appAgency.appAgencyOrgidCollectionCollectionForms.chooseACountry': 'Choose a Country',
    'appAgency.appAgencyOrgidCollectionCollectionForms.countryOfResidence': 'Country of Residence',
    'appAgency.appAgencyOrgidCollectionCollectionForms.destination': 'Destination',
    'appAgency.appAgencyOrgidCollectionCollectionForms.dueDate': 'Due Date',
    'appAgency.appAgencyOrgidCollectionCollectionForms.email': 'Email',
    'appAgency.appAgencyOrgidCollectionCollectionForms.emailAddress': 'Email Address',
    'appAgency.appAgencyOrgidCollectionCollectionForms.forYourOwnReferenceOnlyNothing':
      'For your own reference only. Nothing here is shown to anyone who opens the link.',
    'appAgency.appAgencyOrgidCollectionCollectionForms.howNecessary': 'How Necessary',
    'appAgency.appAgencyOrgidCollectionCollectionForms.howNecessaryLabel': 'How Necessary: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.itemYourAgencyNeeds':
      'Item Your Agency Needs',
    'appAgency.appAgencyOrgidCollectionCollectionForms.moveDownLabel': 'Move Down: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.moveUpLabel': 'Move Up: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.name': 'Name',
    'appAgency.appAgencyOrgidCollectionCollectionForms.nationality': 'Nationality',
    'appAgency.appAgencyOrgidCollectionCollectionForms.notSureYet': 'Not Sure Yet',
    'appAgency.appAgencyOrgidCollectionCollectionForms.noteLabel': 'Note: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.noteToThePersonOptional':
      'Note to the Person (Optional)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.purpose': 'Purpose',
    'appAgency.appAgencyOrgidCollectionCollectionForms.removeLabel': 'Remove: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.saveNecessityLabel':
      'Save Necessity: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.saveNoteLabel': 'Save Note: {label}',
    'appAgency.appAgencyOrgidCollectionCollectionForms.specificRouteOptional':
      'Specific Route (Optional)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.theEmailNamesYourAgencyOnly':
      'The email names your agency only once VisaStack has reviewed it, and never the route, the documents or the person.',
    'appAgency.appAgencyOrgidCollectionCollectionForms.travelFromOptional':
      'Travel from (Optional)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.travelToOptional': 'Travel to (Optional)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whatYouAlreadyKnowOptional':
      'What You Already Know (Optional)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whereAndWhy': 'Where and Why',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whereTheyApply': 'Where They Apply',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whoItIsForOptional':
      'Who It Is for (Optional)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.withAPurposeThePublishedOfficial':
      "With a purpose, the published official checklist that fits is proposed. Not Sure Yet starts your agency's own checklist.",
    'appAgency.appAgencyOrgidCollectionCollectionForms.yourAgencySOwnChecklist':
      "Your Agency's Own Checklist",
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.copyLink': 'Copy Link',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.privateRequestLink':
      'Private Request Link',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.thisLinkIsShownOnlyOnce':
      'This link is shown only once. Opening WhatsApp prepares a message; you choose whether to send it, and VisaStack cannot see whether it was sent. Revoking the request stops the link.',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.visastackRequest': 'VisaStack Request',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.aLegalHoldKeepsTheGuest':
      'A legal hold keeps the guest files of this request past the periods the guests chose. Reason: {reason}',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.answers': 'Answers',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.checkedForViruses':
      'checked for viruses',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.downloadTitle': 'Download {title}',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.eachAnswerHoldsOnlyWhatThe':
      'Each answer holds only what the person chose, exactly as it was when they sent it. Files download as the originals, after you confirm it is you.',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.fileCheckedNotScannedForViruses':
      'file checked, not scanned for viruses',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.guestFilesAreDeletedWhenThe':
      'Guest files are deleted when the period each guest chose ends after this request closes. A legal hold keeps them until you release it.',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.keepingGuestFiles':
      'Keeping Guest Files',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.noAnswersYetAPersonWho':
      'No answers yet. A person who answers through your link, signed in or without an account, appears here with exactly what they chose to send.',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.protectedDetail': 'Protected Detail',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.stillMissing': 'Still Missing',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.thatFileCannotBeDownloadedRight':
      'That file cannot be downloaded right now. The person may have withdrawn or changed their answer, or the file is still being checked.',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.thisAnswerHasChangedSinceIt':
      'This answer has changed since it was sent, usually because the person removed a file from their record. Ask them to answer again.',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.thisSubmissionNoLongerMatchesWhat':
      'This submission no longer matches what was sent, so its files are not offered.',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.titleVersionVersionnumber':
      '{title}, Version {versionNumber}',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.withoutAnAccountGuestGuestnoSubmission':
      'Without an Account: Guest {guestNo}, Submission {submissionNo}',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.addNotesForThePerson':
      'Add Notes for the Person',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.generalNote': 'General Note',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.noteOnLabel': 'Note on {label}',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.reasonForTheHold':
      'Reason for the Hold',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.yourDecision': 'Your Decision',
    'appAgency.appAgencyOrgidCollectionNewPage.documentRequests': 'Document Requests',
    'appAgency.appAgencyOrgidCollectionNewPage.newDocumentRequest': 'New Document Request',
    'appAgency.appAgencyOrgidCollectionNewPage.noAccountOrProfileIsNeeded':
      'No account or profile is needed yet. You review the checklist before anything is sent.',
    'appAgency.appAgencyOrgidCollectionPage.acceptedAccepted': '{accepted} Accepted',
    'appAgency.appAgencyOrgidCollectionPage.allAnswers': 'All Answers',
    'appAgency.appAgencyOrgidCollectionPage.created': 'Created',
    'appAgency.appAgencyOrgidCollectionPage.documentRequestsNewestFirst':
      'Document Requests, Newest First',
    'appAgency.appAgencyOrgidCollectionPage.for': 'For',
    'appAgency.appAgencyOrgidCollectionPage.forPeopleWhoAreNotYour':
      'For people who are not your clients yet. Nothing is shared until they choose to respond.',
    'appAgency.appAgencyOrgidCollectionPage.needscorrectionNeedsCorrection':
      '{needsCorrection} Needs Correction',
    'appAgency.appAgencyOrgidCollectionPage.newRequest': 'New Request',
    'appAgency.appAgencyOrgidCollectionPage.noAnswersYet': 'No Answers Yet',
    'appAgency.appAgencyOrgidCollectionPage.noDocumentRequestsYet': 'No Document Requests Yet',
    'appAgency.appAgencyOrgidCollectionPage.noRequestsMatchBothFiltersTurn':
      'No requests match both filters. Turn one of them off to see more.',
    'appAgency.appAgencyOrgidCollectionPage.notNamedYet': 'Not Named Yet',
    'appAgency.appAgencyOrgidCollectionPage.nothingIsWaitingForReviewNow':
      'Nothing is waiting for review now.',
    'appAgency.appAgencyOrgidCollectionPage.showRequestsByAnswers': 'Show requests by answers',
    'appAgency.appAgencyOrgidCollectionPage.showRequestsByStatus': 'Show requests by status',
    'appAgency.appAgencyOrgidCollectionPage.showingYourNewestCollectionListLimit':
      'Showing your newest {COLLECTION_LIST_LIMIT} requests, and the filters and counts below cover only these. Close requests you no longer need.',
    'appAgency.appAgencyOrgidCollectionPage.startOneWithNewRequestYou':
      'Start one with New Request. You can issue it as a private link or by email.',
    'appAgency.appAgencyOrgidCollectionPage.status': 'Status',
    'appAgency.appAgencyOrgidCollectionPage.waitingForReview': 'Waiting for Review',
    'appAgency.appAgencyOrgidCollectionPage.waitingWaitingForReview':
      '{waiting} Waiting for Review',
    'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.ifAnOfficialItemLooksMissing':
      'If an official item looks missing, out of date or wrong, tell VisaStack. Pack editors check it against the official source; nothing changes until a corrected version is published.',
    'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.officialChecklistUpdates':
      'Official Checklist Updates',
    'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.suggestAChecklistCorrection':
      'Suggest a Checklist Correction',
    'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.thisRequestFollowsTheNewestPublished':
      'This request follows the newest published official checklist.',
    'appAgency.appAgencyOrgidCollectionRequestPage.aboutThisRequest': 'About This Request',
    'appAgency.appAgencyOrgidCollectionRequestPage.addAnItem': 'Add an Item',
    'appAgency.appAgencyOrgidCollectionRequestPage.checklist': 'Checklist',
    'appAgency.appAgencyOrgidCollectionRequestPage.closeItWhenYouHaveWhat':
      'Close it when you have what you need, or revoke it to withdraw it. Either way every link stops working.',
    'appAgency.appAgencyOrgidCollectionRequestPage.copiedLink': 'Copied Link',
    'appAgency.appAgencyOrgidCollectionRequestPage.documentRequest': 'Document Request:',
    'appAgency.appAgencyOrgidCollectionRequestPage.due': 'Due',
    'appAgency.appAgencyOrgidCollectionRequestPage.endThisRequest': 'End This Request',
    'appAgency.appAgencyOrgidCollectionRequestPage.expires': 'Expires',
    'appAgency.appAgencyOrgidCollectionRequestPage.followingThePublishedOfficialChecklistPackname':
      "Following the published official checklist {packName} (Version {version}). Official items keep the necessity their source gives them; items you add are shown as your agency's own.",
    'appAgency.appAgencyOrgidCollectionRequestPage.issue': 'Issue',
    'appAgency.appAgencyOrgidCollectionRequestPage.issueAgain': 'Issue Again',
    'appAgency.appAgencyOrgidCollectionRequestPage.issuedRevisions': 'Issued Revisions',
    'appAgency.appAgencyOrgidCollectionRequestPage.issuingFreezesThisChecklistAsA':
      'Issuing freezes this checklist as a numbered revision that never changes, and makes a private link. Issuing again replaces older links with one for the new revision.',
    'appAgency.appAgencyOrgidCollectionRequestPage.knownDetails': 'Known Details',
    'appAgency.appAgencyOrgidCollectionRequestPage.lastOpened': 'Last Opened',
    'appAgency.appAgencyOrgidCollectionRequestPage.links': 'Links',
    'appAgency.appAgencyOrgidCollectionRequestPage.linksMadeForThisRequestNewest':
      'Links Made for This Request, Newest First',
    'appAgency.appAgencyOrgidCollectionRequestPage.noDueDate': 'No Due Date',
    'appAgency.appAgencyOrgidCollectionRequestPage.noItemsYetAddWhatYour':
      'No items yet. Add what your agency needs below.',
    'appAgency.appAgencyOrgidCollectionRequestPage.noPublishedOfficialChecklistFitsThis':
      "No published official checklist fits this destination and purpose, so the request uses your agency's own checklist.",
    'appAgency.appAgencyOrgidCollectionRequestPage.noneGiven': 'None Given',
    'appAgency.appAgencyOrgidCollectionRequestPage.notGiven': 'Not Given',
    'appAgency.appAgencyOrgidCollectionRequestPage.notYet': 'Not Yet',
    'appAgency.appAgencyOrgidCollectionRequestPage.noteNote': 'Note: {note}',
    'appAgency.appAgencyOrgidCollectionRequestPage.officialChecklistsThatFit':
      'Official Checklists That Fit',
    'appAgency.appAgencyOrgidCollectionRequestPage.revision': 'Revision',
    'appAgency.appAgencyOrgidCollectionRequestPage.sendByEmail': 'Send by Email',
    'appAgency.appAgencyOrgidCollectionRequestPage.sentBy': 'Sent By',
    'appAgency.appAgencyOrgidCollectionRequestPage.share': 'Share',
    'appAgency.appAgencyOrgidCollectionRequestPage.specificRoute': 'Specific Route',
    'appAgency.appAgencyOrgidCollectionRequestPage.state': 'State',
    'appAgency.appAgencyOrgidCollectionRequestPage.thePersonOpensTheLinkAnd':
      'The person opens the link and confirms it is them with a one-time code sent to the email address you entered, or by signing in. They then see this exact checklist, add their files and choose Submit Documents. Nothing reaches you before that. Each file can be up to {uploadLimitLabel}.',
    'appAgency.appAgencyOrgidCollectionRequestPage.thisDraftCannotBeReadStart':
      'This draft cannot be read. Start a new request instead.',
    'appAgency.appAgencyOrgidCollectionRequestPage.thisRevisionNoLongerMatchesWhat':
      'This revision no longer matches what was issued, so it is not shown. Tell VisaStack support.',
    'appAgency.appAgencyOrgidCollectionRequestPage.toFormatdateonly': ' to {formatDateOnly}',
    'appAgency.appAgencyOrgidCollectionRequestPage.travelDates': 'Travel Dates',
    'appAgency.appAgencyOrgidCollectionRequestPage.tryingAgain': '(Trying Again)',
    'appAgency.appAgencyOrgidCollectionRequestPage.yourAgencySOwnChecklistIt':
      "Your agency's own checklist. It is not an official checklist, and the person sees it as requested by your agency.",
    'appAgency.appAgencyOrgidDoNextList.doNext': 'Do Next',
    'appAgency.appAgencyOrgidDoNextList.filteredView': 'Filtered View',
    'appAgency.appAgencyOrgidDoNextList.forTheCasesInYourCurrent':
      'For the cases in your current view. ',
    'appAgency.appAgencyOrgidDoNextList.howThisIsSorted': 'How This Is Sorted',
    'appAgency.appAgencyOrgidDoNextList.notTiedToOneCase': ' · Not tied to one case',
    'appAgency.appAgencyOrgidDoNextList.nothingNeedsYouFirstRightNow':
      'Nothing needs you first right now.',
    'appAgency.appAgencyOrgidDoNextList.overdueTasksOnTheCasesAssigned':
      'Overdue tasks on the cases assigned to you, most overdue first.',
    'appAgency.appAgencyOrgidDoNextList.owner': 'Owner',
    'appAgency.appAgencyOrgidDoNextList.pastDueItemsFirstThenRequests':
      'Past due items first, then requests with no reply after {CHASE_AFTER_DAYS} days, items waiting for review, overdue tasks and cases with no owner.',
    'appAgency.appAgencyOrgidDoNextList.quiethiddenMoreAgreeHadNoReply':
      '{quietHidden} more {agree} had no reply',
    'appAgency.appAgencyOrgidDoNextList.showingLengthOfLength2TheRest':
      'Showing {length} of {length2}. The rest are in the case list below.',
    'appAgency.appAgencyOrgidDoNextList.why': 'Why',
    'appAgency.appAgencyOrgidEvidenceCopies.aboutDownloading': 'About Downloading',
    'appAgency.appAgencyOrgidEvidenceCopies.aboutThisSend': 'About This Send',
    'appAgency.appAgencyOrgidEvidenceCopies.acceptedCopy': 'Accepted Copy',
    'appAgency.appAgencyOrgidEvidenceCopies.cannotBeOpenedRightNow': 'Cannot be opened right now.',
    'appAgency.appAgencyOrgidEvidenceCopies.copyWaitingForYourDecision':
      'Copy Waiting for Your Decision',
    'appAgency.appAgencyOrgidEvidenceCopies.decidedFormatmoment': ' · Decided {formatMoment}',
    'appAgency.appAgencyOrgidEvidenceCopies.downloadSentFile': 'Download Sent File',
    'appAgency.appAgencyOrgidEvidenceCopies.downloadsTheOriginalYouConfirmIt':
      'Downloads the original. You confirm it is you first.',
    'appAgency.appAgencyOrgidEvidenceCopies.earlierSendsEarliercount':
      'Earlier Sends ({earlierCount})',
    'appAgency.appAgencyOrgidEvidenceCopies.fingerprint': 'Fingerprint',
    'appAgency.appAgencyOrgidEvidenceCopies.receivedIsNotAccepted': 'Received is not Accepted.',
    'appAgency.appAgencyOrgidEvidenceCopies.sendRoundnoTitle': 'Send {roundNo}: {title}',
    'appAgency.appAgencyOrgidEvidenceCopies.sendTimeNotKept': 'Send time not kept',
    'appAgency.appAgencyOrgidEvidenceCopies.sentFormatmoment': 'Sent {formatMoment}',
    'appAgency.appAgencyOrgidEvidenceCopies.thisCopyCannotBeOpenedFrom':
      'This copy cannot be opened from here right now. It may still be being checked, or access may have ended.',
    'appAgency.appAgencyOrgidEvidenceCopies.thisSendHasNoExactCopy':
      'This send has no exact copy to open here. Accept it or send it back below.',
    'appAgency.appAgencyOrgidEvidenceCopies.waitingForADecision': 'Waiting for a Decision',
    'appAgency.appAgencyOrgidEvidenceCopies.whyNot': 'Why Not?',
    'appAgency.appAgencyOrgidEvidenceCopies.yourReasonShownToTheTraveller':
      'Your reason, shown to the traveller: {reason}',
    'appAgency.appAgencyOrgidEvidencePicker.anyOneOfThese': 'Any One of These',
    'appAgency.appAgencyOrgidEvidencePicker.askForAllMissingLength':
      'Ask for All Missing ({length})',
    'appAgency.appAgencyOrgidEvidencePicker.chooseAsManyAsYouNeed':
      'Choose as many as you need, then send them together.',
    'appAgency.appAgencyOrgidEvidencePicker.forExampleNidTradeLicenceSolvency':
      'For example: NID, trade licence, solvency',
    'appAgency.appAgencyOrgidEvidencePicker.lengthOfLength2': '{length} of {length2}',
    'appAgency.appAgencyOrgidEvidencePicker.missingForThisCase': 'Missing for This Case',
    'appAgency.appAgencyOrgidEvidencePicker.noMatches': 'No matches.',
    'appAgency.appAgencyOrgidEvidencePicker.nothingMatchesTrimNotInThe':
      'Nothing matches “{trim}”. Not in the list? Choose Other Document and explain in the message.',
    'appAgency.appAgencyOrgidEvidencePicker.onlyTheFirstMaxAskItems':
      'Only the first {MAX_ASK_ITEMS} are ticked. Send these, then ask for the rest.',
    'appAgency.appAgencyOrgidEvidencePicker.pickedSelected': ', {picked} selected',
    'appAgency.appAgencyOrgidEvidencePicker.searchDocumentsAndDetails':
      'Search Documents and Details',
    'appAgency.appAgencyOrgidEvidencePicker.theTravellerNeedsOnlyOneOf':
      'The traveller needs only one of these.',
    'appAgency.appAgencyOrgidEvidencePicker.totalMatches': '{total} matches.',
    'appAgency.appAgencyOrgidEvidenceRequestActions.contradiction': 'Contradiction',
    'appAgency.appAgencyOrgidEvidenceRequestActions.moreDecisions': 'More Decisions',
    'appAgency.appAgencyOrgidEvidenceRequestActions.needsReplacement': 'Needs Replacement',
    'appAgency.appAgencyOrgidEvidenceRequestActions.proposeCorrection': 'Propose Correction',
    'appAgency.appAgencyOrgidEvidenceRequestActions.reason': 'Reason',
    'appAgency.appAgencyOrgidEvidenceRequestActions.refresh': 'Refresh',
    'appAgency.appAgencyOrgidEvidenceTray.clearAll': 'Clear All',
    'appAgency.appAgencyOrgidEvidenceTray.detail': 'Detail',
    'appAgency.appAgencyOrgidEvidenceTray.maxAskItemsIsTheMost':
      '{MAX_ASK_ITEMS} is the most in one send.',
    'appAgency.appAgencyOrgidEvidenceTray.nothingSelectedYetTickWhatYou':
      'Nothing selected yet. Tick what you need above.',
    'appAgency.appAgencyOrgidEvidenceTray.remove': 'Remove',
    'appAgency.appAgencyOrgidEvidenceTray.selectedLength': 'Selected ({length})',
    'appAgency.appAgencyOrgidFollowUpCopy.followUp': 'Follow-Up',
    'appAgency.appAgencyOrgidFollowUpCopy.messageToCopy': 'Message to Copy',
    'appAgency.appAgencyOrgidFollowUpCopy.readItFirstItIsNot':
      'Read it first. It is not sent for you: send it from WhatsApp, or paste it into your own email or message.',
    'appAgency.appAgencyOrgidFollowUpCopy.yourNoteWasLeftOutBecause':
      'Your note was left out because it has a link, an email address or a long number. The standard wording is used instead.',
    'appAgency.appAgencyOrgidLayout.youDonTHaveARole':
      "You don't have a role in this organization. Ask an owner or admin to add you as a member.",
    'appAgency.appAgencyOrgidMemberForm.admin': 'Admin',
    'appAgency.appAgencyOrgidMemberForm.caseManager': 'Case Manager',
    'appAgency.appAgencyOrgidMemberForm.memberEmail': 'Member Email',
    'appAgency.appAgencyOrgidMemberForm.reviewer': 'Reviewer',
    'appAgency.appAgencyOrgidMemberForm.role': 'Role',
    'appAgency.appAgencyOrgidMemberForm.teammateExampleCom': 'teammate@example.com',
    'appAgency.appAgencyOrgidMissionCollaboration.accept': 'Accept',
    'appAgency.appAgencyOrgidMissionCollaboration.addACaseNote': 'Add a case note…',
    'appAgency.appAgencyOrgidMissionCollaboration.addATask': 'Add a task…',
    'appAgency.appAgencyOrgidMissionCollaboration.appointmentTitle': 'Appointment Title',
    'appAgency.appAgencyOrgidMissionCollaboration.appointmentTitle1de530': 'Appointment title',
    'appAgency.appAgencyOrgidMissionCollaboration.appointments': 'Appointments',
    'appAgency.appAgencyOrgidMissionCollaboration.assignAMember': 'Assign a member…',
    'appAgency.appAgencyOrgidMissionCollaboration.assigned': 'Assigned',
    'appAgency.appAgencyOrgidMissionCollaboration.caseNote': 'Case Note',
    'appAgency.appAgencyOrgidMissionCollaboration.caseNotea939f0': 'Case note',
    'appAgency.appAgencyOrgidMissionCollaboration.caseReference': 'Case Reference',
    'appAgency.appAgencyOrgidMissionCollaboration.channel': 'Channel',
    'appAgency.appAgencyOrgidMissionCollaboration.confirmed': 'Confirmed',
    'appAgency.appAgencyOrgidMissionCollaboration.contactMethod': 'Contact Method',
    'appAgency.appAgencyOrgidMissionCollaboration.contactMethoda30e73': 'Contact method',
    'appAgency.appAgencyOrgidMissionCollaboration.date': 'Date',
    'appAgency.appAgencyOrgidMissionCollaboration.decision': 'Decision',
    'appAgency.appAgencyOrgidMissionCollaboration.decisionReason': 'Decision reason',
    'appAgency.appAgencyOrgidMissionCollaboration.decisions': 'Decisions',
    'appAgency.appAgencyOrgidMissionCollaboration.dueDateOptional': 'Due Date (Optional)',
    'appAgency.appAgencyOrgidMissionCollaboration.eGHmPassportOffice': 'e.g. HM Passport Office',
    'appAgency.appAgencyOrgidMissionCollaboration.eGPhone44': 'e.g. phone: +44...',
    'appAgency.appAgencyOrgidMissionCollaboration.eGVisaInterviewPrepCall':
      'e.g. Visa interview prep call',
    'appAgency.appAgencyOrgidMissionCollaboration.exactClaim': 'Exact Claim',
    'appAgency.appAgencyOrgidMissionCollaboration.exactClaim9528fc': 'Exact claim',
    'appAgency.appAgencyOrgidMissionCollaboration.exactClaimConfirmed': 'Exact claim confirmed',
    'appAgency.appAgencyOrgidMissionCollaboration.expired': 'Expired',
    'appAgency.appAgencyOrgidMissionCollaboration.internal': 'Internal',
    'appAgency.appAgencyOrgidMissionCollaboration.internalThisOrgOnly': 'Internal (This Org Only)',
    'appAgency.appAgencyOrgidMissionCollaboration.issuer': 'Issuer',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerConfirmations': 'Issuer Confirmations',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerIdentity': 'Issuer identity',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerResponse': 'Issuer Response',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerResponseff74b8': 'Issuer response',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerSResponse': "Issuer's response",
    'appAgency.appAgencyOrgidMissionCollaboration.memberToAssign': 'Member to assign',
    'appAgency.appAgencyOrgidMissionCollaboration.noAppointmentsScheduled':
      'No appointments scheduled.',
    'appAgency.appAgencyOrgidMissionCollaboration.noDecisionsRecordedYet':
      'No decisions recorded yet.',
    'appAgency.appAgencyOrgidMissionCollaboration.noIssuerConfirmedYetLackOf':
      'No issuer confirmed yet. Lack of this is not a readiness failure on its own.',
    'appAgency.appAgencyOrgidMissionCollaboration.noNotesYet': 'No notes yet.',
    'appAgency.appAgencyOrgidMissionCollaboration.noOpenTasks': 'No open tasks.',
    'appAgency.appAgencyOrgidMissionCollaboration.nobodyAssignedYet': 'Nobody assigned yet.',
    'appAgency.appAgencyOrgidMissionCollaboration.noteVisibility': 'Note visibility',
    'appAgency.appAgencyOrgidMissionCollaboration.notes': 'Notes',
    'appAgency.appAgencyOrgidMissionCollaboration.onlyAnAssignedMemberCanRecord':
      'Only an assigned member can record a decision.',
    'appAgency.appAgencyOrgidMissionCollaboration.place': 'Place',
    'appAgency.appAgencyOrgidMissionCollaboration.priority': 'Priority',
    'appAgency.appAgencyOrgidMissionCollaboration.reasonOptional': 'Reason (Optional)',
    'appAgency.appAgencyOrgidMissionCollaboration.reject': 'Reject',
    'appAgency.appAgencyOrgidMissionCollaboration.removeMemberemail': 'Remove {memberEmail}',
    'appAgency.appAgencyOrgidMissionCollaboration.requirement': 'Requirement',
    'appAgency.appAgencyOrgidMissionCollaboration.requirementThisConfirmationCovers':
      'Requirement this confirmation covers',
    'appAgency.appAgencyOrgidMissionCollaboration.requirementf6daff': 'Requirement…',
    'appAgency.appAgencyOrgidMissionCollaboration.requiresEvidenceAlreadySelectedForThat':
      'Requires evidence already selected for that requirement; a staff checkbox alone is never accepted as confirmation.',
    'appAgency.appAgencyOrgidMissionCollaboration.sharedWithTraveller': 'Shared with Traveller',
    'appAgency.appAgencyOrgidMissionCollaboration.taskDescription': 'Task Description',
    'appAgency.appAgencyOrgidMissionCollaboration.taskDescription9f2652': 'Task description',
    'appAgency.appAgencyOrgidMissionCollaboration.tasks': 'Tasks',
    'appAgency.appAgencyOrgidMissionCollaboration.time': 'Time',
    'appAgency.appAgencyOrgidMissionCollaboration.timeZone': 'Time Zone',
    'appAgency.appAgencyOrgidMissionCollaboration.unassigned': 'Unassigned',
    'appAgency.appAgencyOrgidMissionCollaboration.validUntil': 'Valid Until',
    'appAgency.appAgencyOrgidMissionCollaboration.validUntil4852df': 'Valid until',
    'appAgency.appAgencyOrgidMissionCollaboration.visibility': 'Visibility',
    'appAgency.appAgencyOrgidMissionCollaboration.visibilityb5de1d': 'Visibility…',
    'appAgency.appAgencyOrgidOrgBrandingHeader.nameLogo': '{name} logo',
    'appAgency.appAgencyOrgidPage.aboutThisList': 'About This List',
    'appAgency.appAgencyOrgidPage.acknowledgedFormattimestampdate':
      'Acknowledged {formatTimestampDate}',
    'appAgency.appAgencyOrgidPage.activeCasesThisOrganizationCanStill':
      'Active cases this organization can still act on but that currently have nobody assigned - most often because the only assigned member was removed. Open one to assign someone in the Cases section.',
    'appAgency.appAgencyOrgidPage.activeClients': 'Active Clients',
    'appAgency.appAgencyOrgidPage.actualStageCountsAppearWhenA':
      'Actual stage counts appear when a case is shared and visible to you.',
    'appAgency.appAgencyOrgidPage.agencyOverview': 'Agency overview',
    'appAgency.appAgencyOrgidPage.assignedCases': 'Assigned Cases',
    'appAgency.appAgencyOrgidPage.assignedToYou': 'Assigned to You',
    'appAgency.appAgencyOrgidPage.attentionDetailsPluralAgreeAResponse':
      'Attention Details: {plural} {agree} a response',
    'appAgency.appAgencyOrgidPage.case': 'Case',
    'appAgency.appAgencyOrgidPage.casePipeline': 'Case Pipeline',
    'appAgency.appAgencyOrgidPage.casesAndAttention': 'Cases and Attention',
    'appAgency.appAgencyOrgidPage.casesMostUrgentFirst': 'Cases, Most Urgent First',
    'appAgency.appAgencyOrgidPage.casesThatNeedActionComeFirst':
      'Cases that need action come first.',
    'appAgency.appAgencyOrgidPage.casesWithNobodyAssigned': 'Cases with Nobody Assigned',
    'appAgency.appAgencyOrgidPage.casesYouCanSee': 'Cases you can see',
    'appAgency.appAgencyOrgidPage.clientsJoined': 'Clients joined',
    'appAgency.appAgencyOrgidPage.clientsJoinedd73060': 'Clients Joined',
    'appAgency.appAgencyOrgidPage.clientsYouCanWorkWith': 'Clients you can work with',
    'appAgency.appAgencyOrgidPage.deadline': 'Deadline',
    'appAgency.appAgencyOrgidPage.dueFormattimestampdate': 'Due {formatTimestampDate}',
    'appAgency.appAgencyOrgidPage.evidenceRequest': 'Evidence Request',
    'appAgency.appAgencyOrgidPage.evidenceRequestsWaitingOnTheTraveller':
      'Evidence Requests Waiting on the Traveller',
    'appAgency.appAgencyOrgidPage.finishAgencySetupLengthOfLength2':
      'Finish agency setup: {length} of {length2} complete',
    'appAgency.appAgencyOrgidPage.joinedInTheLast30Days': 'Joined in the Last 30 Days',
    'appAgency.appAgencyOrgidPage.lengthActiveMembersInactiveMembershipsRemain':
      '{length} active members. Inactive memberships remain available in team management.',
    'appAgency.appAgencyOrgidPage.manageRequests': 'Manage Requests',
    'appAgency.appAgencyOrgidPage.manageTeam': 'Manage Team',
    'appAgency.appAgencyOrgidPage.manualMode': 'Manual Mode',
    'appAgency.appAgencyOrgidPage.needsAssignment': 'Needs Assignment',
    'appAgency.appAgencyOrgidPage.needsAttention': 'Needs Attention',
    'appAgency.appAgencyOrgidPage.noCaseStagesToShow': 'No Case Stages to Show',
    'appAgency.appAgencyOrgidPage.noCasesMatchThatSearch': 'No cases match that search.',
    'appAgency.appAgencyOrgidPage.noEvidenceRequestsYet': 'No evidence requests yet.',
    'appAgency.appAgencyOrgidPage.noPackAttached': 'No Pack Attached',
    'appAgency.appAgencyOrgidPage.notSet': 'Not set',
    'appAgency.appAgencyOrgidPage.notYetAcknowledged': 'Not yet acknowledged',
    'appAgency.appAgencyOrgidPage.nothing': 'Nothing',
    'appAgency.appAgencyOrgidPage.nothingIsOverdueUnassignedOrWaiting':
      'Nothing is overdue, unassigned or waiting on a traveller right now.',
    'appAgency.appAgencyOrgidPage.openAssignedCases': 'Open Assigned Cases',
    'appAgency.appAgencyOrgidPage.openCases': 'Open Cases',
    'appAgency.appAgencyOrgidPage.openrequestsOpenRequests':
      '{openRequests, plural, =1 {{openRequests} open request} other {{openRequests} open requests}}',
    'appAgency.appAgencyOrgidPage.overdueTasks': 'Overdue Tasks',
    'appAgency.appAgencyOrgidPage.overduetasksOverdueTasks':
      '{overdueTasks, plural, =1 {{overdueTasks} overdue task} other {{overdueTasks} overdue tasks}}',
    'appAgency.appAgencyOrgidPage.pendingRequests': 'Pending Requests',
    'appAgency.appAgencyOrgidPage.quickViewsOfTheCaseList': 'Quick views of the case list',
    'appAgency.appAgencyOrgidPage.readiness': 'Readiness',
    'appAgency.appAgencyOrgidPage.readinessUnavailable': 'Readiness Unavailable',
    'appAgency.appAgencyOrgidPage.ready': 'Ready',
    'appAgency.appAgencyOrgidPage.reassignmentQueue': 'Reassignment Queue',
    'appAgency.appAgencyOrgidPage.recentNotesFromCasesYouCan':
      'Recent notes from cases you can currently access. This is not the full organization audit log.',
    'appAgency.appAgencyOrgidPage.recentRequestsAvailableToYourAdministrator':
      'Recent requests available to your administrator role.',
    'appAgency.appAgencyOrgidPage.requestsAndTeam': 'Requests and team',
    'appAgency.appAgencyOrgidPage.requestsAndTeamManagementBelongTo':
      'Requests and team management belong to agency administrators. Your assigned case tools remain available.',
    'appAgency.appAgencyOrgidPage.reviewissuesNeedsReplacement': '{reviewIssues} needs replacement',
    'appAgency.appAgencyOrgidPage.searchCoversOnlyTheCasesYou':
      'Search covers only the cases you are already allowed to see, by traveller, case title, reference, destination or stage.',
    'appAgency.appAgencyOrgidPage.setUpYourAgency': 'Set Up Your Agency',
    'appAgency.appAgencyOrgidPage.showAllMinCases': 'Show All {min} Cases',
    'appAgency.appAgencyOrgidPage.showFewerCases': 'Show Fewer Cases',
    'appAgency.appAgencyOrgidPage.teamMembers': 'Team Members',
    'appAgency.appAgencyOrgidPage.traveller': 'Traveller',
    'appAgency.appAgencyOrgidPage.travellerConfirmed': 'Traveller Confirmed',
    'appAgency.appAgencyOrgidPage.viewAccessibleCaseActivity': 'View Accessible Case Activity',
    'appAgency.appAgencyOrgidPage.viewAllCases': 'View All Cases',
    'appAgency.appAgencyOrgidPage.waitingontravellersWaitingOnTravellersWaitingona':
      '{waitingOnTravellers, plural, =1 {{waitingOnTravellers} waiting on a traveller, {waitingOnAgency} waiting on you} other {{waitingOnTravellers} waiting on travellers, {waitingOnAgency} waiting on you}}',
    'appAgency.appAgencyOrgidPage.whatNeedsYouFirst': 'What Needs You First',
    'appAgency.appAgencyOrgidPage.youReAMemberOfThis':
      "You're a member of this organization but not an administrator. Requesting evidence, bulk export, and member management are admin-only - you can still collaborate on cases you're assigned to in the Cases section.",
    'appAgency.appAgencyOrgidPage.yourCaseWork': 'Your Case Work',
    'appAgency.appAgencyOrgidPage.yourTeam': 'Your Team',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.claimMethodLabelsPlainamountPaidFormatbillingdat':
      '{CLAIM_METHOD_LABELS}, {plainAmount}, paid {formatBillingDate}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.creditFromAnEarlierPaymentPlainamount':
      'Credit from an earlier payment: {plainAmount} of an online payment VisaStack held for a check was counted towards this invoice.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadInvoicePdf': 'Download Invoice (PDF)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadProof': 'Download Proof',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadReceiptPdf': 'Download Receipt (PDF)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.due': 'Due',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.invoiced': 'Invoiced',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.itIsDueToday': ' It is due today.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.itWasDueOnFormatbillingdate':
      ' It was due on {formatBillingDate}.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.keptAfterRefunds': 'Kept After Refunds',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.onlinePayments': 'Online Payments',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.onlinePaymentsForInvoiceref':
      'Online payments for {invoiceRef}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paidSoFar': 'Paid So Far',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.partOfItHasBeenPaid':
      ' Part of it has been paid.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.payInvoiceref': 'Pay {invoiceRef}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReportedWeAreCheckingIt':
      'Payment Reported: we are checking it. Once it is decided you can pay online or report another payment.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReportedWeAreCheckingIt7bdaca':
      'Payment Reported: we are checking it. We will update this invoice once it is checked.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReports': 'Payment Reports',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReportsForInvoiceref':
      'Payment reports for {invoiceRef}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.plainamountOnFormatbillingdate':
      '{plainAmount} on {formatBillingDate}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.plainamountStartedFormatbillingdatetime':
      '{plainAmount}, started {formatBillingDateTime}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.reasonDecisionreason':
      'Reason: {decisionReason}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.receiptNumber': 'Receipt {number}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.receipts': 'Receipts',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.receiptsForInvoiceref':
      'Receipts for {invoiceRef}',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.refunded': 'Refunded',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.stillOwed': 'Still Owed',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aPaymentForThisInvoiceWas':
      'A payment for this invoice was started at {startedAt}. Check it before paying again.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aPhotoOrScreenshotJpegOr':
      'A photo or screenshot (JPEG or PNG) or a PDF, under 4 MB. Only your owners and admins and VisaStack staff can open it. If you report again after an error, choose the file again.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aTransferIdBkashTransactionId':
      'A transfer id, bKash transaction id or cheque number.',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.amountPaidCurrency':
      'Amount Paid ({currency})',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.datePaid': 'Date Paid',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.howYouPaid': 'How You Paid',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.iPaidAnotherWay': 'I Paid Another Way',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.noteOptional': 'Note (Optional)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.paymentReference': 'Payment Reference',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.proofOfPaymentOptional':
      'Proof of Payment (Optional)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.tellUsAboutAPaymentYou':
      'Tell us about a payment you already made by bank transfer, bKash or cheque. Nothing is counted until VisaStack confirms it.',
    'appAgency.appAgencyOrgidPlanInvoicesPage.invoices': 'Invoices',
    'appAgency.appAgencyOrgidPlanInvoicesPage.noInvoicesYetWhenVisastackIssues':
      'No invoices yet. When VisaStack issues an invoice for your plan it appears here.',
    'appAgency.appAgencyOrgidPlanInvoicesPage.onlyOwnersAndAdminsCanSee':
      'Only owners and admins can see and pay invoices.',
    'appAgency.appAgencyOrgidPlanInvoicesPage.payAnInvoiceOnlineOrTell':
      'Pay an invoice online or tell us about a payment you made another way. Your receipts are kept here.',
    'appAgency.appAgencyOrgidPlanInvoicesPage.usageBilling': 'Usage & Billing',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.agency': 'Agency',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.amountReceived': 'Amount Received',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.howItWasPaid': 'How It Was Paid',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.invoice': 'Invoice',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.paymentDate': 'Payment Date',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.receiptIssued': 'Receipt Issued',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.receiptNumber': 'Receipt Number',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.thisReceiptShowsThatAPayment':
      'This receipt shows that a payment was recorded against the invoice named above. It is not a tax document.',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.visastackRecordedThisPaymentAgainstYour':
      'VisaStack recorded this payment against your invoice.',
    'appAgency.appAgencyOrgidPlanPage.accessOfferNotRecorded': 'Access Offer Not Recorded',
    'appAgency.appAgencyOrgidPlanPage.aiFeatures': 'AI Features',
    'appAgency.appAgencyOrgidPlanPage.anAccessOfferHasNotBeen':
      'An access offer has not been recorded for this organization. Your measured usage is shown below. Record permissions and safety checks still apply.',
    'appAgency.appAgencyOrgidPlanPage.complimentaryDuringPublicBetaNoPayment':
      'Complimentary during public beta. No payment method is required. Fair-use safeguards and private-record permissions still apply. Storage and processing remain subject to available capacity.',
    'appAgency.appAgencyOrgidPlanPage.currentPlan': 'Current Plan',
    'appAgency.appAgencyOrgidPlanPage.everythingInVisastackWorksWithoutAi':
      'Everything in VisaStack works without AI features, and each person’s own AI use follows VisaStack’s settings.',
    'appAgency.appAgencyOrgidPlanPage.fromFormatbillingdateYourNextBillingPeriod':
      'From {formatBillingDate}, your next billing period, the price is {formatMoney}. Invoices already made keep their amounts.',
    'appAgency.appAgencyOrgidPlanPage.planUsage': 'Plan & Usage',
    'appAgency.appAgencyOrgidPlanPage.shownForYourInformationItDoes':
      ' Shown for your information; it does not stop any work.',
    'appAgency.appAgencyOrgidPlanPage.usage': 'Usage',
    'appAgency.appAgencyOrgidPlanPage.whatYourPlanIncludes': 'What Your Plan Includes',
    'appAgency.appAgencyOrgidPlanPage.youDonTHaveAccessTo':
      "You don't have access to this organization's plan.",
    'appAgency.appAgencyOrgidPlanPage.yourAgencySPlanAndHow':
      "Your agency's plan and how much of it is in use. Each limit comes from your plan.",
    'appAgency.appAgencyOrgidRequestConversation.conversation': 'Conversation',
    'appAgency.appAgencyOrgidRequestEvidenceForm.case': 'Case',
    'appAgency.appAgencyOrgidRequestEvidenceForm.chooseATraveller': 'Choose a traveller…',
    'appAgency.appAgencyOrgidRequestEvidenceForm.dueDateOptional': 'Due Date (Optional)',
    'appAgency.appAgencyOrgidRequestEvidenceForm.forApplicantnameCasetitle':
      'For {applicantName}, {caseTitle}',
    'appAgency.appAgencyOrgidRequestEvidenceForm.forExampleNeededForTheVisa':
      'For example: needed for the visa form',
    'appAgency.appAgencyOrgidRequestEvidenceForm.messageOptional': 'Message (Optional)',
    'appAgency.appAgencyOrgidRequestEvidenceForm.noTravellerHasGrantedThisOrganization':
      'No traveller has granted this organization access yet. Nothing to request from.',
    'appAgency.appAgencyOrgidRequestEvidenceForm.onlyIfAccessIsLimitedTo':
      'Only if access is limited to one case.',
    'appAgency.appAgencyOrgidRequestEvidenceForm.theMessageAndTheDueDate':
      'The message and the due date go with every item.',
    'appAgency.appAgencyOrgidRequestEvidenceForm.traveller': 'Traveller',
    'appAgency.appAgencyOrgidRequestEvidenceForm.wholeTravellerRecordDefault':
      'Whole Traveller Record (Default)',
    'appAgency.appAgencyOrgidSettingsPage.aifeatureoffsentenceConnectedAppsReadNothingUnti':
      '{aiFeatureOffSentence} Connected apps read nothing until it works again.',
    'appAgency.appAgencyOrgidSettingsPage.branding': 'Branding',
    'appAgency.appAgencyOrgidSettingsPage.bulkExport': 'Bulk Export',
    'appAgency.appAgencyOrgidSettingsPage.downloadBulkExport': 'Download Bulk Export',
    'appAgency.appAgencyOrgidSettingsPage.downloadTheProfilesOfEveryTraveller':
      'Download the profiles of every traveller who granted this organization an accepted export grant. Each traveller is re-checked by the policy engine at export time.',
    'appAgency.appAgencyOrgidSettingsPage.export': 'Export',
    'appAgency.appAgencyOrgidSettingsPage.manageAiConnections': 'Manage AI Connections',
    'appAgency.appAgencyOrgidSettingsPage.off': 'Off',
    'appAgency.appAgencyOrgidSettingsPage.on': 'On',
    'appAgency.appAgencyOrgidSettingsPage.reviewPolicy': 'Review Policy',
    'appAgency.appAgencyOrgidSettingsPage.settings': 'Settings',
    'appAgency.appAgencyOrgidSettingsPage.settingsAreLimitedToThisOrganization':
      "Settings are limited to this organization's owners and admins.",
    'appAgency.appAgencyOrgidSettingsPage.status': 'Status',
    'appAgency.appAgencyOrgidSettingsPage.whenThisIsOnAnOwner':
      'When this is on, an owner or admin can connect an AI app, such as ChatGPT or Claude, that reads only what each traveller allowed this agency’s AI tools to read. Off by default.',
    'appAgency.appAgencyOrgidSettingsPage.yourLogoYourAgencyNameAnd':
      'Your logo, your agency name and one accent colour. They show across this workspace and on the invitations you send. "Powered by VisaStack" always stays beside them, and your branding never appears in another agency\'s workspace.',
    'appAgency.appAgencyOrgidTeamPage.active': 'Active',
    'appAgency.appAgencyOrgidTeamPage.allowDocumentRequestsLetsAMember':
      'Allow Document Requests lets a member create and send document requests of their own. Only owners and admins see what people send back.',
    'appAgency.appAgencyOrgidTeamPage.inactive': 'Inactive',
    'appAgency.appAgencyOrgidTeamPage.managingTheTeamIsLimitedTo':
      "Managing the team is limited to this organization's owners and admins.",
    'appAgency.appAgencyOrgidTeamPage.mayRequestDocuments': 'May Request Documents',
    'appAgency.appAgencyOrgidTeamPage.members': 'Members',
    'appAgency.appAgencyOrgidTeamPage.membershipIsOrganizationalBookkeepingItNever':
      "Membership is organizational bookkeeping - it never grants access to a traveller's records on its own. Access is always an accepted grant.",
    'appAgency.appAgencyOrgidTeamPage.team': 'Team',
    'appAgency.appAgencyOrgidWorkspaceHeading.agencyOverview': 'Agency Overview',
    'appAgency.appAgencyPage.agenciesCollaborateOnCasesAndRequest':
      'Agencies collaborate on cases and request evidence. Membership never grants record access on its own - access is always an accepted grant.',
    'appAgency.appAgencyPage.applyToRegisterAnAgency': 'Apply to Register an Agency',
    'appAgency.appAgencyPage.applyToRegisterYourAgencyHere':
      'Apply to register your agency here. You become its owner, and a platform administrator must verify it before it can work with clients.',
    'appAgency.appAgencyPage.memberships': 'Memberships',
    'appAgency.appAgencyPage.new': 'New',
    'appAgency.appAgencyPage.noOrganizationsYet': 'No Organizations Yet',
    'appAgency.appAgencyPage.organizations': 'Organizations',
    'appAgency.appAgencyPage.withdrawApplication': 'Withdraw Application',
    'appAgency.appAgencyPage.withdrawTheApplicationForNameIt':
      'Withdraw the application for {name}? It will no longer be reviewed, and anyone you added to it loses access. You can apply again at any time.',
    'appAgency.appAgencyPage.youBecomeTheOwnerNewOrganizations':
      'You become the owner. New organizations start pending verification by a platform administrator.',
    'appAgency.appAgencyPage.yourOrganizations': 'Your Organizations',
  },
  bn: {
    'appAgency.appAgencyCreateOrgForm.organizationName': 'প্রতিষ্ঠানের নাম',
    'appAgency.appAgencyOrgidActivityPage.caseActivity': 'ভিসা ফাইলের কার্যকলাপ',
    'appAgency.appAgencyOrgidActivityPage.caseActivityEntries': 'ভিসা ফাইলের কার্যক্রমের এন্ট্রি',
    'appAgency.appAgencyOrgidActivityPage.casesInThisActivity': 'এই কার্যক্রমের ভিসা ফাইল',
    'appAgency.appAgencyOrgidActivityPage.newCaseNotesAppearHereWhen':
      'আপনার টিম কোনো অ্যাক্সেসযোগ্য ভিসা ফাইলে নতুন নোট রেকর্ড করলে সেগুলো এখানে দেখা যাবে।',
    'appAgency.appAgencyOrgidActivityPage.noCaseActivityRecorded':
      'ভিসা ফাইলের কোনো কার্যকলাপ রেকর্ড করা হয়নি',
    'appAgency.appAgencyOrgidActivityPage.openACase': 'একটি ভিসা ফাইল খুলুন:',
    'appAgency.appAgencyOrgidActivityPage.recentNotesOnCasesYouCan':
      'আপনি যেসব ভিসা ফাইলে অ্যাক্সেস পান, সেগুলোর সাম্প্রতিক নোট। এটি ভিসা ফাইলের কার্যকলাপ, প্রতিষ্ঠানের সম্পূর্ণ অডিট লগ নয়।',
    'appAgency.appAgencyOrgidActivityPage.showingNotesFromTheTenMost':
      'সম্প্রতি হালনাগাদ হওয়া দশটি অ্যাক্সেসযোগ্য ভিসা ফাইলের নোট দেখানো হচ্ছে। পুরো ইতিহাস দেখতে ভিসা ফাইল খুলুন।',
    'appAgency.appAgencyOrgidAgencyAiSettingForm.statement': 'বিবৃতি',
    'appAgency.appAgencyOrgidAgencyAiTurnOff.ended': 'শেষ হয়েছে',
    'appAgency.appAgencyOrgidAiConnectionsPage.aiConnections': 'এআই সংযোগ',
    'appAgency.appAgencyOrgidAiConnectionsPage.aiTools': 'এআই টুল',
    'appAgency.appAgencyOrgidAiConnectionsPage.anOwnerOrAdminCanConnect':
      'সেটিংসে এই এজেন্সির জন্য এআই সংযোগ চালু থাকলে একজন মালিক বা অ্যাডমিন এআই অ্যাপ থেকে একটি সংযুক্ত করতে পারেন।',
    'appAgency.appAgencyOrgidAiConnectionsPage.eachAppReadsForEachCase':
      'প্রতিটি অ্যাপ, তার নিজের মালিক বা অ্যাডমিন যে ভিসা ফাইলগুলো দেখতে পারেন তার প্রতিটির ক্ষেত্রে, শুধু সেটুকুই পড়ে, যা ওই ভিসা ফাইলের ভ্রমণকারী এই এজেন্সির এআই টুলকে পড়তে দিয়েছেন। এটি সর্বোচ্চ ৩০ দিন কাজ করে।',
    'appAgency.appAgencyOrgidAiConnectionsPage.noAiAppsConnected': 'কোনো এআই অ্যাপ সংযুক্ত নেই',
    'appAgency.appAgencyOrgidBrandingForm.accentColour': 'অ্যাকসেন্ট রং',
    'appAgency.appAgencyOrgidBrandingForm.accentColourAsASixDigit': 'ছয় অঙ্কের কোডে অ্যাকসেন্ট রং',
    'appAgency.appAgencyOrgidBrandingForm.agencyName': 'এজেন্সির নাম',
    'appAgency.appAgencyOrgidBrandingForm.agencyWorkspace': 'এজেন্সি ওয়ার্কস্পেস',
    'appAgency.appAgencyOrgidBrandingForm.chooseAColour': 'একটি রং বেছে নিন',
    'appAgency.appAgencyOrgidBrandingForm.howItLooks': 'দেখতে কেমন',
    'appAgency.appAgencyOrgidBrandingForm.howYourAgencyWillLook': 'আপনার এজেন্সি দেখতে কেমন হবে',
    'appAgency.appAgencyOrgidBrandingForm.logo': 'লোগো',
    'appAgency.appAgencyOrgidBrandingForm.logoImagePngOrJpeg': 'লোগোর ছবি (PNG বা JPEG)',
    'appAgency.appAgencyOrgidBrandingForm.noLogoYetYourInitialsShow':
      'এখনো কোনো লোগো নেই। এর বদলে আপনার নামের আদ্যক্ষর দেখানো হচ্ছে।',
    'appAgency.appAgencyOrgidBrandingForm.pngOrJpegUpTo2':
      'PNG বা JPEG, সর্বোচ্চ ২ MB। বর্গাকার বা চওড়া, দুই ধরনের লোগোই চলে। এটি একটি সাদা টাইলের ওপর বসে, তাই স্বচ্ছ ব্যাকগ্রাউন্ডের লোগো সুন্দর দেখায়। কেউ দেখার আগে পরীক্ষা করা হয় যে এটি সত্যিই একটি PNG বা JPEG ছবি।',
    'appAgency.appAgencyOrgidBrandingForm.poweredByVisastack': 'VisaStack দ্বারা চালিত',
    'appAgency.appAgencyOrgidBrandingForm.travellersSeeThisOnInvitationsFrom':
      'ভ্রমণকারীরা আপনার পাঠানো আমন্ত্রণে এটি দেখেন। আপনার টিম এটি ওয়ার্কস্পেসের উপরে দেখে।',
    'appAgency.appAgencyOrgidBrandingForm.usedForYourMarkAndHighlights':
      'আপনার চিহ্ন ও হাইলাইটে ব্যবহার হয়। একটি বেছে নিন, অথবা একটি রং লিখুন। সাদার ওপর সহজে পড়া যেতে হবে। ফাঁকা রাখলে VisaStack-এর সবুজ রং ব্যবহার হবে।',
    'appAgency.appAgencyOrgidBrandingForm.yourLogoAsItAppears': 'আপনার লোগো, যেমন দেখাবে।',
    'appAgency.appAgencyOrgidCaseSearchForm.anyStage': 'যেকোনো ধাপ',
    'appAgency.appAgencyOrgidCaseSearchForm.anyone': 'যে কেউ',
    'appAgency.appAgencyOrgidCaseSearchForm.assignee': 'দায়িত্বপ্রাপ্ত ব্যক্তি',
    'appAgency.appAgencyOrgidCaseSearchForm.clear': 'খালি করুন',
    'appAgency.appAgencyOrgidCaseSearchForm.clientNameCaseTitleOrCase':
      'ক্লায়েন্টের নাম, ভিসা ফাইলের শিরোনাম বা ভিসা ফাইল আইডি',
    'appAgency.appAgencyOrgidCaseSearchForm.destination': 'গন্তব্য',
    'appAgency.appAgencyOrgidCaseSearchForm.search': 'খুঁজুন',
    'appAgency.appAgencyOrgidCaseSearchForm.stage': 'ধাপ',
    'appAgency.appAgencyOrgidCaseTriageSummary.itemsAskedOfTheTravellerAre':
      'ভ্রমণকারীর কাছে চাওয়া আইটেম এজেন্সির অ্যাডমিনদের দেখানো হয়।',
    'appAgency.appAgencyOrgidCaseTriageSummary.nothingHasBeenAskedForOr':
      'এখনো কিছু চাওয়া বা পরীক্ষা করা হয়নি।',
    'appAgency.appAgencyOrgidCaseTriageSummary.whereThingsStand': 'এখন কী অবস্থা',
    'appAgency.appAgencyOrgidCasesListPager.showOlderEntries': 'আগের এন্ট্রি দেখান',
    'appAgency.appAgencyOrgidCasesPage.aboutCases': 'ভিসা ফাইল সম্পর্কে',
    'appAgency.appAgencyOrgidCasesPage.askForADocumentOrDetail': 'ডকুমেন্ট বা তথ্য চান',
    'appAgency.appAgencyOrgidCasesPage.assignATeamMemberAndLeave':
      'যে ভিসা ফাইলে এই প্রতিষ্ঠানের অ্যাক্সেস-অনুমতি আছে, সেখানে টিমের একজন সদস্যকে দায়িত্ব দিন এবং ভিসা ফাইলের নোট রাখুন।',
    'appAgency.appAgencyOrgidCasesPage.cases': 'ভিসা ফাইল',
    'appAgency.appAgencyOrgidCasesPage.chooseACaseToOpenIts':
      'ওয়ার্কস্পেস খুলতে একটি ভিসা ফাইল বেছে নিন: সেখানে টিম, নোট, কাজ ও অ্যাপয়েন্টমেন্ট আছে।',
    'appAgency.appAgencyOrgidCasesPage.collaborate': 'একসঙ্গে কাজ',
    'appAgency.appAgencyOrgidCasesPage.deadlineFormatdateonly': '· শেষ তারিখ {formatDateOnly}',
    'appAgency.appAgencyOrgidCasesPage.leaveCaseNotesAndRecordDecisions':
      'যে ভিসা ফাইলগুলোর দায়িত্ব আপনাকে দেওয়া হয়েছে, সেগুলোতে ভিসা ফাইলের নোট রাখুন এবং সিদ্ধান্ত রেকর্ড করুন।',
    'appAgency.appAgencyOrgidCasesPage.noCasesAreReachableYetA':
      'পৌঁছানো যায় এমন কোনো ভিসা ফাইল এখনো নেই - কোনো ভ্রমণকারীকে নির্দিষ্ট একটি ভিসা ফাইলে এই প্রতিষ্ঠানকে অ্যাক্সেস দিতে হবে।',
    'appAgency.appAgencyOrgidCasesPage.noCasesYet': 'এখনো কোনো ভিসা ফাইল নেই',
    'appAgency.appAgencyOrgidCasesPage.openCase': 'ভিসা ফাইল খুলুন',
    'appAgency.appAgencyOrgidCasesPage.openCasedd4d13': 'ভিসা ফাইল খুলুন',
    'appAgency.appAgencyOrgidCasesPage.openNow': 'এখনই খুলুন',
    'appAgency.appAgencyOrgidCasesPage.thatCaseIsNotOpenTo':
      'সেই ভিসা ফাইলটি আপনার জন্য খোলা নয়। এটি হয়তো আর এই প্রতিষ্ঠানের সঙ্গে শেয়ার করা নেই, অথবা আপনাকে এতে যুক্ত করা হয়নি। তালিকা থেকে একটি ভিসা ফাইল বেছে নিন।',
    'appAgency.appAgencyOrgidCasesPage.youArenTAssignedToAny':
      'আপনাকে এখনো কোনো ভিসা ফাইলে যুক্ত করা হয়নি। এই প্রতিষ্ঠানের একজন মালিক বা অ্যাডমিন আপনাকে কোনো একটিতে যুক্ত করতে পারেন।',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.documentType': 'ডকুমেন্টের ধরন',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.howNecessary': 'কতটা দরকার',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.optional': 'ঐচ্ছিক',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.recommended': 'প্রস্তাবিত',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.required': 'আবশ্যক',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.whatTheTravellerReads': 'ভ্রমণকারী যা পড়েন',
    'appAgency.appAgencyOrgidChecklistsChecklistForms.whoItIsFor': 'কাদের জন্য',
    'appAgency.appAgencyOrgidChecklistsEditPage.aChangeIsReadyButNot':
      'একটি পরিবর্তন প্রস্তুত, কিন্তু এখনো প্রকাশ করা হয়নি। শেষ করতে এটি প্রকাশ করুন।',
    'appAgency.appAgencyOrgidChecklistsEditPage.addAnItem': 'একটি আইটেম যোগ করুন',
    'appAgency.appAgencyOrgidChecklistsEditPage.casesOnYourAgencyOfferThis':
      'আপনার এজেন্সির ভিসা ফাইলগুলোতে এই সংস্করণটি দেওয়া হচ্ছে। বদলাতে চাইলে একটি খসড়া খুলুন।',
    'appAgency.appAgencyOrgidChecklistsEditPage.draftVersionVersion': 'খসড়া, সংস্করণ {version}',
    'appAgency.appAgencyOrgidChecklistsEditPage.finish': 'শেষ করুন',
    'appAgency.appAgencyOrgidChecklistsEditPage.items': 'আইটেম',
    'appAgency.appAgencyOrgidChecklistsEditPage.ourList': 'আমাদের তালিকা',
    'appAgency.appAgencyOrgidChecklistsEditPage.publishedVersionVersion':
      'প্রকাশিত, সংস্করণ {version}',
    'appAgency.appAgencyOrgidChecklistsEditPage.readyToPublishVersionVersion':
      'প্রকাশের জন্য প্রস্তুত, সংস্করণ {version}',
    'appAgency.appAgencyOrgidChecklistsEditPage.thisListHasNoItemsYet':
      'এই তালিকায় এখনো কোনো আইটেম নেই।',
    'appAgency.appAgencyOrgidChecklistsEditPage.youAreChangingADraftCases':
      'আপনি একটি খসড়া পরিবর্তন করছেন। আপনি প্রকাশ না করা পর্যন্ত ভিসা ফাইলগুলোতে প্রকাশিত সংস্করণটিই থাকবে।',
    'appAgency.appAgencyOrgidChecklistsPage.checklists': 'চেকলিস্ট',
    'appAgency.appAgencyOrgidChecklistsPage.country': 'দেশ',
    'appAgency.appAgencyOrgidChecklistsPage.makeACountryListYourOwn':
      'একটি দেশের তালিকাকে নিজের মতো করে নিন। আপনার ভিসা ফাইলগুলোতে আপনার তৈরি সংস্করণটি দেওয়া হবে, আর শেয়ার করা সংস্করণ যেমন আছে তেমনই থাকবে।',
    'appAgency.appAgencyOrgidChecklistsPage.noSharedListMatches': 'কোনো শেয়ার করা তালিকা মেলেনি।',
    'appAgency.appAgencyOrgidChecklistsPage.openOurCopy': 'আমাদের কপি খুলুন',
    'appAgency.appAgencyOrgidChecklistsPage.ourLists': 'আমাদের তালিকা',
    'appAgency.appAgencyOrgidChecklistsPage.showingTheFirstLengthSearchBy':
      'প্রথম {length}টি দেখানো হচ্ছে। তালিকা ছোট করতে দেশ দিয়ে খুঁজুন।',
    'appAgency.appAgencyOrgidChecklistsPage.startFromASharedList': 'একটি শেয়ার করা তালিকা থেকে শুরু করুন',
    'appAgency.appAgencyOrgidChecklistsPage.starterListNotOfficial': 'শুরুর তালিকা, অফিসিয়াল নয়',
    'appAgency.appAgencyOrgidChecklistsPage.youHaveNoListsOfYour':
      'আপনার নিজের কোনো তালিকা এখনো নেই। নিচের একটি শেয়ার করা তালিকা থেকে শুরু করুন।',
    'appAgency.appAgencyOrgidClientInvitationForm.addAtLeastOneActiveTeam':
      'ক্লায়েন্টকে আমন্ত্রণ জানানোর আগে অন্তত একজন সক্রিয় টিম সদস্য যোগ করুন।',
    'appAgency.appAgencyOrgidClientInvitationForm.caseOwner': 'ভিসা ফাইলের মালিক',
    'appAgency.appAgencyOrgidClientInvitationForm.clientEmailAddress': 'ক্লায়েন্টের ইমেইল ঠিকানা',
    'appAgency.appAgencyOrgidClientInvitationForm.janeExampleCom': 'jane@example.com',
    'appAgency.appAgencyOrgidClientInvitationForm.janeTraveller': 'ভ্রমণকারীর নাম',
    'appAgency.appAgencyOrgidClientInvitationForm.onlyThatEmailAddressCanAccept':
      'শুধু সেই ইমেইল ঠিকানাই গ্রহণ করতে পারে।',
    'appAgency.appAgencyOrgidClientInvitationForm.requestedRouteOptional': 'অনুরোধ করা রুট (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidClientInvitationForm.travellerName': 'ভ্রমণকারীর নাম',
    'appAgency.appAgencyOrgidClientInvitationForm.usB1B2BusinessVisa': 'US B1/B2 বিজনেস ভিসা',
    'appAgency.appAgencyOrgidClientsPage.aboutInvitations': 'আমন্ত্রণ সম্পর্কে',
    'appAgency.appAgencyOrgidClientsPage.aboutRequests': 'অনুরোধ সম্পর্কে',
    'appAgency.appAgencyOrgidClientsPage.activity': 'কার্যকলাপ',
    'appAgency.appAgencyOrgidClientsPage.addPeopleAndRequests': 'ব্যক্তি ও অনুরোধ যোগ করুন',
    'appAgency.appAgencyOrgidClientsPage.askATravellerForASpecific':
      'কোনো ভ্রমণকারীর কাছে নির্দিষ্ট তথ্য বা ডকুমেন্ট চান। সেটি দেবেন কি না, তা তিনি নিজে ঠিক করেন।',
    'appAgency.appAgencyOrgidClientsPage.cannotBeAcceptedRevokeAndInvite':
      'গ্রহণ করা যাবে না · প্রত্যাহার করে ইমেইলে আবার আমন্ত্রণ জানান',
    'appAgency.appAgencyOrgidClientsPage.clients': 'ক্লায়েন্ট',
    'appAgency.appAgencyOrgidClientsPage.collect': 'সংগ্রহ',
    'appAgency.appAgencyOrgidClientsPage.document': 'ডকুমেন্ট',
    'appAgency.appAgencyOrgidClientsPage.dueFormatdateonly': ' · শেষ তারিখ {formatDateOnly}',
    'appAgency.appAgencyOrgidClientsPage.evidenceRequests': 'প্রমাণের অনুরোধ',
    'appAgency.appAgencyOrgidClientsPage.evidenceRequestsByStatus': 'অবস্থা অনুযায়ী প্রমাণের অনুরোধ',
    'appAgency.appAgencyOrgidClientsPage.field': 'ঘর',
    'appAgency.appAgencyOrgidClientsPage.forPeopleWhoAreAlreadyYour':
      'যাঁরা ইতিমধ্যে আপনার ক্লায়েন্ট, তাঁদের জন্য।',
    'appAgency.appAgencyOrgidClientsPage.intake': 'প্রাথমিক তথ্য',
    'appAgency.appAgencyOrgidClientsPage.inviteAClient': 'ক্লায়েন্টকে আমন্ত্রণ জানান',
    'appAgency.appAgencyOrgidClientsPage.inviteATravellerAsANew':
      'একজন ভ্রমণকারীকে নতুন ক্লায়েন্ট হিসেবে আমন্ত্রণ জানান। ফলে যে ভিসা ফাইলটি তৈরি হবে, সেটি তাঁর নিজের কোন ভ্রমণকারী প্রোফাইলের সঙ্গে যুক্ত হবে, তা শুধু তিনিই বেছে নেন। এই প্রতিষ্ঠান অ্যাক্সেস পায় তাঁর গ্রহণের মাধ্যমে, আমন্ত্রণের মাধ্যমে কখনোই নয়।',
    'appAgency.appAgencyOrgidClientsPage.invitedExpiresFormattimestampdate':
      'আমন্ত্রিত · মেয়াদ শেষ {formatTimestampDate}',
    'appAgency.appAgencyOrgidClientsPage.invitingClientsAndRequestingEvidenceAre':
      'ক্লায়েন্টকে আমন্ত্রণ জানানো এবং প্রমাণ চাওয়া শুধু এই প্রতিষ্ঠানের মালিক ও অ্যাডমিনদের জন্য।',
    'appAgency.appAgencyOrgidClientsPage.noClientsInvitedYet':
      'এখনো কোনো ক্লায়েন্টকে আমন্ত্রণ জানানো হয়নি',
    'appAgency.appAgencyOrgidClientsPage.noEvidenceRequestsYet': 'এখনো কোনো প্রমাণের অনুরোধ নেই',
    'appAgency.appAgencyOrgidClientsPage.noRequestsInThisView': 'এই ভিউতে কোনো অনুরোধ নেই।',
    'appAgency.appAgencyOrgidClientsPage.pendingInvitations': 'অপেক্ষমাণ আমন্ত্রণ',
    'appAgency.appAgencyOrgidClientsPage.requestEvidence': 'প্রমাণ চান',
    'appAgency.appAgencyOrgidClientsPage.requestReference': 'অনুরোধের রেফারেন্স',
    'appAgency.appAgencyOrgidClientsPage.theRequestYouFollowedALink':
      'যে অনুরোধের লিংকে আপনি গিয়েছিলেন',
    'appAgency.appAgencyOrgidClientsPage.thisIsWhereYouAskA':
      'এখানে আপনি ক্লায়েন্টের কাছে নির্দিষ্ট ডকুমেন্ট বা তথ্য চান। সেটি এলে বা সময় পেরিয়ে গেলে আপনি এখানে দেখতে পাবেন।',
    'appAgency.appAgencyOrgidClientsPage.thisIsWhereYouInviteThe':
      'এখানে আপনি যাঁদের সহায়তা করেন তাঁদের আমন্ত্রণ জানান। প্রত্যেকে একটি লিংক পান, নিজের প্রোফাইল তৈরি করেন এবং আপনার সঙ্গে কী শেয়ার করবেন তা বেছে নেন। নিচের ফর্ম দিয়ে শুরু করুন।',
    'appAgency.appAgencyOrgidCollectionCollectionForms.checklistToFollow':
      'যে চেকলিস্ট অনুসরণ করা হবে',
    'appAgency.appAgencyOrgidCollectionCollectionForms.chooseACountry': 'একটি দেশ বেছে নিন',
    'appAgency.appAgencyOrgidCollectionCollectionForms.countryOfResidence': 'বসবাসের দেশ',
    'appAgency.appAgencyOrgidCollectionCollectionForms.destination': 'গন্তব্য',
    'appAgency.appAgencyOrgidCollectionCollectionForms.dueDate': 'শেষ তারিখ',
    'appAgency.appAgencyOrgidCollectionCollectionForms.email': 'ইমেইল',
    'appAgency.appAgencyOrgidCollectionCollectionForms.emailAddress': 'ইমেইল ঠিকানা',
    'appAgency.appAgencyOrgidCollectionCollectionForms.forYourOwnReferenceOnlyNothing':
      'শুধু আপনার নিজের রেফারেন্সের জন্য। লিংক খুললে কেউ এখানকার কিছু দেখতে পাবেন না।',
    'appAgency.appAgencyOrgidCollectionCollectionForms.howNecessary': 'কতটা দরকার',
    'appAgency.appAgencyOrgidCollectionCollectionForms.itemYourAgencyNeeds':
      'আপনার এজেন্সির দরকারি আইটেম',
    'appAgency.appAgencyOrgidCollectionCollectionForms.name': 'নাম',
    'appAgency.appAgencyOrgidCollectionCollectionForms.nationality': 'জাতীয়তা',
    'appAgency.appAgencyOrgidCollectionCollectionForms.notSureYet': 'এখনো নিশ্চিত নই',
    'appAgency.appAgencyOrgidCollectionCollectionForms.noteToThePersonOptional':
      'ব্যক্তির জন্য নোট (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.purpose': 'উদ্দেশ্য',
    'appAgency.appAgencyOrgidCollectionCollectionForms.specificRouteOptional': 'নির্দিষ্ট রুট (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.theEmailNamesYourAgencyOnly':
      'ইমেইলে আপনার এজেন্সির নাম শুধু তখনই থাকে, যখন VisaStack সেটি পর্যালোচনা করেছে; রুট, ডকুমেন্ট বা ব্যক্তির নাম কখনোই থাকে না।',
    'appAgency.appAgencyOrgidCollectionCollectionForms.travelFromOptional': 'কোথা থেকে ভ্রমণ (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.travelToOptional': 'কোথায় ভ্রমণ (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whatYouAlreadyKnowOptional':
      'আপনি আগে থেকে যা জানেন (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whereAndWhy': 'কোথায় এবং কেন',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whereTheyApply': 'তাঁরা কোথায় আবেদন করবেন',
    'appAgency.appAgencyOrgidCollectionCollectionForms.whoItIsForOptional': 'কাদের জন্য (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.copyLink': 'লিংক কপি করুন',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.privateRequestLink':
      'ব্যক্তিগত অনুরোধের লিংক',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.thisLinkIsShownOnlyOnce':
      'এই লিংকটি শুধু একবারই দেখানো হয়। WhatsApp খুললে একটি বার্তা তৈরি হয়; সেটি পাঠাবেন কি না তা আপনি ঠিক করেন, এবং পাঠানো হয়েছে কি না তা VisaStack দেখতে পারে না। অনুরোধ প্রত্যাহার করলে লিংকটি বন্ধ হয়ে যায়।',
    'appAgency.appAgencyOrgidCollectionCollectionLinkPanel.visastackRequest': 'VisaStack অনুরোধ',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.aLegalHoldKeepsTheGuest':
      'আইনি হোল্ডের কারণে এই অনুরোধের অতিথিদের ডকুমেন্ট অতিথিদের বেছে নেওয়া সময়ের পরেও রাখা হচ্ছে। কারণ: {reason}',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.answers': 'উত্তর',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.checkedForViruses':
      'ভাইরাসের জন্য পরীক্ষা করা হয়েছে',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.downloadTitle': '{title} ডাউনলোড করুন',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.eachAnswerHoldsOnlyWhatThe':
      'প্রতিটি উত্তরে শুধু সেটুকুই থাকে, যা ব্যক্তিটি বেছে নিয়েছিলেন - পাঠানোর সময় যেমন ছিল ঠিক তেমনই। আপনি নিশ্চিত করার পর ডকুমেন্টগুলো মূল ডকুমেন্ট হিসেবে ডাউনলোড হয়।',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.fileCheckedNotScannedForViruses':
      'ডকুমেন্টের ফরম্যাট পরীক্ষা করা হয়েছে, ভাইরাস স্ক্যান করা হয়নি',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.guestFilesAreDeletedWhenThe':
      'অতিথিদের ডকুমেন্ট মুছে ফেলা হয় যখন এই অনুরোধ বন্ধ হওয়ার পর প্রত্যেক অতিথির বেছে নেওয়া সময় শেষ হয়। আইনি হোল্ড থাকলে আপনি তা ছেড়ে না দেওয়া পর্যন্ত ডকুমেন্টগুলো রাখা হয়।',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.keepingGuestFiles':
      'অতিথির ডকুমেন্ট রাখা',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.noAnswersYetAPersonWho':
      'এখনো কোনো উত্তর আসেনি। আপনার লিংকের মাধ্যমে কেউ উত্তর দিলে - সাইন ইন করে হোক বা অ্যাকাউন্ট ছাড়াই - তিনি যা পাঠাতে বেছে নিয়েছেন ঠিক তা-সহ এখানে দেখা যাবে।',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.protectedDetail': 'সুরক্ষিত তথ্য',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.stillMissing': 'এখনো বাকি',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.thatFileCannotBeDownloadedRight':
      'এই ডকুমেন্টটি এখন ডাউনলোড করা যাচ্ছে না। ব্যক্তিটি হয়তো তাঁর উত্তর তুলে নিয়েছেন বা বদলেছেন, অথবা ডকুমেন্টটি এখনো পরীক্ষা করা হচ্ছে।',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.thisAnswerHasChangedSinceIt':
      'পাঠানোর পর এই উত্তর বদলে গেছে, সাধারণত কারণ ব্যক্তিটি তাঁর রেকর্ড থেকে একটি ডকুমেন্ট সরিয়েছেন। তাঁকে আবার উত্তর দিতে বলুন।',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.thisSubmissionNoLongerMatchesWhat':
      'এই জমা আর যা পাঠানো হয়েছিল তার সঙ্গে মিলছে না, তাই এর ডকুমেন্টগুলো দেওয়া হচ্ছে না।',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.titleVersionVersionnumber':
      '{title}, সংস্করণ {versionNumber}',
    'appAgency.appAgencyOrgidCollectionCollectionResponsePanel.withoutAnAccountGuestGuestnoSubmission':
      'অ্যাকাউন্ট ছাড়া: অতিথি {guestNo}, জমা {submissionNo}',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.addNotesForThePerson':
      'ব্যক্তির জন্য নোট যোগ করুন',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.generalNote': 'সাধারণ নোট',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.reasonForTheHold': 'আইনি হোল্ডের কারণ',
    'appAgency.appAgencyOrgidCollectionCollectionReviewForms.yourDecision': 'আপনার সিদ্ধান্ত',
    'appAgency.appAgencyOrgidCollectionNewPage.documentRequests': 'ডকুমেন্টের অনুরোধ',
    'appAgency.appAgencyOrgidCollectionNewPage.newDocumentRequest': 'নতুন ডকুমেন্টের অনুরোধ',
    'appAgency.appAgencyOrgidCollectionNewPage.noAccountOrProfileIsNeeded':
      'এখনো কোনো অ্যাকাউন্ট বা প্রোফাইলের দরকার নেই। কিছু পাঠানোর আগে আপনি চেকলিস্টটি দেখে নিতে পারবেন।',
    'appAgency.appAgencyOrgidCollectionPage.acceptedAccepted': '{accepted}টি গ্রহণ করা হয়েছে',
    'appAgency.appAgencyOrgidCollectionPage.allAnswers': 'সব উত্তর',
    'appAgency.appAgencyOrgidCollectionPage.created': 'তৈরি করা হয়েছে',
    'appAgency.appAgencyOrgidCollectionPage.documentRequestsNewestFirst':
      'ডকুমেন্টের অনুরোধ, নতুনগুলো আগে',
    'appAgency.appAgencyOrgidCollectionPage.for': 'জন্য:',
    'appAgency.appAgencyOrgidCollectionPage.forPeopleWhoAreNotYour':
      'যাঁরা এখনো আপনার ক্লায়েন্ট নন, তাঁদের জন্য। তাঁরা উত্তর দেওয়ার সিদ্ধান্ত না নেওয়া পর্যন্ত কিছুই শেয়ার করা হয় না।',
    'appAgency.appAgencyOrgidCollectionPage.newRequest': 'নতুন অনুরোধ',
    'appAgency.appAgencyOrgidCollectionPage.noAnswersYet': 'এখনো কোনো উত্তর নেই',
    'appAgency.appAgencyOrgidCollectionPage.noDocumentRequestsYet': 'এখনো কোনো ডকুমেন্টের অনুরোধ নেই',
    'appAgency.appAgencyOrgidCollectionPage.noRequestsMatchBothFiltersTurn':
      'দুটি ফিল্টারের সঙ্গে মেলে এমন কোনো অনুরোধ নেই। আরও দেখতে একটি ফিল্টার বন্ধ করুন।',
    'appAgency.appAgencyOrgidCollectionPage.notNamedYet': 'এখনো নাম দেওয়া হয়নি',
    'appAgency.appAgencyOrgidCollectionPage.nothingIsWaitingForReviewNow':
      'এখন পর্যালোচনার জন্য কিছু অপেক্ষা করছে না।',
    'appAgency.appAgencyOrgidCollectionPage.showRequestsByAnswers': 'উত্তর অনুযায়ী অনুরোধ দেখান',
    'appAgency.appAgencyOrgidCollectionPage.showRequestsByStatus': 'অবস্থা অনুযায়ী অনুরোধ দেখান',
    'appAgency.appAgencyOrgidCollectionPage.showingYourNewestCollectionListLimit':
      'আপনার সবচেয়ে নতুন {COLLECTION_LIST_LIMIT}টি অনুরোধ দেখানো হচ্ছে, আর নিচের ফিল্টার ও সংখ্যা শুধু এগুলোর হিসাব। যে অনুরোধ আর দরকার নেই, সেগুলো বন্ধ করুন।',
    'appAgency.appAgencyOrgidCollectionPage.startOneWithNewRequestYou':
      'নতুন অনুরোধ দিয়ে শুরু করুন। আপনি এটি ব্যক্তিগত লিংক হিসেবে বা ইমেইলে ইস্যু করতে পারবেন।',
    'appAgency.appAgencyOrgidCollectionPage.status': 'অবস্থা',
    'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.suggestAChecklistCorrection':
      'চেকলিস্টে সংশোধনের প্রস্তাব দিন',
    'appAgency.appAgencyOrgidCollectionRequestPage.aboutThisRequest': 'এই অনুরোধ সম্পর্কে',
    'appAgency.appAgencyOrgidCollectionRequestPage.addAnItem': 'একটি আইটেম যোগ করুন',
    'appAgency.appAgencyOrgidCollectionRequestPage.checklist': 'চেকলিস্ট',
    'appAgency.appAgencyOrgidCollectionRequestPage.closeItWhenYouHaveWhat':
      'প্রয়োজনীয় সবকিছু পেয়ে গেলে এটি বন্ধ করুন, অথবা তুলে নিতে প্রত্যাহার করুন। দুই ক্ষেত্রেই সব লিংক কাজ করা বন্ধ করবে।',
    'appAgency.appAgencyOrgidCollectionRequestPage.copiedLink': 'লিংক কপি করা হয়েছে',
    'appAgency.appAgencyOrgidCollectionRequestPage.due': 'শেষ তারিখ',
    'appAgency.appAgencyOrgidCollectionRequestPage.endThisRequest': 'এই অনুরোধ শেষ করুন',
    'appAgency.appAgencyOrgidCollectionRequestPage.expires': 'মেয়াদ শেষের তারিখ',
    'appAgency.appAgencyOrgidCollectionRequestPage.issueAgain': 'আবার ইস্যু করুন',
    'appAgency.appAgencyOrgidCollectionRequestPage.issuedRevisions': 'ইস্যু করা সংশোধিত সংস্করণ',
    'appAgency.appAgencyOrgidCollectionRequestPage.issuingFreezesThisChecklistAsA':
      'ইস্যু করলে এই চেকলিস্ট একটি নম্বরযুক্ত সংস্করণ হিসেবে স্থির হয়ে যায়, যা আর কখনো বদলায় না, এবং একটি ব্যক্তিগত লিংক তৈরি হয়। আবার ইস্যু করলে পুরোনো লিংকগুলো বাতিল হয়ে নতুন সংস্করণের জন্য একটি লিংক পাওয়া যায়।',
    'appAgency.appAgencyOrgidCollectionRequestPage.knownDetails': 'জানা তথ্য',
    'appAgency.appAgencyOrgidCollectionRequestPage.lastOpened': 'শেষবার খোলা হয়েছে',
    'appAgency.appAgencyOrgidCollectionRequestPage.links': 'লিংক',
    'appAgency.appAgencyOrgidCollectionRequestPage.linksMadeForThisRequestNewest':
      'এই অনুরোধের জন্য তৈরি লিংক, নতুনগুলো আগে',
    'appAgency.appAgencyOrgidCollectionRequestPage.noDueDate': 'কোনো নির্ধারিত তারিখ নেই',
    'appAgency.appAgencyOrgidCollectionRequestPage.noItemsYetAddWhatYour':
      'এখনো কোনো আইটেম নেই। আপনার এজেন্সির যা দরকার, নিচে যোগ করুন।',
    'appAgency.appAgencyOrgidCollectionRequestPage.noneGiven': 'কিছু দেওয়া হয়নি',
    'appAgency.appAgencyOrgidCollectionRequestPage.notGiven': 'দেওয়া হয়নি',
    'appAgency.appAgencyOrgidCollectionRequestPage.notYet': 'এখনো নয়',
    'appAgency.appAgencyOrgidCollectionRequestPage.officialChecklistsThatFit':
      'মিলে যায় এমন অফিসিয়াল চেকলিস্ট',
    'appAgency.appAgencyOrgidCollectionRequestPage.revision': 'সংস্করণ',
    'appAgency.appAgencyOrgidCollectionRequestPage.sendByEmail': 'ইমেইলে পাঠান',
    'appAgency.appAgencyOrgidCollectionRequestPage.sentBy': 'যিনি পাঠিয়েছেন',
    'appAgency.appAgencyOrgidCollectionRequestPage.share': 'শেয়ার করুন',
    'appAgency.appAgencyOrgidCollectionRequestPage.specificRoute': 'নির্দিষ্ট রুট',
    'appAgency.appAgencyOrgidCollectionRequestPage.state': 'অবস্থা',
    'appAgency.appAgencyOrgidCollectionRequestPage.thisDraftCannotBeReadStart':
      'এই খসড়াটি পড়া যাচ্ছে না। এর বদলে একটি নতুন অনুরোধ শুরু করুন।',
    'appAgency.appAgencyOrgidCollectionRequestPage.thisRevisionNoLongerMatchesWhat':
      'এই সংস্করণটি আর ইস্যু করা সংস্করণের সঙ্গে মেলে না, তাই দেখানো হচ্ছে না। VisaStack সাপোর্টকে জানান।',
    'appAgency.appAgencyOrgidCollectionRequestPage.toFormatdateonly':
      ' থেকে {formatDateOnly} পর্যন্ত',
    'appAgency.appAgencyOrgidCollectionRequestPage.travelDates': 'ভ্রমণের তারিখ',
    'appAgency.appAgencyOrgidCollectionRequestPage.tryingAgain': '(আবার চেষ্টা করা হচ্ছে)',
    'appAgency.appAgencyOrgidDoNextList.doNext': 'এরপর করণীয়',
    'appAgency.appAgencyOrgidDoNextList.filteredView': 'ফিল্টার করা ভিউ',
    'appAgency.appAgencyOrgidDoNextList.forTheCasesInYourCurrent':
      'আপনার বর্তমান ভিউয়ের ভিসা ফাইলগুলোর জন্য। ',
    'appAgency.appAgencyOrgidDoNextList.howThisIsSorted': 'কীভাবে সাজানো হয়',
    'appAgency.appAgencyOrgidDoNextList.notTiedToOneCase': ' · কোনো একটি ভিসা ফাইলের সঙ্গে যুক্ত নয়',
    'appAgency.appAgencyOrgidDoNextList.nothingNeedsYouFirstRightNow':
      'এই মুহূর্তে প্রথমে আপনার মনোযোগ দরকার এমন কিছু নেই।',
    'appAgency.appAgencyOrgidDoNextList.overdueTasksOnTheCasesAssigned':
      'আপনাকে দায়িত্ব দেওয়া ভিসা ফাইলের সময় পেরিয়ে যাওয়া কাজ, যেটিতে সবচেয়ে বেশি দেরি হয়েছে সেটি আগে।',
    'appAgency.appAgencyOrgidDoNextList.owner': 'মালিক',
    'appAgency.appAgencyOrgidDoNextList.pastDueItemsFirstThenRequests':
      'প্রথমে শেষ তারিখ পেরিয়ে যাওয়া আইটেম, তারপর {CHASE_AFTER_DAYS} দিনের পরও উত্তর না আসা অনুরোধ, পর্যালোচনার অপেক্ষায় থাকা আইটেম, সময় পেরিয়ে যাওয়া কাজ এবং মালিকহীন ভিসা ফাইল।',
    'appAgency.appAgencyOrgidDoNextList.why': 'কেন',
    'appAgency.appAgencyOrgidEvidenceCopies.aboutDownloading': 'ডাউনলোড সম্পর্কে',
    'appAgency.appAgencyOrgidEvidenceCopies.aboutThisSend': 'এই পাঠানো সম্পর্কে',
    'appAgency.appAgencyOrgidEvidenceCopies.acceptedCopy': 'গ্রহণ করা কপি',
    'appAgency.appAgencyOrgidEvidenceCopies.cannotBeOpenedRightNow': 'এখন খোলা যাচ্ছে না।',
    'appAgency.appAgencyOrgidEvidenceCopies.copyWaitingForYourDecision':
      'আপনার সিদ্ধান্তের অপেক্ষায় থাকা কপি',
    'appAgency.appAgencyOrgidEvidenceCopies.downloadsTheOriginalYouConfirmIt':
      'মূল ডকুমেন্টটি ডাউনলোড হবে। আগে আপনাকে নিশ্চিত করতে হবে যে এটি আপনিই।',
    'appAgency.appAgencyOrgidEvidenceCopies.earlierSendsEarliercount': 'আগে পাঠানো ({earlierCount})',
    'appAgency.appAgencyOrgidEvidenceCopies.receivedIsNotAccepted':
      'পাওয়া গেছে মানে গ্রহণ করা হয়েছে, এমন নয়।',
    'appAgency.appAgencyOrgidEvidenceCopies.sendTimeNotKept': 'পাঠানোর সময় রাখা হয়নি',
    'appAgency.appAgencyOrgidEvidenceCopies.thisCopyCannotBeOpenedFrom':
      'এই কপিটি এখন এখান থেকে খোলা যাচ্ছে না। হয়তো এটি এখনো পরীক্ষা করা হচ্ছে, অথবা অ্যাক্সেস শেষ হয়ে থাকতে পারে।',
    'appAgency.appAgencyOrgidEvidenceCopies.thisSendHasNoExactCopy':
      'এই পাঠানো ডকুমেন্টের হুবহু কপি এখানে খোলার মতো নেই। নিচে এটি গ্রহণ করুন অথবা ফেরত পাঠান।',
    'appAgency.appAgencyOrgidEvidenceCopies.waitingForADecision': 'সিদ্ধান্তের অপেক্ষায়',
    'appAgency.appAgencyOrgidEvidenceCopies.whyNot': 'কেন নয়?',
    'appAgency.appAgencyOrgidEvidenceCopies.yourReasonShownToTheTraveller':
      'আপনার কারণ, যা ভ্রমণকারী দেখবেন: {reason}',
    'appAgency.appAgencyOrgidEvidencePicker.anyOneOfThese': 'এগুলোর যেকোনো একটি',
    'appAgency.appAgencyOrgidEvidencePicker.askForAllMissingLength': 'বাকি সবগুলো চান ({length})',
    'appAgency.appAgencyOrgidEvidencePicker.chooseAsManyAsYouNeed':
      'যতগুলো দরকার বেছে নিন, তারপর একসঙ্গে পাঠান।',
    'appAgency.appAgencyOrgidEvidencePicker.forExampleNidTradeLicenceSolvency':
      'যেমন: জাতীয় পরিচয়পত্র, ট্রেড লাইসেন্স, সলভেন্সি সনদ',
    'appAgency.appAgencyOrgidEvidencePicker.noMatches': 'কিছু মেলেনি।',
    'appAgency.appAgencyOrgidEvidencePicker.nothingMatchesTrimNotInThe':
      '“{trim}”-এর সঙ্গে কিছু মেলেনি। তালিকায় নেই? অন্য ডকুমেন্ট বেছে নিন এবং মেসেজে ব্যাখ্যা করুন।',
    'appAgency.appAgencyOrgidEvidencePicker.onlyTheFirstMaxAskItems':
      'শুধু প্রথম {MAX_ASK_ITEMS}টিতে টিক দেওয়া আছে। এগুলো পাঠান, তারপর বাকিগুলো চান।',
    'appAgency.appAgencyOrgidEvidencePicker.searchDocumentsAndDetails': 'ডকুমেন্ট ও তথ্য খুঁজুন',
    'appAgency.appAgencyOrgidEvidencePicker.theTravellerNeedsOnlyOneOf':
      'ভ্রমণকারীর এগুলোর মধ্যে শুধু একটি দিলেই চলবে।',
    'appAgency.appAgencyOrgidEvidencePicker.totalMatches': '{total}টি মিল।',
    'appAgency.appAgencyOrgidEvidenceRequestActions.contradiction': 'অসংগতি',
    'appAgency.appAgencyOrgidEvidenceRequestActions.moreDecisions': 'আরও সিদ্ধান্ত',
    'appAgency.appAgencyOrgidEvidenceRequestActions.needsReplacement': 'বদলাতে হবে',
    'appAgency.appAgencyOrgidEvidenceRequestActions.proposeCorrection': 'সংশোধনের প্রস্তাব দিন',
    'appAgency.appAgencyOrgidEvidenceRequestActions.reason': 'কারণ',
    'appAgency.appAgencyOrgidEvidenceRequestActions.refresh': 'রিফ্রেশ করুন',
    'appAgency.appAgencyOrgidEvidenceTray.clearAll': 'সব মুছে দিন',
    'appAgency.appAgencyOrgidEvidenceTray.detail': 'বিস্তারিত',
    'appAgency.appAgencyOrgidEvidenceTray.maxAskItemsIsTheMost':
      'একবারে সর্বোচ্চ {MAX_ASK_ITEMS}টি পাঠানো যায়।',
    'appAgency.appAgencyOrgidEvidenceTray.nothingSelectedYetTickWhatYou':
      'এখনো কিছু বাছাই করা হয়নি। দরকারি জিনিসগুলো উপরে টিক দিন।',
    'appAgency.appAgencyOrgidEvidenceTray.remove': 'সরান',
    'appAgency.appAgencyOrgidEvidenceTray.selectedLength': 'বাছাই করা ({length})',
    'appAgency.appAgencyOrgidFollowUpCopy.followUp': 'ফলো-আপ',
    'appAgency.appAgencyOrgidFollowUpCopy.messageToCopy': 'কপি করার বার্তা',
    'appAgency.appAgencyOrgidFollowUpCopy.readItFirstItIsNot':
      'আগে এটি পড়ে নিন। এটি আপনার হয়ে পাঠানো হয় না: WhatsApp থেকে পাঠান, অথবা নিজের ইমেইল বা বার্তায় পেস্ট করুন।',
    'appAgency.appAgencyOrgidFollowUpCopy.yourNoteWasLeftOutBecause':
      'আপনার নোটে লিংক, ইমেইল ঠিকানা বা লম্বা নম্বর থাকায় সেটি বাদ দেওয়া হয়েছে। এর বদলে প্রচলিত বাক্য ব্যবহার করা হয়েছে।',
    'appAgency.appAgencyOrgidLayout.youDonTHaveARole':
      'এই প্রতিষ্ঠানে আপনার কোনো ভূমিকা নেই। আপনাকে সদস্য হিসেবে যোগ করতে একজন মালিক বা অ্যাডমিনকে বলুন।',
    'appAgency.appAgencyOrgidMemberForm.admin': 'অ্যাডমিন',
    'appAgency.appAgencyOrgidMemberForm.caseManager': 'ভিসা ফাইল ম্যানেজার',
    'appAgency.appAgencyOrgidMemberForm.memberEmail': 'সদস্যের ইমেইল',
    'appAgency.appAgencyOrgidMemberForm.reviewer': 'পর্যালোচক',
    'appAgency.appAgencyOrgidMemberForm.role': 'ভূমিকা',
    'appAgency.appAgencyOrgidMemberForm.teammateExampleCom': 'teammate@example.com',
    'appAgency.appAgencyOrgidMissionCollaboration.accept': 'গ্রহণ করুন',
    'appAgency.appAgencyOrgidMissionCollaboration.addACaseNote': 'ভিসা ফাইলের একটি নোট যোগ করুন…',
    'appAgency.appAgencyOrgidMissionCollaboration.addATask': 'কাজ যোগ করুন…',
    'appAgency.appAgencyOrgidMissionCollaboration.appointmentTitle': 'অ্যাপয়েন্টমেন্টের শিরোনাম',
    'appAgency.appAgencyOrgidMissionCollaboration.appointmentTitle1de530': 'অ্যাপয়েন্টমেন্টের শিরোনাম',
    'appAgency.appAgencyOrgidMissionCollaboration.appointments': 'অ্যাপয়েন্টমেন্ট',
    'appAgency.appAgencyOrgidMissionCollaboration.assignAMember': 'একজন সদস্যকে দায়িত্ব দিন…',
    'appAgency.appAgencyOrgidMissionCollaboration.assigned': 'দায়িত্ব দেওয়া হয়েছে',
    'appAgency.appAgencyOrgidMissionCollaboration.caseNote': 'ভিসা ফাইলের নোট',
    'appAgency.appAgencyOrgidMissionCollaboration.caseNotea939f0': 'ভিসা ফাইলের নোট',
    'appAgency.appAgencyOrgidMissionCollaboration.caseReference': 'ভিসা ফাইলের রেফারেন্স',
    'appAgency.appAgencyOrgidMissionCollaboration.channel': 'চ্যানেল',
    'appAgency.appAgencyOrgidMissionCollaboration.confirmed': 'নিশ্চিত করা হয়েছে',
    'appAgency.appAgencyOrgidMissionCollaboration.contactMethod': 'যোগাযোগের মাধ্যম',
    'appAgency.appAgencyOrgidMissionCollaboration.contactMethoda30e73': 'যোগাযোগের মাধ্যম',
    'appAgency.appAgencyOrgidMissionCollaboration.date': 'তারিখ',
    'appAgency.appAgencyOrgidMissionCollaboration.decision': 'সিদ্ধান্ত',
    'appAgency.appAgencyOrgidMissionCollaboration.decisionReason': 'সিদ্ধান্তের কারণ',
    'appAgency.appAgencyOrgidMissionCollaboration.decisions': 'সিদ্ধান্ত',
    'appAgency.appAgencyOrgidMissionCollaboration.dueDateOptional': 'শেষ তারিখ (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidMissionCollaboration.eGHmPassportOffice': 'যেমন এইচএম পাসপোর্ট অফিস',
    'appAgency.appAgencyOrgidMissionCollaboration.eGPhone44': 'যেমন ফোন: +44...',
    'appAgency.appAgencyOrgidMissionCollaboration.eGVisaInterviewPrepCall':
      'যেমন: ভিসা ইন্টারভিউ প্রস্তুতির কল',
    'appAgency.appAgencyOrgidMissionCollaboration.exactClaim': 'হুবহু দাবি',
    'appAgency.appAgencyOrgidMissionCollaboration.exactClaim9528fc': 'হুবহু দাবি',
    'appAgency.appAgencyOrgidMissionCollaboration.exactClaimConfirmed': 'দাবিটি হুবহু নিশ্চিত করা হয়েছে',
    'appAgency.appAgencyOrgidMissionCollaboration.expired': 'মেয়াদ শেষ হয়েছে',
    'appAgency.appAgencyOrgidMissionCollaboration.internal': 'অভ্যন্তরীণ',
    'appAgency.appAgencyOrgidMissionCollaboration.internalThisOrgOnly': 'অভ্যন্তরীণ (শুধু এই প্রতিষ্ঠান)',
    'appAgency.appAgencyOrgidMissionCollaboration.issuer': 'ইস্যুকারী',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerConfirmations': 'ইস্যুকারীর নিশ্চিতকরণ',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerIdentity': 'ইস্যুকারীর পরিচয়',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerResponse': 'ইস্যুকারীর উত্তর',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerResponseff74b8': 'ইস্যুকারীর উত্তর',
    'appAgency.appAgencyOrgidMissionCollaboration.issuerSResponse': 'ইস্যুকারীর উত্তর',
    'appAgency.appAgencyOrgidMissionCollaboration.memberToAssign': 'যে সদস্যকে দায়িত্ব দেবেন',
    'appAgency.appAgencyOrgidMissionCollaboration.noAppointmentsScheduled':
      'কোনো অ্যাপয়েন্টমেন্ট নির্ধারিত নেই।',
    'appAgency.appAgencyOrgidMissionCollaboration.noDecisionsRecordedYet':
      'এখনো কোনো সিদ্ধান্ত রেকর্ড করা হয়নি।',
    'appAgency.appAgencyOrgidMissionCollaboration.noIssuerConfirmedYetLackOf':
      'এখনো কোনো ইস্যুকারী নিশ্চিত করেননি। শুধু এটি না থাকলে প্রস্তুতিতে ঘাটতি ধরা হয় না।',
    'appAgency.appAgencyOrgidMissionCollaboration.noNotesYet': 'এখনো কোনো নোট নেই।',
    'appAgency.appAgencyOrgidMissionCollaboration.noOpenTasks': 'কোনো খোলা কাজ নেই।',
    'appAgency.appAgencyOrgidMissionCollaboration.nobodyAssignedYet': 'এখনো কাউকে দায়িত্ব দেওয়া হয়নি।',
    'appAgency.appAgencyOrgidMissionCollaboration.noteVisibility': 'নোট কারা দেখতে পাবেন',
    'appAgency.appAgencyOrgidMissionCollaboration.notes': 'নোট',
    'appAgency.appAgencyOrgidMissionCollaboration.onlyAnAssignedMemberCanRecord':
      'শুধু দায়িত্বপ্রাপ্ত সদস্যই সিদ্ধান্ত রেকর্ড করতে পারেন।',
    'appAgency.appAgencyOrgidMissionCollaboration.place': 'স্থান',
    'appAgency.appAgencyOrgidMissionCollaboration.priority': 'অগ্রাধিকার',
    'appAgency.appAgencyOrgidMissionCollaboration.reasonOptional': 'কারণ (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidMissionCollaboration.reject': 'প্রত্যাখ্যান করুন',
    'appAgency.appAgencyOrgidMissionCollaboration.requirement': 'প্রয়োজনীয় আইটেম',
    'appAgency.appAgencyOrgidMissionCollaboration.requirementThisConfirmationCovers':
      'এই নিশ্চিতকরণ যে প্রয়োজনীয়তার জন্য',
    'appAgency.appAgencyOrgidMissionCollaboration.requirementf6daff': 'প্রয়োজনীয়তা…',
    'appAgency.appAgencyOrgidMissionCollaboration.requiresEvidenceAlreadySelectedForThat':
      'ওই শর্তের জন্য আগে থেকে বেছে নেওয়া প্রমাণ লাগবে; শুধু স্টাফের টিক চিহ্ন কখনোই নিশ্চিতকরণ হিসেবে গ্রহণ করা হয় না।',
    'appAgency.appAgencyOrgidMissionCollaboration.sharedWithTraveller':
      'ভ্রমণকারীর সঙ্গে শেয়ার করা হয়েছে',
    'appAgency.appAgencyOrgidMissionCollaboration.taskDescription': 'কাজের বিবরণ',
    'appAgency.appAgencyOrgidMissionCollaboration.taskDescription9f2652': 'কাজের বিবরণ',
    'appAgency.appAgencyOrgidMissionCollaboration.tasks': 'কাজ',
    'appAgency.appAgencyOrgidMissionCollaboration.time': 'সময়',
    'appAgency.appAgencyOrgidMissionCollaboration.timeZone': 'টাইম জোন',
    'appAgency.appAgencyOrgidMissionCollaboration.unassigned': 'দায়িত্বে কেউ নেই',
    'appAgency.appAgencyOrgidMissionCollaboration.validUntil': 'যে তারিখ পর্যন্ত বৈধ',
    'appAgency.appAgencyOrgidMissionCollaboration.validUntil4852df': 'যে তারিখ পর্যন্ত বৈধ',
    'appAgency.appAgencyOrgidMissionCollaboration.visibility': 'কে দেখতে পারবেন',
    'appAgency.appAgencyOrgidMissionCollaboration.visibilityb5de1d': 'কে দেখতে পারবেন…',
    'appAgency.appAgencyOrgidOrgBrandingHeader.nameLogo': '{name} লোগো',
    'appAgency.appAgencyOrgidPage.aboutThisList': 'এই তালিকা সম্পর্কে',
    'appAgency.appAgencyOrgidPage.acknowledgedFormattimestampdate':
      'স্বীকার করা হয়েছে {formatTimestampDate}',
    'appAgency.appAgencyOrgidPage.activeCasesThisOrganizationCanStill':
      'যেসব সক্রিয় ভিসা ফাইলে এই প্রতিষ্ঠান এখনো কাজ করতে পারে কিন্তু বর্তমানে কেউ দায়িত্বে নেই - সাধারণত একমাত্র দায়িত্বপ্রাপ্ত সদস্যকে সরিয়ে দেওয়ায় এমন হয়। ভিসা ফাইল অংশে গিয়ে একটি খুলে কাউকে দায়িত্ব দিন।',
    'appAgency.appAgencyOrgidPage.activeClients': 'সক্রিয় ক্লায়েন্ট',
    'appAgency.appAgencyOrgidPage.actualStageCountsAppearWhenA':
      'ভিসা ফাইল শেয়ার করা হলে এবং আপনি তা দেখতে পারলে প্রকৃত ধাপের সংখ্যা এখানে দেখা যাবে।',
    'appAgency.appAgencyOrgidPage.agencyOverview': 'এজেন্সির সারসংক্ষেপ',
    'appAgency.appAgencyOrgidPage.assignedCases': 'দায়িত্ব দেওয়া ভিসা ফাইল',
    'appAgency.appAgencyOrgidPage.assignedToYou': 'আপনাকে দায়িত্ব দেওয়া হয়েছে',
    'appAgency.appAgencyOrgidPage.case': 'ভিসা ফাইল',
    'appAgency.appAgencyOrgidPage.casePipeline': 'ভিসা ফাইলের অগ্রগতি',
    'appAgency.appAgencyOrgidPage.casesAndAttention': 'ভিসা ফাইল ও মনোযোগ দরকার এমন বিষয়',
    'appAgency.appAgencyOrgidPage.casesMostUrgentFirst': 'ভিসা ফাইল, সবচেয়ে জরুরি আগে',
    'appAgency.appAgencyOrgidPage.casesThatNeedActionComeFirst':
      'যেসব ভিসা ফাইলে পদক্ষেপ দরকার সেগুলো আগে দেখানো হয়।',
    'appAgency.appAgencyOrgidPage.casesWithNobodyAssigned': 'যেসব ভিসা ফাইলে কেউ দায়িত্বে নেই',
    'appAgency.appAgencyOrgidPage.casesYouCanSee': 'আপনি যেসব ভিসা ফাইল দেখতে পারেন',
    'appAgency.appAgencyOrgidPage.clientsJoined': 'যে ক্লায়েন্টরা যোগ দিয়েছেন',
    'appAgency.appAgencyOrgidPage.clientsJoinedd73060': 'যে ক্লায়েন্টরা যোগ দিয়েছেন',
    'appAgency.appAgencyOrgidPage.clientsYouCanWorkWith': 'যেসব ক্লায়েন্টের সঙ্গে আপনি কাজ করতে পারেন',
    'appAgency.appAgencyOrgidPage.deadline': 'শেষ তারিখ',
    'appAgency.appAgencyOrgidPage.evidenceRequest': 'প্রমাণের অনুরোধ',
    'appAgency.appAgencyOrgidPage.evidenceRequestsWaitingOnTheTraveller':
      'ভ্রমণকারীর উত্তরের অপেক্ষায় থাকা প্রমাণের অনুরোধ',
    'appAgency.appAgencyOrgidPage.joinedInTheLast30Days': 'গত ৩০ দিনে যোগ দিয়েছেন',
    'appAgency.appAgencyOrgidPage.lengthActiveMembersInactiveMembershipsRemain':
      '{length} জন সক্রিয় সদস্য। নিষ্ক্রিয় সদস্যপদ টিম ব্যবস্থাপনায় পাওয়া যাবে।',
    'appAgency.appAgencyOrgidPage.manageRequests': 'অনুরোধ পরিচালনা করুন',
    'appAgency.appAgencyOrgidPage.manageTeam': 'টিম পরিচালনা করুন',
    'appAgency.appAgencyOrgidPage.manualMode': 'ম্যানুয়াল মোড',
    'appAgency.appAgencyOrgidPage.needsAssignment': 'দায়িত্ব দিতে হবে',
    'appAgency.appAgencyOrgidPage.needsAttention': 'মনোযোগ দরকার',
    'appAgency.appAgencyOrgidPage.noCaseStagesToShow': 'দেখানোর মতো কোনো ভিসা ফাইলের ধাপ নেই',
    'appAgency.appAgencyOrgidPage.noCasesMatchThatSearch': 'এই শব্দে খুঁজে কোনো ভিসা ফাইল মেলেনি।',
    'appAgency.appAgencyOrgidPage.noEvidenceRequestsYet': 'এখনো কোনো প্রমাণের অনুরোধ নেই।',
    'appAgency.appAgencyOrgidPage.noPackAttached': 'কোনো প্যাক যুক্ত নেই',
    'appAgency.appAgencyOrgidPage.notSet': 'ঠিক করা হয়নি',
    'appAgency.appAgencyOrgidPage.notYetAcknowledged': 'এখনো প্রাপ্তিস্বীকার করা হয়নি',
    'appAgency.appAgencyOrgidPage.nothing': 'কিছু নেই',
    'appAgency.appAgencyOrgidPage.nothingIsOverdueUnassignedOrWaiting':
      'এই মুহূর্তে সময় পেরিয়ে যাওয়া, দায়িত্বহীন বা ভ্রমণকারীর উত্তরের অপেক্ষায় থাকা কিছু নেই।',
    'appAgency.appAgencyOrgidPage.openAssignedCases': 'দায়িত্ব দেওয়া ভিসা ফাইল খুলুন',
    'appAgency.appAgencyOrgidPage.openCases': 'খোলা ভিসা ফাইল',
    'appAgency.appAgencyOrgidPage.overdueTasks': 'সময় পেরিয়ে যাওয়া কাজ',
    'appAgency.appAgencyOrgidPage.pendingRequests': 'অপেক্ষমাণ অনুরোধ',
    'appAgency.appAgencyOrgidPage.quickViewsOfTheCaseList': 'ভিসা ফাইল তালিকার দ্রুত ভিউ',
    'appAgency.appAgencyOrgidPage.readiness': 'প্রস্তুতি',
    'appAgency.appAgencyOrgidPage.readinessUnavailable': 'প্রস্তুতির তথ্য পাওয়া যাচ্ছে না',
    'appAgency.appAgencyOrgidPage.ready': 'প্রস্তুত',
    'appAgency.appAgencyOrgidPage.reassignmentQueue': 'পুনরায় দায়িত্ব দেওয়ার তালিকা',
    'appAgency.appAgencyOrgidPage.recentNotesFromCasesYouCan':
      'আপনি বর্তমানে যেসব ভিসা ফাইলে অ্যাক্সেস পান, সেগুলোর সাম্প্রতিক নোট। এটি প্রতিষ্ঠানের পূর্ণ অডিট লগ নয়।',
    'appAgency.appAgencyOrgidPage.recentRequestsAvailableToYourAdministrator':
      'আপনার অ্যাডমিন ভূমিকায় যেসব সাম্প্রতিক অনুরোধ দেখা যায়।',
    'appAgency.appAgencyOrgidPage.requestsAndTeam': 'অনুরোধ ও টিম',
    'appAgency.appAgencyOrgidPage.requestsAndTeamManagementBelongTo':
      'অনুরোধ ও টিম পরিচালনা এজেন্সির অ্যাডমিনদের দায়িত্ব। আপনাকে দায়িত্ব দেওয়া ভিসা ফাইলের টুল আগের মতোই পাবেন।',
    'appAgency.appAgencyOrgidPage.reviewissuesNeedsReplacement': '{reviewIssues} বদলাতে হবে',
    'appAgency.appAgencyOrgidPage.searchCoversOnlyTheCasesYou':
      'খোঁজা শুধু সেইসব ভিসা ফাইলে হয়, যেগুলো দেখার অনুমতি আপনার আগে থেকেই আছে - ভ্রমণকারী, ভিসা ফাইলের শিরোনাম, রেফারেন্স, গন্তব্য বা ধাপ দিয়ে।',
    'appAgency.appAgencyOrgidPage.setUpYourAgency': 'আপনার এজেন্সি সেট আপ করুন',
    'appAgency.appAgencyOrgidPage.teamMembers': 'টিমের সদস্য',
    'appAgency.appAgencyOrgidPage.traveller': 'ভ্রমণকারী',
    'appAgency.appAgencyOrgidPage.travellerConfirmed': 'ভ্রমণকারী নিশ্চিত করেছেন',
    'appAgency.appAgencyOrgidPage.viewAccessibleCaseActivity': 'অ্যাক্সেসযোগ্য ভিসা ফাইলের কার্যকলাপ দেখুন',
    'appAgency.appAgencyOrgidPage.viewAllCases': 'সব ভিসা ফাইল দেখুন',
    'appAgency.appAgencyOrgidPage.whatNeedsYouFirst': 'প্রথমে কী আপনার মনোযোগ চায়',
    'appAgency.appAgencyOrgidPage.youReAMemberOfThis':
      'আপনি এই প্রতিষ্ঠানের সদস্য, কিন্তু অ্যাডমিন নন। প্রমাণ চাওয়া, একসঙ্গে এক্সপোর্ট এবং সদস্য পরিচালনা শুধু অ্যাডমিনদের জন্য - তবে ভিসা ফাইল অংশে আপনাকে যেসব ভিসা ফাইলে দায়িত্ব দেওয়া হয়েছে, সেখানে আপনি এখনো সহযোগিতা করতে পারবেন।',
    'appAgency.appAgencyOrgidPage.yourCaseWork': 'আপনার ভিসা ফাইলের কাজ',
    'appAgency.appAgencyOrgidPage.yourTeam': 'আপনার টিম',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadProof': 'প্রমাণ ডাউনলোড করুন',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.downloadReceiptPdf': 'রসিদ ডাউনলোড করুন (PDF)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.invoiced': 'ইনভয়েস করা হয়েছে',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.keptAfterRefunds': 'ফেরত দেওয়ার পর বাকি',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.onlinePayments': 'অনলাইন পেমেন্ট',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.onlinePaymentsForInvoiceref':
      '{invoiceRef}-এর অনলাইন পেমেন্ট',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.payInvoiceref': '{invoiceRef} পরিশোধ করুন',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReportedWeAreCheckingIt':
      'পেমেন্টের তথ্য জানানো হয়েছে: আমরা এটি দেখছি। সিদ্ধান্ত হয়ে গেলে আপনি অনলাইনে পেমেন্ট করতে বা অন্য একটি পেমেন্টের তথ্য জানাতে পারবেন।',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReportedWeAreCheckingIt7bdaca':
      'পেমেন্টের তথ্য জানানো হয়েছে: আমরা এটি দেখছি। দেখা শেষ হলে আমরা এই ইনভয়েস হালনাগাদ করব।',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReports': 'পেমেন্টের তথ্য',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.paymentReportsForInvoiceref':
      '{invoiceRef}-এর পেমেন্টের তথ্য',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.receipts': 'রসিদ',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.receiptsForInvoiceref': '{invoiceRef}-এর রসিদ',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceCard.refunded': 'ফেরত দেওয়া হয়েছে',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aPhotoOrScreenshotJpegOr':
      'একটি ছবি বা স্ক্রিনশট (JPEG বা PNG) অথবা একটি PDF, ৪ MB-এর কম। শুধু আপনার প্রতিষ্ঠানের মালিক ও অ্যাডমিনরা এবং VisaStack-এর কর্মীরা এটি খুলতে পারেন। কোনো ত্রুটির পর আবার জানালে ডকুমেন্টটি আবার বেছে নিন।',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.aTransferIdBkashTransactionId':
      'ট্রান্সফার আইডি, বিকাশ ট্রানজ্যাকশন আইডি বা চেক নম্বর।',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.amountPaidCurrency':
      'পরিশোধিত অঙ্ক ({currency})',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.datePaid': 'পেমেন্টের তারিখ',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.howYouPaid': 'কীভাবে পেমেন্ট করেছেন',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.iPaidAnotherWay': 'আমি অন্যভাবে পেমেন্ট করেছি',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.noteOptional': 'নোট (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.paymentReference': 'পেমেন্ট রেফারেন্স',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.proofOfPaymentOptional':
      'পেমেন্টের প্রমাণ (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidPlanInvoicesInvoiceForms.tellUsAboutAPaymentYou':
      'ব্যাংক ট্রান্সফার, বিকাশ বা চেকের মাধ্যমে আগেই করা কোনো পেমেন্টের কথা আমাদের জানান। VisaStack নিশ্চিত না করা পর্যন্ত কিছুই হিসাবে ধরা হয় না।',
    'appAgency.appAgencyOrgidPlanInvoicesPage.invoices': 'ইনভয়েস',
    'appAgency.appAgencyOrgidPlanInvoicesPage.noInvoicesYetWhenVisastackIssues':
      'এখনো কোনো ইনভয়েস নেই। VisaStack আপনার প্ল্যানের জন্য ইনভয়েস ইস্যু করলে তা এখানে দেখা যাবে।',
    'appAgency.appAgencyOrgidPlanInvoicesPage.onlyOwnersAndAdminsCanSee':
      'শুধু মালিক ও অ্যাডমিনরা ইনভয়েস দেখতে ও পেমেন্ট করতে পারেন।',
    'appAgency.appAgencyOrgidPlanInvoicesPage.payAnInvoiceOnlineOrTell':
      'অনলাইনে ইনভয়েসের পেমেন্ট করুন, অথবা অন্যভাবে করা পেমেন্টের কথা আমাদের জানান। আপনার রসিদ এখানে রাখা থাকে।',
    'appAgency.appAgencyOrgidPlanInvoicesPage.usageBilling': 'ব্যবহার ও বিলিং',
    'appAgency.appAgencyOrgidPlanInvoicesReceiptsReceiptidPage.agency': 'এজেন্সি',
    'appAgency.appAgencyOrgidPlanPage.accessOfferNotRecorded': 'অ্যাক্সেস অফার রেকর্ড করা হয়নি',
    'appAgency.appAgencyOrgidPlanPage.aiFeatures': 'এআই সুবিধা',
    'appAgency.appAgencyOrgidPlanPage.anAccessOfferHasNotBeen':
      'এই প্রতিষ্ঠানের জন্য কোনো অ্যাক্সেস অফার রেকর্ড করা হয়নি। আপনার মাপা ব্যবহার নিচে দেখানো হয়েছে। রেকর্ডের অনুমতি ও নিরাপত্তা পরীক্ষা তবুও প্রযোজ্য।',
    'appAgency.appAgencyOrgidPlanPage.complimentaryDuringPublicBetaNoPayment':
      'পাবলিক বিটা চলাকালে বিনামূল্যে। কোনো পেমেন্ট পদ্ধতি লাগে না। ন্যায্য ব্যবহারের সুরক্ষা এবং ব্যক্তিগত রেকর্ডের অনুমতি এখনও প্রযোজ্য। স্টোরেজ ও প্রক্রিয়াকরণ উপলব্ধ সক্ষমতার ওপর নির্ভরশীল থাকে।',
    'appAgency.appAgencyOrgidPlanPage.currentPlan': 'বর্তমান প্ল্যান',
    'appAgency.appAgencyOrgidPlanPage.everythingInVisastackWorksWithoutAi':
      'এআই ফিচার ছাড়াই VisaStack-এর সবকিছু কাজ করে, আর প্রত্যেক ব্যক্তির নিজের এআই ব্যবহার VisaStack-এর সেটিংস মেনে চলে।',
    'appAgency.appAgencyOrgidPlanPage.shownForYourInformationItDoes':
      ' শুধু আপনার জানার জন্য দেখানো হয়েছে; এতে কোনো কাজ থামে না।',
    'appAgency.appAgencyOrgidPlanPage.usage': 'ব্যবহার',
    'appAgency.appAgencyOrgidPlanPage.whatYourPlanIncludes': 'আপনার প্ল্যানে যা আছে',
    'appAgency.appAgencyOrgidPlanPage.youDonTHaveAccessTo': 'এই প্রতিষ্ঠানের প্ল্যানে আপনার অ্যাক্সেস নেই।',
    'appAgency.appAgencyOrgidPlanPage.yourAgencySPlanAndHow':
      'আপনার এজেন্সির প্ল্যান এবং এর কতটা ব্যবহার হচ্ছে। প্রতিটি সীমা আপনার প্ল্যান থেকে আসে।',
    'appAgency.appAgencyOrgidRequestConversation.conversation': 'কথোপকথন',
    'appAgency.appAgencyOrgidRequestEvidenceForm.case': 'ভিসা ফাইল',
    'appAgency.appAgencyOrgidRequestEvidenceForm.chooseATraveller': 'একজন ভ্রমণকারী বেছে নিন…',
    'appAgency.appAgencyOrgidRequestEvidenceForm.dueDateOptional': 'শেষ তারিখ (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidRequestEvidenceForm.forApplicantnameCasetitle':
      '{applicantName}-এর জন্য, {caseTitle}',
    'appAgency.appAgencyOrgidRequestEvidenceForm.forExampleNeededForTheVisa':
      'যেমন: ভিসা ফর্মের জন্য দরকার',
    'appAgency.appAgencyOrgidRequestEvidenceForm.messageOptional': 'বার্তা (ঐচ্ছিক)',
    'appAgency.appAgencyOrgidRequestEvidenceForm.noTravellerHasGrantedThisOrganization':
      'এখনো কোনো ভ্রমণকারী এই প্রতিষ্ঠানকে অ্যাক্সেস দেননি। অনুরোধ করার মতো কিছু নেই।',
    'appAgency.appAgencyOrgidRequestEvidenceForm.onlyIfAccessIsLimitedTo':
      'শুধু তখনই, যখন অ্যাক্সেস একটি ভিসা ফাইলে সীমাবদ্ধ।',
    'appAgency.appAgencyOrgidRequestEvidenceForm.theMessageAndTheDueDate':
      'প্রতিটি আইটেমের সঙ্গে বার্তা ও শেষ তারিখ যায়।',
    'appAgency.appAgencyOrgidRequestEvidenceForm.traveller': 'ভ্রমণকারী',
    'appAgency.appAgencyOrgidRequestEvidenceForm.wholeTravellerRecordDefault':
      'ভ্রমণকারীর পূর্ণ রেকর্ড (ডিফল্ট)',
    'appAgency.appAgencyOrgidSettingsPage.branding': 'ব্র্যান্ডিং',
    'appAgency.appAgencyOrgidSettingsPage.bulkExport': 'একসঙ্গে এক্সপোর্ট',
    'appAgency.appAgencyOrgidSettingsPage.downloadBulkExport': 'একসঙ্গে এক্সপোর্ট ডাউনলোড করুন',
    'appAgency.appAgencyOrgidSettingsPage.downloadTheProfilesOfEveryTraveller':
      'যেসব ভ্রমণকারী এই প্রতিষ্ঠানকে গ্রহণ করা এক্সপোর্ট-অনুমতি দিয়েছেন, তাঁদের সবার প্রোফাইল ডাউনলোড করুন। এক্সপোর্টের সময় প্রতিটি ভ্রমণকারীর অনুমতি নীতি-ব্যবস্থায় আবার পরীক্ষা করা হয়।',
    'appAgency.appAgencyOrgidSettingsPage.export': 'এক্সপোর্ট',
    'appAgency.appAgencyOrgidSettingsPage.manageAiConnections': 'এআই সংযোগ পরিচালনা করুন',
    'appAgency.appAgencyOrgidSettingsPage.off': 'বন্ধ',
    'appAgency.appAgencyOrgidSettingsPage.on': 'চালু',
    'appAgency.appAgencyOrgidSettingsPage.reviewPolicy': 'পর্যালোচনার নীতি',
    'appAgency.appAgencyOrgidSettingsPage.settings': 'সেটিংস',
    'appAgency.appAgencyOrgidSettingsPage.settingsAreLimitedToThisOrganization':
      'সেটিংস শুধু এই প্রতিষ্ঠানের মালিক ও অ্যাডমিনদের জন্য।',
    'appAgency.appAgencyOrgidSettingsPage.status': 'অবস্থা',
    'appAgency.appAgencyOrgidSettingsPage.whenThisIsOnAnOwner':
      'এটি চালু থাকলে একজন মালিক বা অ্যাডমিন ChatGPT বা Claude-এর মতো একটি এআই অ্যাপ সংযুক্ত করতে পারেন, যা শুধু সেটুকুই পড়ে, যা প্রত্যেক ভ্রমণকারী এই এজেন্সির এআই টুলকে পড়তে দিয়েছেন। শুরুতে বন্ধ থাকে।',
    'appAgency.appAgencyOrgidSettingsPage.yourLogoYourAgencyNameAnd':
      'আপনার লোগো, আপনার এজেন্সির নাম এবং একটি অ্যাকসেন্ট রং। এগুলো এই পুরো ওয়ার্কস্পেসে এবং আপনার পাঠানো আমন্ত্রণে দেখা যায়। পাশে সবসময় "VisaStack দ্বারা চালিত" লেখাটি থাকে, এবং আপনার ব্র্যান্ডিং কখনো অন্য কোনো এজেন্সির ওয়ার্কস্পেসে দেখা যায় না।',
    'appAgency.appAgencyOrgidTeamPage.active': 'সক্রিয়',
    'appAgency.appAgencyOrgidTeamPage.allowDocumentRequestsLetsAMember':
      '"ডকুমেন্টের অনুরোধের অনুমতি" চালু থাকলে একজন সদস্য নিজে ডকুমেন্টের অনুরোধ তৈরি করে পাঠাতে পারেন। মানুষ যা ফেরত পাঠান, তা শুধু মালিক ও অ্যাডমিনরা দেখেন।',
    'appAgency.appAgencyOrgidTeamPage.inactive': 'নিষ্ক্রিয়',
    'appAgency.appAgencyOrgidTeamPage.managingTheTeamIsLimitedTo':
      'টিম পরিচালনা শুধু এই প্রতিষ্ঠানের মালিক ও অ্যাডমিনদের জন্য।',
    'appAgency.appAgencyOrgidTeamPage.mayRequestDocuments': 'ডকুমেন্ট চাইতে পারবেন',
    'appAgency.appAgencyOrgidTeamPage.members': 'সদস্য',
    'appAgency.appAgencyOrgidTeamPage.membershipIsOrganizationalBookkeepingItNever':
      'সদস্যপদ শুধু প্রতিষ্ঠানের নিজস্ব হিসাব রাখার বিষয় - এটি কখনো নিজে থেকে কোনো ভ্রমণকারীর রেকর্ডে অ্যাক্সেস দেয় না। অ্যাক্সেস সবসময় গ্রহণ করা অ্যাক্সেস-অনুমতির মাধ্যমেই পাওয়া যায়।',
    'appAgency.appAgencyOrgidTeamPage.team': 'টিম',
    'appAgency.appAgencyOrgidWorkspaceHeading.agencyOverview': 'এজেন্সির সারসংক্ষেপ',
    'appAgency.appAgencyPage.agenciesCollaborateOnCasesAndRequest':
      'এজেন্সিগুলো ভিসা ফাইলে একসঙ্গে কাজ করে এবং প্রমাণ চায়। শুধু সদস্য হওয়ার কারণে কখনোই কোনো রেকর্ডে অ্যাক্সেস মেলে না - অ্যাক্সেস সবসময় গ্রহণ করা অ্যাক্সেস-অনুমতির মাধ্যমেই পাওয়া যায়।',
    'appAgency.appAgencyPage.applyToRegisterAnAgency': 'এজেন্সি নিবন্ধনের জন্য আবেদন করুন',
    'appAgency.appAgencyPage.applyToRegisterYourAgencyHere':
      'আপনার এজেন্সি নিবন্ধনের জন্য এখানে আবেদন করুন। আপনি এর মালিক হবেন, আর ক্লায়েন্টদের সঙ্গে কাজ শুরুর আগে প্ল্যাটফর্মের একজন অ্যাডমিনিস্ট্রেটরকে এটি যাচাই করতে হবে।',
    'appAgency.appAgencyPage.memberships': 'সদস্যপদ',
    'appAgency.appAgencyPage.noOrganizationsYet': 'এখনো কোনো প্রতিষ্ঠান নেই',
    'appAgency.appAgencyPage.withdrawApplication': 'আবেদন প্রত্যাহার করুন',
    'appAgency.appAgencyPage.withdrawTheApplicationForNameIt':
      '{name}-এর আবেদন কি তুলে নেবেন? এটি আর পর্যালোচনা করা হবে না এবং আপনি যাঁদের যুক্ত করেছিলেন তাঁরা অ্যাক্সেস হারাবেন। আপনি যেকোনো সময় আবার আবেদন করতে পারবেন।',
    'appAgency.appAgencyPage.youBecomeTheOwnerNewOrganizations':
      'আপনি মালিক হবেন। নতুন প্রতিষ্ঠান শুরুতে প্ল্যাটফর্ম অ্যাডমিনের যাচাইয়ের অপেক্ষায় থাকে।',
    'appAgency.appAgencyPage.yourOrganizations': 'আপনার প্রতিষ্ঠান',
  },
});
