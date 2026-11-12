import { defineCatalog } from '@visastack/i18n';

/**
 * Messages for the app-mission surface. Keys were created by scripts/i18n/codemod.mjs; English is
 * the source text and must not change without the screen changing. Bengali comes from
 * docs/localization/VISASTACK_TRANSLATION_REGISTER.csv; a missing key shows English.
 */
export const appMissionCatalog = defineCatalog({
  en: {
    'appMission.appMissionIdAttachPackForm.chooseARequirementPack': 'Choose a requirement pack…',
    'appMission.appMissionIdAttachPackForm.requirementPack': 'Requirement Pack',
    'appMission.appMissionIdAttemptForms.aLetterOrReceiptFromYour':
      'A letter or receipt from your own documents. Without one, this stays your own report.',
    'appMission.appMissionIdAttemptForms.aReceiptOrConfirmationFromYour':
      'A receipt or confirmation from your own documents. Without one, this stays your own report.',
    'appMission.appMissionIdAttemptForms.addDocument': 'Add Document',
    'appMission.appMissionIdAttemptForms.attachADocumentOptional': 'Attach a Document (Optional)',
    'appMission.appMissionIdAttemptForms.choose': 'Choose…',
    'appMission.appMissionIdAttemptForms.chooseADocument': 'Choose a Document…',
    'appMission.appMissionIdAttemptForms.dayItHappened': 'Day It Happened',
    'appMission.appMissionIdAttemptForms.dayItWasSent': 'Day It Was Sent',
    'appMission.appMissionIdAttemptForms.decision': 'Decision',
    'appMission.appMissionIdAttemptForms.documentToAdd': 'Document to Add',
    'appMission.appMissionIdAttemptForms.documentsTheyAskedFor': 'Documents They Asked For',
    'appMission.appMissionIdAttemptForms.howItWasSent': 'How It Was Sent',
    'appMission.appMissionIdAttemptForms.noDocument': 'No Document',
    'appMission.appMissionIdAttemptForms.remove': 'Remove',
    'appMission.appMissionIdAttemptForms.saveForAttemptAttemptno': 'Save for Attempt {attemptNo}',
    'appMission.appMissionIdAttemptForms.trackAsAttemptReportname':
      'Track as Attempt: {reportName}',
    'appMission.appMissionIdAttemptForms.whatHappenedAfterAttemptAttemptno':
      'What Happened After Attempt {attemptNo}',
    'appMission.appMissionIdAttemptForms.whoAsked': 'Who Asked',
    'appMission.appMissionIdAttemptPanel.addWhatHappened': 'Add What Happened',
    'appMission.appMissionIdAttemptPanel.afterSubmission': 'After Submission',
    'appMission.appMissionIdAttemptPanel.applicationAttempts': 'Application Attempts',
    'appMission.appMissionIdAttemptPanel.attemptAttemptno': 'Attempt {attemptNo}',
    'appMission.appMissionIdAttemptPanel.attemptsCanBeRecordedHereSoon':
      'Attempts can be recorded here soon.',
    'appMission.appMissionIdAttemptPanel.decisionOnFormatdateonlyBasislabel':
      'Decision on {formatDateOnly}: {basisLabel}.',
    'appMission.appMissionIdAttemptPanel.eachTimeThisApplicationGoesTo':
      'Each time this application goes to an embassy, consulate or visa centre is its own attempt, with the package that was ready then. What you record stays your own report unless you attach a document. VisaStack does not see or check what an authority does.',
    'appMission.appMissionIdAttemptPanel.forAResubmissionANewApplication':
      'For a resubmission, a new application after a refusal, or the same package sent to a second office.',
    'appMission.appMissionIdAttemptPanel.noDecisionRecorded': 'No Decision Recorded',
    'appMission.appMissionIdAttemptPanel.nothingRecordedYetReportTheSubmission':
      'Nothing recorded yet. Report the submission of this case first; it becomes Attempt 1.',
    'appMission.appMissionIdAttemptPanel.officialOffice': 'Official Office',
    'appMission.appMissionIdAttemptPanel.otherDecision': 'Other Decision',
    'appMission.appMissionIdAttemptPanel.recordAnotherAttempt': 'Record Another Attempt',
    'appMission.appMissionIdCaseChecklist.checkedIsWhenVisastackLastRead':
      'Checked is when VisaStack last read the page. Always confirm the final requirements with the official authority or your agency.',
    'appMission.appMissionIdCaseChecklist.documentsThatExpireBeforeYourTrip':
      'Documents That Expire Before Your Trip Ends',
    'appMission.appMissionIdCaseChecklist.evidenceChecklist': 'Evidence Checklist',
    'appMission.appMissionIdCaseChecklist.fromPackname': 'From {packName}',
    'appMission.appMissionIdCaseChecklist.sourcesForThisChecklist': 'Sources for This Checklist',
    'appMission.appMissionIdCaseItemPane.aNewerCopyIsAvailableCopyname':
      'A newer copy is available: {copyName}. Your choice stays as it is until you change it.',
    'appMission.appMissionIdCaseItemPane.chosenDocumentJoin': 'Chosen document: {join}',
    'appMission.appMissionIdCaseItemPane.forApplieswhen': 'For: {appliesWhen}',
    'appMission.appMissionIdCaseItemPane.howToProvideItJoin': 'How to Provide It: {join}',
    'appMission.appMissionIdCaseItemPane.originalOfficialname': 'Original: {officialName}',
    'appMission.appMissionIdCaseItemPane.provideEvidence': 'Provide Evidence',
    'appMission.appMissionIdCaseItemPane.severalAreOnFileUntilYou':
      'Several are on file. Until you pick one, any eligible one may count toward readiness.',
    'appMission.appMissionIdCaseItemPane.sourceCurrentlyUnreachableUnderReview':
      'Source Currently Unreachable - Under Review',
    'appMission.appMissionIdCaseItemPane.theChosenCopyCanNoLonger':
      'The chosen copy can no longer be used.',
    'appMission.appMissionIdCaseItemPane.unnamed': '(unnamed)',
    'appMission.appMissionIdCaseItemPane.viewSource': 'View Source',
    'appMission.appMissionIdCaseItemPane.whichFileCounts': 'Which File Counts',
    'appMission.appMissionIdCaseItemPane.whichFileGoesInTheHandoff':
      'Which File Goes in the Handoff',
    'appMission.appMissionIdCaseItemPane.yourWording': 'Your Wording',
    'appMission.appMissionIdCaseMobileBar.doneOfTotal': '{done} of {total}',
    'appMission.appMissionIdCaseMobileBar.nextStep': 'Next Step',
    'appMission.appMissionIdCaseMobileBar.requiredItemsOnFile': 'required items on file',
    'appMission.appMissionIdCaseMoreMenu.addEvidence': 'Add Evidence',
    'appMission.appMissionIdCaseMoreMenu.cancelCase': 'Cancel Case',
    'appMission.appMissionIdCaseMoreMenu.cancelThisCase': 'Cancel this case?',
    'appMission.appMissionIdCaseMoreMenu.deleteCase': 'Delete Case',
    'appMission.appMissionIdCaseMoreMenu.deleteThisCase': 'Delete this case?',
    'appMission.appMissionIdCaseMoreMenu.keepTheCase': 'Keep the Case',
    'appMission.appMissionIdCaseMoreMenu.more': 'More',
    'appMission.appMissionIdCaseMoreMenu.nothingIsDeletedNowItsSnapshots':
      'Nothing is deleted now. Its snapshots stay, and your profile and documents are not touched.',
    'appMission.appMissionIdCaseMoreMenu.openCaseHistory': 'Open Case History',
    'appMission.appMissionIdCaseMoreMenu.startANewCaseFromThis': 'Start a New Case from This One',
    'appMission.appMissionIdCaseMoreMenu.theCaseIsRemovedForGood':
      'The case is removed for good, with its checklist, notes, tasks and what was sent for it.',
    'appMission.appMissionIdCaseMoreMenu.theCaseStopsForGoodIt':
      'The case stops for good. It cannot be reopened or moved to another stage.',
    'appMission.appMissionIdCaseMoreMenu.thisCannotBeUndone': 'This cannot be undone.',
    'appMission.appMissionIdCaseMoreMenu.toApplyAgainLaterOpenThe':
      'To apply again later, open the case and choose Start a New Case from This One.',
    'appMission.appMissionIdCaseMoreMenu.yourProfileAndDocumentsAreNot':
      'Your profile and documents are not touched.',
    'appMission.appMissionIdCaseRail.aboutThisCase': 'About this case',
    'appMission.appMissionIdCaseRail.advanceTheCase': 'Advance the Case',
    'appMission.appMissionIdCaseRail.anOptionalLabelLinkingThisCase':
      "An optional label linking this case to another family member's, purely for display. Access and permissions stay entirely separate per case.",
    'appMission.appMissionIdCaseRail.applicationPacket': 'Application Packet',
    'appMission.appMissionIdCaseRail.case': 'Case',
    'appMission.appMissionIdCaseRail.caseDetails': 'Case Details',
    'appMission.appMissionIdCaseRail.editCaseDetails': 'Edit Case Details',
    'appMission.appMissionIdCaseRail.embassyOrVisaCentreNotSet': 'Embassy or visa centre not set',
    'appMission.appMissionIdCaseRail.familyTrip': 'Family Trip',
    'appMission.appMissionIdCaseRail.history': 'History',
    'appMission.appMissionIdCaseRail.inEffectSinceFormatdateonly':
      'In effect since {formatDateOnly}',
    'appMission.appMissionIdCaseRail.itineraryReference': 'Itinerary Reference',
    'appMission.appMissionIdCaseRail.linkToAFamilyTrip': 'Link to a Family Trip',
    'appMission.appMissionIdCaseRail.noChecklistWasLinkedToThis':
      'No checklist was linked to this case.',
    'appMission.appMissionIdCaseRail.noSnapshotsYetCaptureOneTo':
      "No snapshots yet. Capture one to freeze this case's evidence and checksum.",
    'appMission.appMissionIdCaseRail.pickAChecklistAttachAPublished':
      'Pick a checklist: attach a published requirement pack to see how many items are ready.',
    'appMission.appMissionIdCaseRail.requirements': 'Requirements',
    'appMission.appMissionIdCaseRail.reviewed': 'Reviewed',
    'appMission.appMissionIdCaseRail.seeAllSnapshots': 'See All Snapshots',
    'appMission.appMissionIdCaseRail.snapshots': 'Snapshots',
    'appMission.appMissionIdCaseRail.targetDeadlineFormatdateonly':
      'Target deadline: {formatDateOnly}',
    'appMission.appMissionIdCaseRail.thereIsNoFurtherStageFrom':
      'There is no further stage from here. To stop the case, use More at the top of the page.',
    'appMission.appMissionIdCaseRail.thisCaseIsInATerminal': 'This case is in a terminal state.',
    'appMission.appMissionIdCaseRail.tripDateChecks': 'Trip Date Checks',
    'appMission.appMissionIdCaseRail.workflow': 'Workflow',
    'appMission.appMissionIdCaseSecondary.askAContributor': 'Ask a Contributor',
    'appMission.appMissionIdCaseSecondary.askASponsorOrFamilyMember':
      'Ask a sponsor or family member for one named document. They see only the message you type here, nothing else from your record.',
    'appMission.appMissionIdCaseSecondary.collaboration': 'Collaboration',
    'appMission.appMissionIdCaseSecondary.delegate': 'Delegate',
    'appMission.appMissionIdCaseSecondary.moreForThisCase': 'More for This Case',
    'appMission.appMissionIdCaseSecondary.noNotesSharedWithYouYet': 'No notes shared with you yet.',
    'appMission.appMissionIdCaseSecondary.notesAnAgencyWorkingThisCase':
      "Notes an agency working this case has chosen to share with you. An agency's own internal notes are never shown here.",
    'appMission.appMissionIdCaseSecondary.notesFromYourAgency': 'Notes from Your Agency',
    'appMission.appMissionIdCaseSecondary.sectionsOfThisCase': 'Sections of This Case',
    'appMission.appMissionIdCaseSecondary.unknown': 'Unknown',
    'appMission.appMissionIdCaseStatusPanel.aChecklistListsThePapersThis':
      'A checklist lists the papers this visa route asks for and shows which ones you already have on file.',
    'appMission.appMissionIdCaseStatusPanel.noChecklistYet': 'No Checklist Yet',
    'appMission.appMissionIdCaseStatusPanel.whatIsAChecklist': 'What Is a Checklist?',
    'appMission.appMissionIdCaseStatusPanel.whyIsThereNoChecklist': 'Why Is There No Checklist?',
    'appMission.appMissionIdCaseWelcome.aboutThis': 'About This',
    'appMission.appMissionIdCaseWelcome.gotIt': 'Got It',
    'appMission.appMissionIdChangesSinceConfirmed.compare': 'Compare',
    'appMission.appMissionIdChangesSinceConfirmed.compareNameThenAndNow':
      'Compare {name}, then and now',
    'appMission.appMissionIdChangesSinceConfirmed.noDetailDocumentOrCaseDate':
      'No detail, document or case date differs from that snapshot. The change may be a different choice of evidence; open the snapshots to compare.',
    'appMission.appMissionIdChangesSinceConfirmed.seeAllLengthChanges': 'See All {length} Changes',
    'appMission.appMissionIdChangesSinceConfirmed.seeWhatChanged': 'See What Changed',
    'appMission.appMissionIdChangesSinceConfirmed.thisOlderSnapshotDidNotRecord':
      'This older snapshot did not record exact versions, so the changes cannot be listed. Open the snapshots to compare them.',
    'appMission.appMissionIdChecklistSearch.matchesOfRowsItemsMatch':
      '{matches} of {rows} items match.',
    'appMission.appMissionIdChecklistSearch.noItemsMatch': 'No Items Match',
    'appMission.appMissionIdChecklistSearch.searchTheChecklist': 'Search the Checklist',
    'appMission.appMissionIdCollaborationPanels.addATask': 'Add a task…',
    'appMission.appMissionIdCollaborationPanels.addToCalendar': 'Add to Calendar',
    'appMission.appMissionIdCollaborationPanels.addedByAddedby': 'Added by {addedBy}',
    'appMission.appMissionIdCollaborationPanels.appointmentTitle': 'Appointment title',
    'appMission.appMissionIdCollaborationPanels.appointments': 'Appointments',
    'appMission.appMissionIdCollaborationPanels.channel': 'Channel',
    'appMission.appMissionIdCollaborationPanels.channelEGVideoCallOptional':
      'Channel, e.g. video call (optional)',
    'appMission.appMissionIdCollaborationPanels.checklist': 'Checklist',
    'appMission.appMissionIdCollaborationPanels.coverLetters': 'Cover Letters',
    'appMission.appMissionIdCollaborationPanels.date': 'Date',
    'appMission.appMissionIdCollaborationPanels.dueDateOptional': 'Due Date (Optional)',
    'appMission.appMissionIdCollaborationPanels.dueFormatdateonly': 'due {formatDateOnly}',
    'appMission.appMissionIdCollaborationPanels.dueTimeZoneOptional': 'Due Time Zone (Optional)',
    'appMission.appMissionIdCollaborationPanels.eGVisaInterviewPrepCall':
      'e.g. Visa interview prep call',
    'appMission.appMissionIdCollaborationPanels.generatedStrictlyFromConfirmedEligibleEvidence':
      'Generated strictly from confirmed, eligible evidence - nothing is invented. Not AI-written; deterministic and versioned.',
    'appMission.appMissionIdCollaborationPanels.groundedDocuments': 'Grounded Documents',
    'appMission.appMissionIdCollaborationPanels.inProgress': 'In Progress',
    'appMission.appMissionIdCollaborationPanels.lengthPast': '{length} past',
    'appMission.appMissionIdCollaborationPanels.meetings': 'Meetings',
    'appMission.appMissionIdCollaborationPanels.moreThanOneInstanceIsOn':
      'More than one instance is on file for these requirements - pick exactly which one backs each. Until you select, any eligible instance may count.',
    'appMission.appMissionIdCollaborationPanels.noAppointmentsScheduled':
      'No appointments scheduled.',
    'appMission.appMissionIdCollaborationPanels.noLettersGeneratedYet': 'No letters generated yet.',
    'appMission.appMissionIdCollaborationPanels.noOpenTasks': 'No open tasks.',
    'appMission.appMissionIdCollaborationPanels.nothingEligibleToGroundALetter':
      'Nothing eligible to ground a letter in yet.',
    'appMission.appMissionIdCollaborationPanels.place': 'Place',
    'appMission.appMissionIdCollaborationPanels.placeOptional': 'Place (optional)',
    'appMission.appMissionIdCollaborationPanels.pluralDoneOrCancelled':
      '{plural} Done or Cancelled',
    'appMission.appMissionIdCollaborationPanels.precision': 'Precision',
    'appMission.appMissionIdCollaborationPanels.priority': 'Priority',
    'appMission.appMissionIdCollaborationPanels.selectEvidence': 'Select Evidence',
    'appMission.appMissionIdCollaborationPanels.selectName': 'Select {name}',
    'appMission.appMissionIdCollaborationPanels.selectedRemoveName': 'Selected - Remove {name}',
    'appMission.appMissionIdCollaborationPanels.taskDescription': 'Task description',
    'appMission.appMissionIdCollaborationPanels.tasks': 'Tasks',
    'appMission.appMissionIdCollaborationPanels.time': 'Time',
    'appMission.appMissionIdCollaborationPanels.versionVersionFormattimestampdate':
      'Version {version} · {formatTimestampDate}',
    'appMission.appMissionIdComplaintFeedbackPanel.caseComplaint': 'Case Complaint',
    'appMission.appMissionIdComplaintFeedbackPanel.describeTheIssueWithHowThis':
      'Describe the issue with how this case was handled',
    'appMission.appMissionIdComplaintFeedbackPanel.feedbackBecomesAvailableOnceThisCase':
      'Feedback becomes available once this case is closed or cancelled.',
    'appMission.appMissionIdComplaintFeedbackPanel.fileANewComplaint': 'File a New Complaint',
    'appMission.appMissionIdComplaintFeedbackPanel.filedTostatus': 'Filed ({toStatus})',
    'appMission.appMissionIdComplaintFeedbackPanel.onlyYouAndAuthorizedQualityStaff':
      'Only you and authorized quality staff ever see this - never the agency, and never published as a public review or ranking.',
    'appMission.appMissionIdComplaintFeedbackPanel.oversight': 'Oversight',
    'appMission.appMissionIdComplaintFeedbackPanel.privateFeedback': 'Private Feedback',
    'appMission.appMissionIdComplaintFeedbackPanel.resolutionResolution':
      'Resolution: {resolution}',
    'appMission.appMissionIdComplaintFeedbackPanel.reviewedOnlyByAuthorizedQualityStaff':
      'Reviewed only by authorized quality staff - the agency working this case never sees a complaint filed against it.',
    'appMission.appMissionIdComplaintFeedbackPanel.shareFeedbackOnHowThisCase':
      'Share feedback on how this case was handled',
    'appMission.appMissionIdContributorRequestsPanel.contributorEmail': 'Contributor Email',
    'appMission.appMissionIdContributorRequestsPanel.eGSponsorBankStatement':
      'e.g. Sponsor bank statement',
    'appMission.appMissionIdContributorRequestsPanel.eGToSupportTheFinancial':
      'e.g. To support the financial sponsorship section of this case',
    'appMission.appMissionIdContributorRequestsPanel.expiresFormattimestampdate':
      ' · expires {formatTimestampDate}',
    'appMission.appMissionIdContributorRequestsPanel.messageOptional': 'Message (Optional)',
    'appMission.appMissionIdContributorRequestsPanel.sponsorExampleCom': 'sponsor@example.com',
    'appMission.appMissionIdContributorRequestsPanel.visastackRequest': 'VisaStack Request',
    'appMission.appMissionIdContributorRequestsPanel.whatSNeededExactlyOneDocument':
      "What's Needed (Exactly One Document)",
    'appMission.appMissionIdContributorRequestsPanel.whyTheContributorWillSeeThis':
      'Why (the contributor will see this)',
    'appMission.appMissionIdMissionButtons.eGSmithFamilyEurope2026':
      'e.g. Smith Family Europe 2026',
    'appMission.appMissionIdMissionButtons.eGTouristStudentWork': 'e.g. Tourist, Student, Work',
    'appMission.appMissionIdMissionButtons.eGUsEmbassyDhaka': 'e.g. US Embassy Dhaka',
    'appMission.appMissionIdMissionButtons.embassyOrVisaCentre': 'Embassy or Visa Centre',
    'appMission.appMissionIdMissionButtons.noAutomatedRequirementPackCoversThis':
      'No automated requirement pack covers this route (manual mode)',
    'appMission.appMissionIdMissionButtons.serviceCategory': 'Service Category',
    'appMission.appMissionIdMissionButtons.targetDeadline': 'Target Deadline',
    'appMission.appMissionIdMissionButtons.travelDates': 'Travel Dates',
    'appMission.appMissionIdMissionButtons.travelEndDate': 'Travel end date',
    'appMission.appMissionIdMissionButtons.travelStartDate': 'Travel start date',
    'appMission.appMissionIdMissionButtons.whereYouApplyNotTheCountry':
      'Where you apply, not the country you travel to. Some checklists differ by embassy or visa centre.',
    'appMission.appMissionIdOutcomePanel.caseOutcome': 'Case Outcome',
    'appMission.appMissionIdOutcomePanel.decisionDate': 'Decision Date',
    'appMission.appMissionIdOutcomePanel.evidenceOptional': 'Evidence (Optional)',
    'appMission.appMissionIdOutcomePanel.exactWordingFromTheDecisionLetter':
      'Exact wording from the decision letter, unedited',
    'appMission.appMissionIdOutcomePanel.interpretationAgencyinterpretation':
      'Interpretation: {agencyInterpretation}',
    'appMission.appMissionIdOutcomePanel.keptSeparateFromTheWordingAbove':
      'Kept separate from the wording above',
    'appMission.appMissionIdOutcomePanel.noOutcomeRecordedYet': 'No outcome recorded yet.',
    'appMission.appMissionIdOutcomePanel.none': 'None',
    'appMission.appMissionIdOutcomePanel.officialOfficialwording': 'Official: {officialWording}',
    'appMission.appMissionIdOutcomePanel.officialWordingOptional': 'Official Wording (Optional)',
    'appMission.appMissionIdOutcomePanel.theOfficialWordingAndYourOwn':
      "The official wording and your own reading of a decision are kept separate - this is never blended into a single summary, and recording an outcome never changes this case's workflow state on its own.",
    'appMission.appMissionIdOutcomePanel.yourInterpretationOptional':
      'Your Interpretation (Optional)',
    'appMission.appMissionIdPackageForms.goBackToTheSuggestedCopy': 'Go Back to the Suggested Copy',
    'appMission.appMissionIdPackageForms.iHaveReadTheStepsOutside':
      'I have read the steps outside VisaStack and will do them myself.',
    'appMission.appMissionIdPackageForms.leaveMissingForNow': 'Leave Missing for Now',
    'appMission.appMissionIdPackageForms.leaveOutOfThisPackage': 'Leave Out of This Package',
    'appMission.appMissionIdPackageForms.neededOnlyWhenYouLeaveThis':
      'Needed only when you leave this item out. It stays with this case.',
    'appMission.appMissionIdPackageForms.reasonForLeavingOut': 'Reason for Leaving Out',
    'appMission.appMissionIdPackageForms.saveChoiceForItemname': 'Save Choice for {itemName}',
    'appMission.appMissionIdPackageForms.whatToUseForItemname': 'What to Use for {itemName}',
    'appMission.appMissionIdPackagePanel.addAndConfirmYourItemnameIn':
      'Add and confirm your {itemName} in your profile.',
    'appMission.appMissionIdPackagePanel.addYourTravelDatesUnderEdit':
      'Add your travel dates under Edit Case Details.',
    'appMission.appMissionIdPackagePanel.freshnessCheck': 'Freshness Check',
    'appMission.appMissionIdPackagePanel.otherItemsInThisPackage': 'Other Items in This Package',
    'appMission.appMissionIdPackagePanel.outsideVisastack': 'Outside VisaStack',
    'appMission.appMissionIdPackagePanel.preparedForHandoffOnFormattimestampdate':
      'Prepared for Handoff on {formatTimestampDate}.',
    'appMission.appMissionIdPackagePanel.preparedForHandoffOnFormattimestampdateBefore':
      'Prepared for Handoff on {formatTimestampDate}, before a later change. That record is kept as it was.',
    'appMission.appMissionIdPackagePanel.questionsForThisChecklist': 'Questions for This Checklist',
    'appMission.appMissionIdPackagePanel.thisShowsWhatYouHaveReady':
      'This shows what you have ready. It is not a submission and nothing is sent until you share it yourself.',
    'appMission.appMissionIdPackagePanel.toChooseWhichFileAnItem':
      'To choose which file an item uses, open the item in the Evidence Checklist.',
    'appMission.appMissionIdPackagePanel.tripPackage': 'Trip Package',
    'appMission.appMissionIdPackagePanel.visastackDoesNotDoTheseFor':
      'VisaStack does not do these for you. Check the official source for this trip.',
    'appMission.appMissionIdSnapshotsPage.allSnapshots': 'All Snapshots',
    'appMission.appMissionIdSnapshotsPage.backToTheNewestSnapshots': 'Back to the Newest Snapshots',
    'appMission.appMissionIdSnapshotsPage.case': 'Case',
    'appMission.appMissionIdSnapshotsPage.eachSnapshotKeepsExactlyWhatThis':
      'Each snapshot keeps exactly what this case held when it was taken, newest first.',
    'appMission.appMissionIdSnapshotsPage.moreSnapshots': 'More snapshots',
    'appMission.appMissionIdSnapshotsPage.noSnapshotsYetTakeOneFrom':
      'No snapshots yet. Take one from the case page to keep a copy of this case as it is.',
    'appMission.appMissionIdSnapshotsPage.showOlderSnapshots': 'Show Older Snapshots',
    'appMission.appMissionIdSnapshotsPage.theseAreTheOldestSnapshotsOf':
      'These are the oldest snapshots of this case.',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.confirmThisPreparedFile':
      'Confirm This Prepared File',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.finalReview': 'Final Review',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.historicalTheCaseChangedAfterThis':
      'Historical -- the case changed after this decision, on {formatTimestamp}. A new decision is needed.',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.ifTheCaseChangesAfterwardsThis':
      'If the case changes afterwards, this confirmation stops counting and you will be asked to decide again.',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.reasonRequiredToRejectOrRequest':
      'Reason (Required to Reject or Request a Correction)',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.thatYouHaveReadItAcknowledging':
      'That you have read it. Acknowledging is not the same as submitting it.',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.theCaseChangedAfterYouLast':
      'The case changed after you last acknowledged it. Review this version and decide again.',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.thisPageIsTheExactEvidence':
      'This page is the exact evidence bundle, selected facts, and rule context this decision applies to. Acknowledging it does not mean it has been submitted, officially verified, or approved by anyone -- only that you have reviewed this exact content.',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.whatNeedsToChangeOrWhy':
      "What needs to change, or why you're rejecting this?",
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.whatYouAreConfirming':
      'What you are confirming',
    'appMission.appMissionIdSnapshotsSnapshotidPage.applicationPacket': 'Application Packet',
    'appMission.appMissionIdSnapshotsSnapshotidPage.capturedWhileStateChecksumChecksum':
      'Captured while {state} · checksum {checksum}',
    'appMission.appMissionIdSnapshotsSnapshotidPage.documents': 'Documents',
    'appMission.appMissionIdSnapshotsSnapshotidPage.downloadJson': 'Download JSON',
    'appMission.appMissionIdSnapshotsSnapshotidPage.eachPackRequirementResolvedToThe':
      'Each pack requirement resolved to the specific evidence backing it, as of this snapshot.',
    'appMission.appMissionIdSnapshotsSnapshotidPage.facts': 'Facts',
    'appMission.appMissionIdSnapshotsSnapshotidPage.noDocumentsRecorded': 'No documents recorded.',
    'appMission.appMissionIdSnapshotsSnapshotidPage.noEligibleDocument': '(no eligible document)',
    'appMission.appMissionIdSnapshotsSnapshotidPage.noEligibleValue': '(no eligible value)',
    'appMission.appMissionIdSnapshotsSnapshotidPage.noFactsRecorded': 'No facts recorded.',
    'appMission.appMissionIdSnapshotsSnapshotidPage.notSatisfied': 'Not Satisfied',
    'appMission.appMissionIdSnapshotsSnapshotidPage.optional': ' · optional',
    'appMission.appMissionIdSnapshotsSnapshotidPage.requirements': 'Requirements',
    'appMission.appMissionIdSnapshotsSnapshotidPage.satisfied': 'Satisfied',
    'appMission.appMissionIdSnapshotsSnapshotidPage.showAllLengthLabel':
      'Show All {length} {label}',
    'appMission.appMissionIdSnapshotsSnapshotidPage.showFewerLabel': 'Show Fewer {label}',
    'appMission.appMissionIdSnapshotsSnapshotidPage.versionVersion': 'Version {version}',
    'appMission.appMissionIdSnapshotsSnapshotidPage.workingSnapshot': 'Working Snapshot',
    'appMission.appMissionIdSubmissionReportPanel.description': 'Description',
    'appMission.appMissionIdSubmissionReportPanel.eGTrackingOrReceiptNumber':
      'e.g. tracking or receipt number',
    'appMission.appMissionIdSubmissionReportPanel.filing': 'Filing',
    'appMission.appMissionIdSubmissionReportPanel.howWasItSubmitted': 'How was it submitted?',
    'appMission.appMissionIdSubmissionReportPanel.noSubmissionReportedYet':
      'No submission reported yet.',
    'appMission.appMissionIdSubmissionReportPanel.refExternalreference':
      ' · Ref: {externalReference}',
    'appMission.appMissionIdSubmissionReportPanel.referenceNumberOptional':
      'Reference Number (Optional)',
    'appMission.appMissionIdSubmissionReportPanel.submissionReport': 'Submission Report',
    'appMission.appMissionIdSubmissionReportPanel.submittedOnOptionalDefaultsToNow':
      'Submitted on (Optional - Defaults to Now)',
    'appMission.appMissionIdSubmissionReportPanel.thisCaseMustReachSubmissionReady':
      'This case must reach "Submission Ready" (with a live acknowledgement) before a submission can be reported.',
    'appMission.appMissionIdSubmissionReportPanel.whatWasActuallyFiledAndWhere':
      'What was actually filed, and where',
    'appMission.appMissionIdSuggestCorrection.tellUsIfThisItemLooks':
      'Tell us if this item looks wrong. Pack editors check it against the official source; your checklist does not change until a corrected version is published.',
    'appMission.appMissionIdTripChecksPanel.aboutTheseChecks': 'About These Checks',
    'appMission.appMissionIdTripChecksPanel.commonChecksOfYourTripDates':
      "Common checks of your trip dates against your passport and travel insurance. They are not a country's rules, so read the rules for your destination too.",
    'appMission.appMissionIdTripChecksPanel.dates': 'Dates',
    'appMission.appMissionIdTripChecksPanel.noDateChecksApplyYet': 'No date checks apply yet.',
    'appMission.appMissionIdTripChecksPanel.tripDateChecks': 'Trip date checks',
    'appMission.appMissionIdTripChecksPanel.weCouldNotCheckYourDates':
      'We could not check your dates just now. Reload the page to try again.',
    'appMission.appMissionIdWordingEditor.backToOriginalWordingForItemname':
      'Back to Original Wording for {itemName}',
    'appMission.appMissionIdWordingEditor.saveWordingForItemname': 'Save Wording for {itemName}',
    'appMission.appMissionStartPage.aboutStartingATrip': 'About Starting a Trip',
    'appMission.appMissionStartPage.startATrip': 'Start a Trip',
    'appMission.appMissionStartPage.tellUsWhereYouAreGoing':
      'Tell us where you are going, why, and who is travelling. We set up a case for each traveller and show what their visa usually needs.',
    'appMission.appMissionStartPage.travellingTogether': 'Travelling Together?',
    'appMission.appMissionStartStartForm.eachTravellerGetsTheirOwnCase':
      'Each traveller gets their own case. We ask for dates or other details only when the checklist needs them.',
    'appMission.appMissionStartStartForm.forExampleJapan': 'For example: Japan',
    'appMission.appMissionStartStartForm.openTheCaseForName': 'Open the Case for {name}',
    'appMission.appMissionStartStartForm.openTheExistingCaseForName':
      'Open the Existing Case for {name}',
    'appMission.appMissionStartStartForm.startTheTrip': 'Start the Trip',
    'appMission.appMissionStartStartForm.typeANameOrOpenThe': 'Type a name or open the list.',
    'appMission.appMissionStartStartForm.whereAreYouGoing': 'Where Are You Going?',
    'appMission.appMissionStartStartForm.whoSTravelling': "Who's Travelling?",
  },
  bn: {
    'appMission.appMissionIdAttachPackForm.chooseARequirementPack': 'একটি প্রয়োজনীয়তার প্যাক বেছে নিন…',
    'appMission.appMissionIdAttachPackForm.requirementPack': 'প্রয়োজনীয়তার প্যাক',
    'appMission.appMissionIdAttemptForms.attachADocumentOptional': 'ডকুমেন্ট যুক্ত করুন (ঐচ্ছিক)',
    'appMission.appMissionIdAttemptForms.choose': 'বেছে নিন…',
    'appMission.appMissionIdAttemptForms.dayItWasSent': 'যেদিন পাঠানো হয়েছিল',
    'appMission.appMissionIdAttemptForms.decision': 'সিদ্ধান্ত',
    'appMission.appMissionIdAttemptForms.howItWasSent': 'কীভাবে পাঠানো হয়েছিল',
    'appMission.appMissionIdAttemptForms.remove': 'সরান',
    'appMission.appMissionIdAttemptPanel.forAResubmissionANewApplication':
      'পুনরায় জমা দেওয়ার জন্য, প্রত্যাখ্যানের পর নতুন আবেদনের জন্য, অথবা একই প্যাকেজ দ্বিতীয় কোনো অফিসে পাঠানোর জন্য।',
    'appMission.appMissionIdCaseChecklist.documentsThatExpireBeforeYourTrip':
      'ভ্রমণ শেষ হওয়ার আগেই যেসব ডকুমেন্টের মেয়াদ শেষ হবে',
    'appMission.appMissionIdCaseChecklist.evidenceChecklist': 'প্রমাণের চেকলিস্ট',
    'appMission.appMissionIdCaseChecklist.fromPackname': '{packName} থেকে',
    'appMission.appMissionIdCaseItemPane.aNewerCopyIsAvailableCopyname':
      'একটি নতুন কপি পাওয়া যাচ্ছে: {copyName}। আপনি না বদলানো পর্যন্ত আপনার বেছে নেওয়া কপিটিই থাকবে।',
    'appMission.appMissionIdCaseItemPane.originalOfficialname': 'মূল: {officialName}',
    'appMission.appMissionIdCaseItemPane.provideEvidence': 'প্রমাণ দিন',
    'appMission.appMissionIdCaseItemPane.severalAreOnFileUntilYou':
      'একাধিকটি রাখা আছে। আপনি একটি বেছে না নেওয়া পর্যন্ত যেকোনো যোগ্যটি প্রস্তুতির হিসাবে গণ্য হতে পারে।',
    'appMission.appMissionIdCaseItemPane.whichFileCounts': 'কোন ডকুমেন্টটি গণ্য হবে',
    'appMission.appMissionIdCaseItemPane.whichFileGoesInTheHandoff': 'হস্তান্তরে কোন ডকুমেন্টটি যাবে',
    'appMission.appMissionIdCaseItemPane.yourWording': 'আপনার লেখা',
    'appMission.appMissionIdCaseMobileBar.nextStep': 'পরবর্তী ধাপ',
    'appMission.appMissionIdCaseMobileBar.requiredItemsOnFile': 'আবশ্যক আইটেম রাখা আছে',
    'appMission.appMissionIdCaseMoreMenu.addEvidence': 'প্রমাণ যোগ করুন',
    'appMission.appMissionIdCaseMoreMenu.cancelCase': 'ভিসা ফাইল বাতিল করুন',
    'appMission.appMissionIdCaseMoreMenu.deleteCase': 'ভিসা ফাইল মুছে ফেলুন',
    'appMission.appMissionIdCaseMoreMenu.deleteThisCase': 'এই ভিসা ফাইলটি মুছে ফেলবেন?',
    'appMission.appMissionIdCaseMoreMenu.more': 'আরও',
    'appMission.appMissionIdCaseMoreMenu.openCaseHistory': 'ভিসা ফাইলের ইতিহাস খুলুন',
    'appMission.appMissionIdCaseMoreMenu.startANewCaseFromThis': 'এটি থেকে একটি নতুন ভিসা ফাইল শুরু করুন',
    'appMission.appMissionIdCaseMoreMenu.theCaseIsRemovedForGood':
      'চেকলিস্ট, নোট, কাজ এবং এর জন্য যা পাঠানো হয়েছিল, সবসহ ভিসা ফাইলটি স্থায়ীভাবে মুছে ফেলা হয়।',
    'appMission.appMissionIdCaseRail.aboutThisCase': 'এই ভিসা ফাইল সম্পর্কে',
    'appMission.appMissionIdCaseRail.advanceTheCase': 'ভিসা ফাইলটি এগিয়ে নিন',
    'appMission.appMissionIdCaseRail.anOptionalLabelLinkingThisCase':
      'একটি ঐচ্ছিক লেবেল, যা এই ভিসা ফাইলকে পরিবারের অন্য সদস্যের ভিসা ফাইলের সঙ্গে যুক্ত করে - শুধু দেখানোর জন্য। অ্যাক্সেস ও অনুমতি প্রতিটি ভিসা ফাইলে সম্পূর্ণ আলাদাই থাকে।',
    'appMission.appMissionIdCaseRail.caseDetails': 'ভিসা ফাইলের বিবরণ',
    'appMission.appMissionIdCaseRail.editCaseDetails': 'ভিসা ফাইলের বিবরণ সম্পাদনা করুন',
    'appMission.appMissionIdCaseRail.familyTrip': 'পারিবারিক ভ্রমণ',
    'appMission.appMissionIdCaseRail.history': 'ইতিহাস',
    'appMission.appMissionIdCaseRail.itineraryReference': 'ভ্রমণসূচির রেফারেন্স',
    'appMission.appMissionIdCaseRail.linkToAFamilyTrip': 'পারিবারিক ভ্রমণের সঙ্গে যুক্ত করুন',
    'appMission.appMissionIdCaseRail.noSnapshotsYetCaptureOneTo':
      'এখনো কোনো স্ন্যাপশট নেই। এই ভিসা ফাইলের প্রমাণ ও চেকসাম স্থির করে রাখতে একটি স্ন্যাপশট নিন।',
    'appMission.appMissionIdCaseRail.pickAChecklistAttachAPublished':
      'একটি চেকলিস্ট বেছে নিন: কতগুলো আইটেম প্রস্তুত তা দেখতে প্রকাশিত একটি প্রয়োজনীয়তার প্যাক যুক্ত করুন।',
    'appMission.appMissionIdCaseRail.requirements': 'প্রয়োজনীয়তা',
    'appMission.appMissionIdCaseRail.reviewed': 'পর্যালোচনা করা হয়েছে',
    'appMission.appMissionIdCaseRail.snapshots': 'স্ন্যাপশট',
    'appMission.appMissionIdCaseRail.targetDeadlineFormatdateonly':
      'লক্ষ্যমাত্রার শেষ তারিখ: {formatDateOnly}',
    'appMission.appMissionIdCaseRail.tripDateChecks': 'ভ্রমণের তারিখ পরীক্ষা',
    'appMission.appMissionIdCaseRail.workflow': 'ওয়ার্কফ্লো',
    'appMission.appMissionIdCaseSecondary.askAContributor': 'একজন সহযোগীর কাছে চান',
    'appMission.appMissionIdCaseSecondary.askASponsorOrFamilyMember':
      'একজন স্পনসর বা পরিবারের সদস্যের কাছে নির্দিষ্ট একটি ডকুমেন্ট চান। তিনি শুধু আপনার এখানে লেখা বার্তাটিই দেখতে পাবেন, আপনার রেকর্ডের আর কিছু নয়।',
    'appMission.appMissionIdCaseSecondary.collaboration': 'সহযোগিতা',
    'appMission.appMissionIdCaseSecondary.delegate': 'প্রতিনিধি',
    'appMission.appMissionIdCaseSecondary.moreForThisCase': 'এই ভিসা ফাইলের আরও কিছু',
    'appMission.appMissionIdCaseSecondary.noNotesSharedWithYouYet':
      'আপনার সঙ্গে এখনো কোনো নোট শেয়ার করা হয়নি।',
    'appMission.appMissionIdCaseSecondary.notesAnAgencyWorkingThisCase':
      'এই ভিসা ফাইলে কাজ করা এজেন্সি আপনার সঙ্গে যে নোট শেয়ার করতে বেছে নিয়েছে। এজেন্সির নিজস্ব অভ্যন্তরীণ নোট এখানে কখনো দেখানো হয় না।',
    'appMission.appMissionIdCaseSecondary.notesFromYourAgency': 'আপনার এজেন্সির নোট',
    'appMission.appMissionIdCaseSecondary.sectionsOfThisCase': 'এই ভিসা ফাইলের অংশসমূহ',
    'appMission.appMissionIdCaseSecondary.unknown': 'জানা নেই',
    'appMission.appMissionIdCaseStatusPanel.noChecklistYet': 'এখনো কোনো চেকলিস্ট নেই',
    'appMission.appMissionIdCaseStatusPanel.whatIsAChecklist': 'চেকলিস্ট কী?',
    'appMission.appMissionIdCaseWelcome.aboutThis': 'এ সম্পর্কে',
    'appMission.appMissionIdChangesSinceConfirmed.thisOlderSnapshotDidNotRecord':
      'এই পুরোনো স্ন্যাপশটে হুবহু সংস্করণ রেকর্ড করা হয়নি, তাই পরিবর্তনগুলোর তালিকা দেওয়া যাচ্ছে না। তুলনা করতে স্ন্যাপশটগুলো খুলুন।',
    'appMission.appMissionIdCollaborationPanels.addATask': 'কাজ যোগ করুন…',
    'appMission.appMissionIdCollaborationPanels.appointmentTitle': 'অ্যাপয়েন্টমেন্টের শিরোনাম',
    'appMission.appMissionIdCollaborationPanels.appointments': 'অ্যাপয়েন্টমেন্ট',
    'appMission.appMissionIdCollaborationPanels.channel': 'মাধ্যম',
    'appMission.appMissionIdCollaborationPanels.channelEGVideoCallOptional':
      'মাধ্যম, যেমন ভিডিও কল (ঐচ্ছিক)',
    'appMission.appMissionIdCollaborationPanels.checklist': 'চেকলিস্ট',
    'appMission.appMissionIdCollaborationPanels.coverLetters': 'কভার লেটার',
    'appMission.appMissionIdCollaborationPanels.date': 'তারিখ',
    'appMission.appMissionIdCollaborationPanels.dueDateOptional': 'নির্ধারিত তারিখ (ঐচ্ছিক)',
    'appMission.appMissionIdCollaborationPanels.dueFormatdateonly': 'নির্ধারিত তারিখ {formatDateOnly}',
    'appMission.appMissionIdCollaborationPanels.dueTimeZoneOptional':
      'নির্ধারিত সময়ের টাইম জোন (ঐচ্ছিক)',
    'appMission.appMissionIdCollaborationPanels.eGVisaInterviewPrepCall':
      'যেমন: ভিসা ইন্টারভিউয়ের প্রস্তুতির কল',
    'appMission.appMissionIdCollaborationPanels.generatedStrictlyFromConfirmedEligibleEvidence':
      'শুধু নিশ্চিত করা, যোগ্য প্রমাণ থেকে তৈরি - কিছুই বানানো নয়। এটি এআই দিয়ে লেখা নয়; একই তথ্য থেকে সবসময় একই ফল আসে এবং প্রতিটি সংস্করণ আলাদাভাবে রাখা হয়।',
    'appMission.appMissionIdCollaborationPanels.groundedDocuments':
      'যেসব ডকুমেন্টের ওপর ভিত্তি করা হয়েছে',
    'appMission.appMissionIdCollaborationPanels.meetings': 'মিটিং',
    'appMission.appMissionIdCollaborationPanels.moreThanOneInstanceIsOn':
      'এই প্রয়োজনীয়তাগুলোর জন্য একাধিক ডকুমেন্ট আছে - প্রতিটির সমর্থনে ঠিক কোনটি ব্যবহার হবে তা বেছে নিন। আপনি না বাছা পর্যন্ত যেকোনো যোগ্য ডকুমেন্ট গণ্য হতে পারে।',
    'appMission.appMissionIdCollaborationPanels.noAppointmentsScheduled':
      'কোনো অ্যাপয়েন্টমেন্ট ঠিক করা নেই।',
    'appMission.appMissionIdCollaborationPanels.noLettersGeneratedYet': 'এখনো কোনো চিঠি তৈরি হয়নি।',
    'appMission.appMissionIdCollaborationPanels.noOpenTasks': 'বাকি কোনো কাজ নেই।',
    'appMission.appMissionIdCollaborationPanels.nothingEligibleToGroundALetter':
      'চিঠির ভিত্তি হওয়ার মতো যোগ্য কিছু এখনো নেই।',
    'appMission.appMissionIdCollaborationPanels.place': 'স্থান',
    'appMission.appMissionIdCollaborationPanels.placeOptional': 'স্থান (ঐচ্ছিক)',
    'appMission.appMissionIdCollaborationPanels.precision': 'নির্ভুলতা',
    'appMission.appMissionIdCollaborationPanels.priority': 'অগ্রাধিকার',
    'appMission.appMissionIdCollaborationPanels.selectEvidence': 'প্রমাণ নির্বাচন করুন',
    'appMission.appMissionIdCollaborationPanels.taskDescription': 'কাজের বিবরণ',
    'appMission.appMissionIdCollaborationPanels.tasks': 'কাজ',
    'appMission.appMissionIdCollaborationPanels.time': 'সময়',
    'appMission.appMissionIdCollaborationPanels.versionVersionFormattimestampdate':
      'সংস্করণ {version} · {formatTimestampDate}',
    'appMission.appMissionIdComplaintFeedbackPanel.caseComplaint': 'ভিসা ফাইল নিয়ে অভিযোগ',
    'appMission.appMissionIdComplaintFeedbackPanel.describeTheIssueWithHowThis':
      'এই ভিসা ফাইলটি কীভাবে সামলানো হয়েছে, সে বিষয়ে সমস্যাটি বর্ণনা করুন',
    'appMission.appMissionIdComplaintFeedbackPanel.feedbackBecomesAvailableOnceThisCase':
      'এই ভিসা ফাইল বন্ধ বা বাতিল হলে মতামত দেওয়া যাবে।',
    'appMission.appMissionIdComplaintFeedbackPanel.fileANewComplaint': 'নতুন অভিযোগ দায়ের করুন',
    'appMission.appMissionIdComplaintFeedbackPanel.onlyYouAndAuthorizedQualityStaff':
      'শুধু আপনি এবং অনুমতিপ্রাপ্ত মান নিয়ন্ত্রণ কর্মীরা এটি দেখতে পান - এজেন্সি কখনো নয়, এবং এটি কখনো প্রকাশ্য রিভিউ বা র‍্যাংকিং হিসেবে প্রকাশ করা হয় না।',
    'appMission.appMissionIdComplaintFeedbackPanel.oversight': 'তদারকি',
    'appMission.appMissionIdComplaintFeedbackPanel.privateFeedback': 'ব্যক্তিগত মতামত',
    'appMission.appMissionIdComplaintFeedbackPanel.reviewedOnlyByAuthorizedQualityStaff':
      'শুধু অনুমতিপ্রাপ্ত মান নিয়ন্ত্রণ কর্মীরা এটি পর্যালোচনা করেন - এই ভিসা ফাইলে কাজ করা এজেন্সি নিজের বিরুদ্ধে করা কোনো অভিযোগ কখনো দেখতে পায় না।',
    'appMission.appMissionIdContributorRequestsPanel.contributorEmail': 'সহযোগীর ইমেইল',
    'appMission.appMissionIdContributorRequestsPanel.eGSponsorBankStatement':
      'যেমন: স্পনসরের ব্যাংক স্টেটমেন্ট',
    'appMission.appMissionIdContributorRequestsPanel.eGToSupportTheFinancial':
      'যেমন: এই ভিসা ফাইলের আর্থিক স্পনসরশিপ অংশে সহায়তা করতে',
    'appMission.appMissionIdContributorRequestsPanel.messageOptional': 'বার্তা (ঐচ্ছিক)',
    'appMission.appMissionIdContributorRequestsPanel.sponsorExampleCom': 'sponsor@example.com',
    'appMission.appMissionIdContributorRequestsPanel.whatSNeededExactlyOneDocument':
      'যা লাগবে (ঠিক একটি ডকুমেন্ট)',
    'appMission.appMissionIdContributorRequestsPanel.whyTheContributorWillSeeThis':
      'কেন (সহযোগী এটি দেখতে পাবেন)',
    'appMission.appMissionIdMissionButtons.eGSmithFamilyEurope2026': 'যেমন: রহমান পরিবার ইউরোপ ২০২৬',
    'appMission.appMissionIdMissionButtons.eGTouristStudentWork': 'যেমন: পর্যটক, শিক্ষার্থী, কাজ',
    'appMission.appMissionIdMissionButtons.serviceCategory': 'সেবার ক্যাটাগরি',
    'appMission.appMissionIdMissionButtons.targetDeadline': 'লক্ষ্যমাত্রার শেষ তারিখ',
    'appMission.appMissionIdMissionButtons.travelDates': 'ভ্রমণের তারিখ',
    'appMission.appMissionIdMissionButtons.travelEndDate': 'ভ্রমণ শেষের তারিখ',
    'appMission.appMissionIdMissionButtons.travelStartDate': 'ভ্রমণ শুরুর তারিখ',
    'appMission.appMissionIdOutcomePanel.caseOutcome': 'ভিসা ফাইলের ফলাফল',
    'appMission.appMissionIdOutcomePanel.decisionDate': 'সিদ্ধান্তের তারিখ',
    'appMission.appMissionIdOutcomePanel.evidenceOptional': 'প্রমাণ (ঐচ্ছিক)',
    'appMission.appMissionIdOutcomePanel.exactWordingFromTheDecisionLetter':
      'সিদ্ধান্তের চিঠির হুবহু ভাষা, কোনো সম্পাদনা ছাড়া',
    'appMission.appMissionIdOutcomePanel.keptSeparateFromTheWordingAbove':
      'উপরের লেখা থেকে আলাদা রাখা হয়',
    'appMission.appMissionIdOutcomePanel.noOutcomeRecordedYet': 'এখনো কোনো ফলাফল রেকর্ড করা হয়নি।',
    'appMission.appMissionIdOutcomePanel.officialWordingOptional': 'অফিসিয়াল ভাষা (ঐচ্ছিক)',
    'appMission.appMissionIdOutcomePanel.theOfficialWordingAndYourOwn':
      'সিদ্ধান্তের অফিসিয়াল ভাষা এবং সে বিষয়ে আপনার নিজের পাঠ আলাদা রাখা হয় - এ দুটো কখনো একটি সারসংক্ষেপে মেশানো হয় না, আর ফলাফল রেকর্ড করলে এই ভিসা ফাইলের কাজের ধাপ নিজে থেকে বদলায় না।',
    'appMission.appMissionIdOutcomePanel.yourInterpretationOptional': 'আপনার ব্যাখ্যা (ঐচ্ছিক)',
    'appMission.appMissionIdPackageForms.leaveMissingForNow': 'আপাতত অনুপস্থিত রাখুন',
    'appMission.appMissionIdPackageForms.leaveOutOfThisPackage': 'এই প্যাকেজ থেকে বাদ দিন',
    'appMission.appMissionIdPackageForms.neededOnlyWhenYouLeaveThis':
      'আপনি এই আইটেমটি বাদ দিলে তবেই এটি দরকার। এটি এই ভিসা ফাইলের সঙ্গেই থাকে।',
    'appMission.appMissionIdPackageForms.reasonForLeavingOut': 'বাদ দেওয়ার কারণ',
    'appMission.appMissionIdPackagePanel.outsideVisastack': 'VisaStack-এর বাইরে',
    'appMission.appMissionIdPackagePanel.thisShowsWhatYouHaveReady':
      'এখানে দেখানো হয়েছে আপনার কী কী প্রস্তুত আছে। এটি জমা দেওয়া নয় এবং আপনি নিজে শেয়ার না করা পর্যন্ত কিছুই পাঠানো হয় না।',
    'appMission.appMissionIdPackagePanel.toChooseWhichFileAnItem':
      'কোনো আইটেম কোন ডকুমেন্ট ব্যবহার করবে তা বেছে নিতে প্রমাণের চেকলিস্টে আইটেমটি খুলুন।',
    'appMission.appMissionIdPackagePanel.tripPackage': 'ভ্রমণ প্যাকেজ',
    'appMission.appMissionIdSnapshotsPage.allSnapshots': 'সব স্ন্যাপশট',
    'appMission.appMissionIdSnapshotsPage.eachSnapshotKeepsExactlyWhatThis':
      'প্রতিটি স্ন্যাপশটে এই ভিসা ফাইলটি তোলার সময় যা ছিল ঠিক তা-ই থাকে, নতুনটি আগে।',
    'appMission.appMissionIdSnapshotsPage.noSnapshotsYetTakeOneFrom':
      'এখনও কোনো স্ন্যাপশট নেই। এই ভিসা ফাইলটি যেমন আছে তেমন একটি কপি রাখতে ভিসা ফাইলের পাতা থেকে একটি স্ন্যাপশট নিন।',
    'appMission.appMissionIdSnapshotsPage.showOlderSnapshots': 'পুরোনো স্ন্যাপশট দেখান',
    'appMission.appMissionIdSnapshotsSnapshotidAcknowledgementPanel.reasonRequiredToRejectOrRequest':
      'কারণ (প্রত্যাখ্যান বা সংশোধনের অনুরোধ করতে আবশ্যক)',
    'appMission.appMissionIdSnapshotsSnapshotidPage.documents': 'ডকুমেন্টস',
    'appMission.appMissionIdSnapshotsSnapshotidPage.requirements': 'প্রয়োজনীয়তা',
    'appMission.appMissionIdSnapshotsSnapshotidPage.versionVersion': 'সংস্করণ {version}',
    'appMission.appMissionIdSubmissionReportPanel.filing': 'আবেদন দাখিল',
    'appMission.appMissionIdSubmissionReportPanel.howWasItSubmitted': 'এটি কীভাবে জমা দেওয়া হয়েছিল?',
    'appMission.appMissionIdSubmissionReportPanel.noSubmissionReportedYet':
      'জমা দেওয়ার কোনো খবর এখনো জানানো হয়নি।',
    'appMission.appMissionIdSubmissionReportPanel.referenceNumberOptional': 'রেফারেন্স নম্বর (ঐচ্ছিক)',
    'appMission.appMissionIdSubmissionReportPanel.submissionReport': 'জমার প্রতিবেদন',
    'appMission.appMissionIdSubmissionReportPanel.submittedOnOptionalDefaultsToNow':
      'জমার তারিখ (ঐচ্ছিক - না দিলে এখনকার সময়)',
    'appMission.appMissionIdSubmissionReportPanel.thisCaseMustReachSubmissionReady':
      'জমা দেওয়ার খবর জানানোর আগে এই ভিসা ফাইলকে “জমা দেওয়ার জন্য প্রস্তুত” অবস্থায় (একটি সক্রিয় স্বীকৃতিসহ) পৌঁছাতে হবে।',
    'appMission.appMissionIdTripChecksPanel.aboutTheseChecks': 'এই পরীক্ষাগুলো সম্পর্কে',
    'appMission.appMissionIdTripChecksPanel.commonChecksOfYourTripDates':
      'আপনার ভ্রমণের তারিখ পাসপোর্ট ও ট্রাভেল ইনসুরেন্সের সঙ্গে মিলিয়ে দেখার কিছু সাধারণ পরীক্ষা। এগুলো কোনো দেশের নিয়ম নয়, তাই আপনার গন্তব্যের নিয়মগুলোও পড়ে নিন।',
    'appMission.appMissionIdTripChecksPanel.dates': 'তারিখসমূহ',
    'appMission.appMissionIdTripChecksPanel.tripDateChecks': 'ভ্রমণের তারিখ পরীক্ষা',
    'appMission.appMissionStartPage.aboutStartingATrip': 'ভ্রমণ শুরু করা সম্পর্কে',
    'appMission.appMissionStartPage.startATrip': 'ভ্রমণ শুরু করুন',
    'appMission.appMissionStartPage.tellUsWhereYouAreGoing':
      'আপনি কোথায় যাচ্ছেন, কেন যাচ্ছেন এবং কে কে ভ্রমণ করছেন তা আমাদের জানান। আমরা প্রত্যেক ভ্রমণকারীর জন্য একটি ভিসা ফাইল তৈরি করি এবং তাঁদের ভিসার জন্য সাধারণত কী লাগে তা দেখাই।',
    'appMission.appMissionStartPage.travellingTogether': 'একসঙ্গে ভ্রমণ করছেন?',
    'appMission.appMissionStartStartForm.eachTravellerGetsTheirOwnCase':
      'প্রত্যেক ভ্রমণকারীর নিজস্ব ভিসা ফাইল থাকে। চেকলিস্টে দরকার হলেই আমরা তারিখ বা অন্য তথ্য চাই।',
    'appMission.appMissionStartStartForm.forExampleJapan': 'যেমন: জাপান',
    'appMission.appMissionStartStartForm.startTheTrip': 'ভ্রমণ শুরু করুন',
    'appMission.appMissionStartStartForm.typeANameOrOpenThe': 'একটি নাম লিখুন অথবা তালিকা খুলুন।',
    'appMission.appMissionStartStartForm.whereAreYouGoing': 'আপনি কোথায় যাচ্ছেন?',
  },
});
