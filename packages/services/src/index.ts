/**
 * @visastack/services — Applicant Core application services.
 *
 * The write side of the Foundation: identity provisioning, separated consent,
 * applicant/family records, and the manual Master Profile editing path. Every
 * mutation is authorized (policy engine), consent-gated where required, and
 * recorded in the tamper-evident audit chain — atomically, fail-closed.
 *
 * Services accept a transaction-capable `Db` handle (see ADR-0009); they do not
 * construct a client, keeping this package driver-agnostic and testable against
 * in-memory PGlite.
 */

export type { Actor } from '@visastack/policy';
export { STEP_UP_ACTIONS } from '@visastack/policy';
export type { Db, Schema } from './db';
export {
  type AccessActor,
  type AccessPurpose,
  type AccountPrincipal,
  type ActingFor,
  type ApplicantResourceRef,
  type AuthorizedResource,
  type Principal,
  type RequireAccessOptions,
  type SystemJob,
  AuthorizedApplicant,
  CONTRIBUTOR_ACTIONS,
  SelfScope,
  StaffScope,
  SystemScope,
  EACH_GRANT,
  type DocumentProtectionOverride,
  type DocumentProtectionSettings,
  DEFAULT_DOCUMENT_PROTECTION,
  RESTRICTED_DOCUMENT_CATEGORIES,
  RESTRICTED_DOCUMENT_TYPES,
  SYSTEM_JOBS,
  StepUpProof,
  accountPrincipal,
  applyDocumentProtectionOverrides,
  isRestrictedDocumentType,
  requireAccess,
  selfPrincipal,
  selfScopeProblem,
  staffPrincipal,
  systemPrincipal,
  verifyStepUp,
} from './access';
export {
  type CategorySwitchView,
  type DocumentProtectionChange,
  type DocumentProtectionOverview,
  type DocumentProtectionRow,
  type DocumentProtectionScope,
  type ProtectionSwitchView,
  type SetDocumentProtectionInput,
  DOCUMENT_PROTECTION_AUDIT_EVENT,
  DOCUMENT_PROTECTION_REASON_MAX,
  DOCUMENT_PROTECTION_REASON_REQUIRED,
  DOCUMENT_PROTECTION_UNKNOWN_KEY,
  getDocumentProtectionOverview,
  readDocumentProtectionSettings,
  setDocumentProtection,
} from './document-protection';
export {
  type FieldReason,
  type RefusalReason,
  type ServiceError,
  type ServiceErrorCode,
  type StorageLimitReason,
  refusal,
  serviceError,
} from './errors';

export {
  type AuditEventInput,
  type AuditEventRow,
  appendAuditEvent,
  type ApplicantAuditEvent,
  checkRecentAuditChain,
  listAuditEventsForApplicant,
} from './audit';

export { listAllApplicants, listRecentAuditEvents } from './platform-reads';

export { type DataKeyRewrapSummary, rewrapDataKeys } from './data-key-rewrap';

export {
  SCANNER_EVIDENCE_MAX_AGE_MS,
  SCANNER_VERIFIED_EVENT,
  type ScannerEvidence,
  loadScannerEvidence,
  recordScannerEngineVerified,
} from './scanner-evidence';

export {
  STAFF_FACTOR_FRESH_MS,
  type StaffFactorCoverage,
  type StaffFactorEnrolment,
  type StaffFactorStatus,
  type VerifyStaffFactorSuccess,
  confirmStaffFactorEnrolment,
  getStaffFactorStatus,
  isStaffFactorFresh,
  regenerateStaffRecoveryCodes,
  resetStaffSecondFactor,
  revealPendingStaffEnrolment,
  staffFactorCoverage,
  startStaffFactorEnrolment,
  verifyStaffFactor,
} from './staff-second-factor';

export {
  type AuditCheckpoint,
  createAuditCheckpoint,
  eventsInCheckpointRange,
  getLatestAuditCheckpoint,
  listAuditCheckpoints,
  verifyCheckpointAgainstChain,
  verifyCheckpointSignature,
} from './audit-checkpoints';

export {
  type CheckPilotAccessInput,
  type CreateInvitationInput,
  type PilotAccessDecision,
  type PilotInvitation,
  type RevokeInvitationInput,
  attributeInvitation,
  checkPilotAccess,
  claimInvitation,
  createInvitation,
  listInvitations,
  releaseInvitationClaim,
  revokeInvitation,
} from './pilot-access';

export {
  type Account,
  type ProvisionAccountInput,
  type UnboundAccountSummary,
  getAccountByEmail,
  getAccountByWorkosUserId,
  provisionAccount,
  reportUnboundAccounts,
  ACTIVITY_TOUCH_THROTTLE_MS,
  touchAccountActivity,
} from './accounts';
export {
  type ProvisionNeonAccountInput,
  getAccountByNeonUserId,
  provisionNeonAccount,
} from './accounts-neon';

export {
  type ConsentRecord,
  type ConsentState,
  type SetConsentInput,
  getConsents,
  hasConsent,
  listConsentHistory,
  setConsent,
} from './consent';

export {
  type Applicant,
  type ApplicantRelationship,
  type CreateApplicantInput,
  addFamilyMember,
  createApplicant,
  getApplicant,
  listApplicants,
} from './applicants';

export {
  type EditFactInput,
  type EditFactResult,
  type Fact,
  type FactVersion,
  type FieldDefinition,
  type ProfileEntry,
  type RegisterFieldInput,
  editFact,
  getCurrentFactVersion,
  listApplicantProfile,
  listFactHistory,
  registerFieldDefinition,
  registerFieldDefinitions,
  revealFactVersionValue,
} from './profile';
// LC-G1: No Longer Current and Ended on the profile.
export {
  type MarkFactNotCurrentResult,
  type MarkRecordEndedInput,
  type MarkRecordEndedResult,
  isAllowedEndDate,
  listEndedRecords,
  markFactNotCurrent,
  markRecordEnded,
} from './lifecycle/profile/profile-lifecycle';
export {
  CONSISTENCY_LABELS,
  CONSISTENCY_REASON_TEXT,
  CONSISTENCY_RESULTS,
  classifyDeclarationChange,
  compareAuthorizedFactVersions,
  compareFactVersions,
  isFixedFieldKey,
} from './consistency';
export {
  type ApplicationMemory,
  type CaseDetailField,
  type ChangesSinceConfirmed,
  type MemoryCase,
  type MemoryCaseException,
  type MemoryChange,
  type MemoryEvent,
  type MemoryShare,
  type SnapshotChanges,
  type SnapshotDetailComparison,
  type SnapshotReview,
  CASE_DETAIL_FIELDS,
  compareSnapshotDetail,
  getApplicationMemory,
  listChangesSinceConfirmed,
  listChangesSinceSnapshot,
} from './application-memory';
export type {
  AmountBasis,
  Classification,
  ClassifyDeclarationInput,
  CompareFactVersionsInput,
  ComparedVersion,
  ConsistencyReason,
  ConsistencyResult,
  DeclarationComparison,
  DeclarationSide,
} from './consistency';

export {
  type ProfileSectionState,
  type SetExemptionInput,
  type SetSectionOpenInput,
  getProfileSectionState,
  setExemption,
  setSectionOpen,
} from './profile-sections';

export {
  type FieldSensitivity,
  type ProtectedValue,
  type RevealValueInput,
  buildAccountExportAad,
  buildFactVersionAad,
  protectBytes,
  protectValue,
  requiresProtection,
  resetProtectedFieldKeyCacheForTests,
  revealBytes,
  revealValue,
} from './protected-fields';

export {
  type BackfillProtectedFieldsInput,
  type EncryptionBackfillReport,
  type PlaintextProtectedField,
  backfillProtectedFields,
} from './encryption-backfill';

export {
  SUPPORT_ACCESS_PURPOSE,
  SUPPORT_GRANT_MAX_DURATION_MINUTES,
  type CreateSupportGrantInput,
  type RevokeSupportGrantInput,
  type SupportGrant,
  createSupportGrant,
  listActiveSupportGrantsForApplicant,
  listSupportGrantsForApplicant,
  loadSupportGrantsForPolicy,
  revokeSupportGrant,
} from './support-access';

export type {
  AccessDisposition,
  AccessRef,
  AccessVariant,
  BlobStore,
  IssueReadRefInput,
  ListObjectKeysInput,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoragePort,
  StoredBytes,
} from './storage';

export type {
  PreviewRenderResult,
  PreviewRendererPort,
  RenderedPreview,
} from './preview-rendering';

export { type AccountExport, type AccountExportManifest, exportAccount } from './export';
export { type ExportCsvTable, buildExportCsvTables, rowsToCsv } from './export-csv';

export {
  type AccountExportArtifact,
  type AccountExportArtifactManifest,
  type AccountExportExpirySweepResult,
  type AccountExportJob,
  type AccountExportPorts,
  type AccountExportWorkerResult,
  type DocumentBundleExclusion,
  type ZipBundler,
  accountExportArtifactHours,
  enqueueAccountExportJob,
  getAccountExportArtifact,
  listAccountExportJobsForAccount,
  runAccountExportWorker,
  sweepExpiredAccountExportArtifacts,
} from './account-export';

export {
  type AccountLegalHold,
  type LegalHold,
  type LegalHoldReminderSweepResult,
  type LegalHoldScopeDescription,
  type PurgeExpiredDocumentsResult,
  type RetentionPolicy,
  documentBlockedByLegalHold,
  documentsPastRetention,
  getRetentionPolicies,
  hasActiveLegalHold,
  legalHoldReminderIntervalDays,
  listActiveLegalHolds,
  listActiveLegalHoldsForAccount,
  listLegalHolds,
  listLegalHoldsNeedingReview,
  missionBlockedByLegalHold,
  placeLegalHold,
  purgeExpiredDocuments,
  releaseLegalHold,
  setRetentionPolicy,
  sweepLegalHoldReviewReminders,
} from './retention';

export {
  type ErasureJob,
  type ErasureJobReason,
  type ErasureJobSummary,
  type ErasureWorkerResult,
  listErasureJobsNeedingAttention,
  retryErasureJob,
  runErasureWorker,
} from './erasure';

export {
  type DuplicateObjectReference,
  type OrphanReconciliationReport,
  type ReconcileOrphansInput,
  type SizeOrHashMismatch,
  reconcileOrphans,
} from './reconciliation';

export {
  type StepUpAssuranceFields,
  issueStepUpAssurance,
  signStepUpAssurance,
  verifyStepUpAssurance,
} from './step-up';

export {
  PLATFORM_ROLES,
  type GrantPlatformRoleInput,
  type PlatformAction,
  type PlatformAuthInput,
  type PlatformRole,
  type PlatformRoleGrant,
  type RevokePlatformRoleInput,
  canPerformPlatformAction,
  grantPlatformRole,
  hasAnyPlatformRole,
  isPlatformOwner,
  listActivePlatformRoles,
  revokePlatformRole,
} from './platform-roles';

export {
  type Assignment,
  type AssignmentView,
  type AddNoteInput,
  type BulkExportRow,
  type CaseTriageInput,
  type CaseTriageItem,
  type CaseTriageState,
  type CaseTriageSummary,
  type CreateAppointmentForOrgInput,
  type CreateTaskForOrgInput,
  type EvidenceRequest,
  type EvidenceRequestDecision,
  type EvidenceRequestWithApplicant,
  type MissionDecision,
  type MissionNote,
  type MissionNoteVisibility,
  type OrgApplicant,
  type OrgCaseSummary,
  type OrgMission,
  type OrgVisibleAppointment,
  type OrgVisibleTask,
  type OwnerVisibleNote,
  TRIAGE_GROUPS,
  type TriageDocumentState,
  type TriageGroup,
  type TriageIndicator,
  type TriageRequestInput,
  type UpdateTaskForOrgInput,
  addNote,
  assignMember,
  bulkExport,
  cancelEvidenceRequest,
  createAppointmentForOrg,
  createTaskForOrg,
  decideAppointmentForOrg,
  decideEvidenceResponse,
  decideTaskForOrg,
  evidenceRequestTriageGroup,
  isActiveMember,
  listApplicantsForOrganization,
  listAppointmentsForOrg,
  listAssignedMissionIds,
  listAssignments,
  listAssignmentsDetailed,
  listEvidenceRequestDecisions,
  listEvidenceRequestsForApplicant,
  listEvidenceRequestsForOrg,
  listEvidenceRequestsForOrgDetailed,
  listMissionDecisions,
  listMissionRequirementsForOrg,
  listMissionsForOrganization,
  listNotes,
  listNotesForOwner,
  listRespondingDocumentStatesForOrg,
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
  orgGrantPermits,
  recordMissionDecision,
  requestEvidence,
  requirementTriageGroup,
  startEvidenceReview,
  submitEvidenceResponse,
  summarizeCaseTriage,
  unassignMember,
  updateAppointmentForOrg,
  updateTaskForOrg,
} from './agency';

export {
  type PendingRequestCounts,
  PENDING_REQUEST_STATUSES,
  WAITING_ON_AGENCY_REQUEST_STATUSES,
  WAITING_ON_TRAVELLER_REQUEST_STATUSES,
  countPendingRequests,
  isWaitingOnAgency,
  isWaitingOnTraveller,
} from './evidence-request-groups';

export {
  type Membership,
  type OrgMembershipView,
  type Organization,
  type OrgMemberView,
  addMembership,
  createOrganization,
  getOrganization,
  isOrgAdmin,
  listAllOrganizations,
  listMembershipsForAccount,
  listOrgMemberships,
  reviewOrganization,
  setMembershipActive,
  setRequireDifferentReviewer,
  suspendOrganization,
  terminateOrganization,
} from './organizations';

export {
  ALLOWED_LOGO_CONTENT_TYPES,
  MAX_LOGO_BYTES,
  MIN_ACCENT_CONTRAST_RATIO,
  type OrganizationBranding,
  type OrganizationBrandingRow,
  type RemoveOrganizationLogoInput,
  type UpdateOrganizationBrandingInput,
  type UploadOrganizationLogoInput,
  contrastRatio,
  getOrganizationBrandingForDisplay,
  isAccessibleAccentColor,
  organizationLogoPath,
  readOrganizationLogo,
  relativeLuminance,
  removeOrganizationLogo,
  updateOrganizationBranding,
  uploadOrganizationLogo,
} from './branding';

export {
  type PhotoReencoderPort,
  type ProfilePhotoBytes,
  type ProfilePhotoInput,
  type ProfilePhotoPorts,
  type ProfilePhotoSummary,
  PROFILE_PHOTO_CONTENT_TYPE,
  PROFILE_PHOTO_INPUT_TYPES,
  PROFILE_PHOTO_KEY_PREFIX,
  PROFILE_PHOTO_MAX_INPUT_BYTES,
  PROFILE_PHOTO_MAX_INPUT_PIXELS,
  PROFILE_PHOTO_SIZE,
  applicantPhotoPath,
  getApplicantPhotoVersion,
  isIntactPhoto,
  isMissingTableError,
  listApplicantPhotoVersions,
  readApplicantPhoto,
  readUnlessPhotoTableMissing,
  removeApplicantPhoto,
  setApplicantPhoto,
} from './profile-photos';

export {
  type CaseException,
  type CaseSharingAnswers,
  type CaseSharingOutcome,
  type CaseSharingQuestion,
  type CreateGrantInput,
  type Grant,
  type GrantRecipient,
  type GrantWithExceptions,
  type GrantWithRecipient,
  type IncomingGrant,
  type RecipientDocumentView,
  type RecipientFieldView,
  type RecipientWorkspaceView,
  type ScopeExpansionCandidate,
  acceptGrant,
  applyCaseSharingAnswers,
  createGrant,
  documentCategory,
  expandGrantScope,
  getRecipientWorkspace,
  grantReachesCase,
  listAccessForApplicant,
  listAccessForApplicantDetailed,
  listCaseSharingQuestions,
  listGrantsForRecipientAccount,
  loadGrantsForPolicy,
  pauseGrant,
  previewScopeExpansion,
  removeCaseException,
  resumeGrant,
  revokeGrant,
  toPolicyGrant,
} from './sharing';

export {
  type CreateAppointmentInput,
  type DocumentCandidateWithStaleness,
  type DocumentInstance,
  type EvidenceCandidateEntry,
  type FactInstance,
  type GeneratedOutput,
  type Mission,
  type MissionAppointment,
  type MissionOnPackVersion,
  type MissionSnapshot,
  type MissionTask,
  type MissingRequirement,
  type MissionUsingField,
  type OverallReadinessState,
  type PrepareAgainGroup,
  type PrepareAgainInput,
  type PrepareAgainItem,
  type PrepareAgainPlan,
  type PrepareAgainReason,
  type PrepareAgainRecord,
  type Readiness,
  type RequirementMappingEntry,
  type RequirementResultState,
  type RequirementResultSummary,
  type SelectedEvidence,
  type UpdateAppointmentInput,
  type UpdateTaskInput,
  attachPackVersion,
  classifyPrepareAgainRequirement,
  computeReadiness,
  createAppointment,
  createMission,
  createTask,
  decideAppointment,
  decideTask,
  generateCoverLetter,
  getAppointment,
  getEvidenceCandidates,
  getMissionForOwner,
  getMissionSnapshot,
  isFactStatusEligible,
  legalTransitions,
  listAppointments,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissions,
  listMissionsByItineraryRef,
  listMissionsByPackVersion,
  listMissionsUsingField,
  listSelectedEvidence,
  listSelectedEvidenceForOrg,
  listTasks,
  planPrepareAgain,
  prepareCaseAgain,
  selectEvidence,
  setMissionItineraryRef,
  snapshotMission,
  transitionMission,
  unselectEvidence,
  updateAppointment,
  updateMissionCaseDetails,
  updateTask,
} from './missions';

export {
  ACKNOWLEDGEMENT_TEXT_VERSION,
  type Acknowledgement,
  type DecideAcknowledgementInput,
  decideAcknowledgement,
  getLiveAcknowledgement,
  listAcknowledgementsForMission,
} from './acknowledgements';

export {
  type MissionSubmission,
  type RecordSubmissionInput,
  listSubmissionsForMission,
  recordSubmission,
} from './submissions';

export {
  type MissionOutcome,
  type RecordOutcomeInput,
  listOutcomesForMission,
  recordOutcome,
} from './outcomes';

export {
  type CaseComplaint,
  type CaseComplaintEvent,
  type UpdateComplaintStatusInput,
  assignComplaintOwner,
  fileComplaint,
  listComplaintEvents,
  listComplaintsForMission,
  listComplaintsForQualityReview,
  updateComplaintStatus,
  withdrawOwnComplaint,
} from './complaints';

export {
  type CaseFeedback,
  listFeedbackForMission,
  listFeedbackForQualityReview,
  submitFeedback,
} from './feedback';

export {
  type Pack,
  type PackRequirement,
  type PackVersion,
  type PackVersionDiff,
  type PackVersionDueForReview,
  type PublicTrustRoute,
  type PublicTrustRouteSource,
  type PublishedPackVersion,
  type RequirementDiffEntry,
  type RequirementInput,
  addPackVersion,
  addRequirement,
  recordRequirementSourceReview,
  approvePackVersion,
  buildManifest,
  clearOfficialFeeStale,
  clearRequirementSourceInaccessible,
  createPack,
  diffPackVersions,
  getPack,
  getPackVersion,
  getPublicTrustRoute,
  listPackVersions,
  listPackVersionsDueForReview,
  listPacks,
  listPublicTrustPublished,
  listPublishedPackVersions,
  listRequirements,
  markOfficialFeeStale,
  markRequirementSourceInaccessible,
  publishPackVersion,
  publishToPublicTrust,
  setPublicTrustContent,
  unpublishFromPublicTrust,
  verifyPackChecksum,
  withdrawPackVersion,
} from './packs';

export { isHttpUrl, safeHttpUrl } from './external-url';

export { computeTripChecks } from './trip-checks';

export {
  CASE_TRAVEL_END_KEY,
  CASE_TRAVEL_START_KEY,
  type EvaluationContext,
  type RuleCondition,
  type RuleConditionResult,
  type RuleFieldValue,
  type RuleOperand,
  evaluateCondition,
  isValidRuleCondition,
} from './rule-conditions';

export {
  DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS,
  type DocumentExpiryPolicy,
  type ExpiryClassification,
  type ExpiryUrgency,
  type StalenessClassification,
  type StalenessStatus,
  classifyExpiry,
  classifyStaleness,
  getReminderThresholds,
  isValidDocumentDateString,
  listDocumentExpiryPolicies,
  parseDocumentDate,
  setDocumentExpiryPolicy,
} from './expiry';

export {
  type CaseReadinessEntry,
  type CaseReadinessState,
  type CoverageEntry,
  type CoverageKind,
  type EvidenceMapEntry,
  type ExpiryEntry,
  type InsightDocumentRef,
  type InsightSection,
  type MismatchEntry,
  type OriginalsCase,
  type OriginalsItem,
  type TravellerInsights,
  buildTravellerInsights,
} from './insights';
export { type TravellerInsightsOptions, getTravellerInsights } from './insights-read';
export {
  ATTENTION_ACTIVE_CASE_LIMIT,
  ATTENTION_REQUEST_STATUSES,
  ATTENTION_SOURCE_LIMIT,
  ATTENTION_TASK_STATUSES,
  type AttentionActiveCase,
  type AttentionDueState,
  type AttentionItem,
  type AttentionKind,
  type AttentionSubject,
  type AttentionTier,
  type AttentionTierInput,
  CALENDAR_EXPORTED_EVENT,
  CALENDAR_PAST_DAYS,
  CALENDAR_SOURCE_LIMIT,
  type CalendarDates,
  type CalendarExportRecord,
  type CalendarDatesOptions,
  type CalendarItem,
  type CalendarItemWhen,
  DUE_SOON_DAYS,
  type NeedsAttention,
  type NeedsAttentionOptions,
  attentionTier,
  daysUntilDueDay,
  listCalendarDates,
  listNeedsAttention,
  latestTimeZoneName,
  recognisedTimeZone,
  rankAttentionItems,
  recordCalendarExport,
  WITH_AGENCY_REQUEST_STATUSES,
} from './attention';

export {
  type EnqueueNotificationInput,
  type InAppNotificationView,
  type Notification,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationEventType,
  type NotificationNeedingAttention,
  type NotificationPayload,
  type NotificationWorkerResult,
  applyEmailDeliveryEvent,
  buildNotificationIdempotencyKey,
  enqueueNotification,
  enqueueNotificationBothChannels,
  listNotificationsForAccount,
  listNotificationsNeedingAttention,
  markNotificationRead,
  retryNotification,
  runNotificationWorker,
} from './notifications';

export {
  type ExpirySweepResult,
  type SweepResult,
  computeTaskDeadlineThreshold,
  sweepExpiryReminders,
  sweepTaskDeadlineReminders,
} from './notification-sweep';
export {
  NOTIFICATION_EMAIL_COPY,
  type EmailContent,
  notificationEmail,
  renderEmail,
} from './email-design';

export {
  type MrzError,
  type Td3Result,
  checkDigit,
  parseTd3,
} from './mrz';

export {
  PIPELINE_VERSION,
  type ContentLimitsPort,
  type ContentLimitsResult,
  type DocumentScanResult,
  type MalwareScannerPort,
  type ReadableText,
  type ReadableTextSource,
  type ScanResult,
  getLatestExtractedText,
  getLatestReadableText,
  listScanResults,
  nextIntakeState,
  processIntake,
} from './intake';

export {
  type ExtractedDocument,
  type ExtractionErrorCode,
  type ExtractionOutcome,
  type TextExtractionInput,
  type DocumentConverterPort,
  MAX_EXTRACTED_TEXT_CHARS,
  capExtractedText,
} from './extraction';

export {
  CLASSIFIABLE_DOCUMENT_TYPES,
  CONFIDENCE_THRESHOLD,
  type ClassificationResult,
  classifyDocumentText,
} from './classification';

export {
  type NameComponentsInput,
  buildProposedName,
  documentKindLabel,
  extensionOf,
  sanitizeNameComponent,
} from './naming';

export {
  type DecideDocumentNameInput,
  type DocumentNameVersion,
  type NameDecision,
  type ProposeDocumentNameInput,
  decideDocumentName,
  getLatestNameVersion,
  listNameVersions,
  proposeDocumentName,
} from './document-naming';
export {
  type DocumentSuggestionInput,
  type DocumentSuggestionOutcome,
  MAX_DOCUMENT_NAME_LENGTH,
  acceptingRemovesFreshSignIn,
  cleanDocumentName,
  decideDocumentSuggestion,
} from './document-suggestion';

export {
  type AiReadingWorkerResult,
  type FailedJobSummary,
  type IntakeWorkerResult,
  type ProcessingJob,
  enqueueIntakeJob,
  requestDocumentReExtraction,
  listFailedJobs,
  retryFailedJob,
  runAiReadingWorker,
  runIntakeWorker,
} from './jobs';

export {
  type AiReadingPorts,
  type AiReadingResult,
  type ReadingLimits,
  processAiReading,
} from './ai-reading';
export {
  READER_VERSION,
  READING_STOP_REASONS,
  type ReadingStopReason,
  aiReadingIdempotencyKey,
  isAiReadingKey,
  isReadingStopReason,
} from './ai-reading-job';
export {
  DETERMINISTIC_MODEL_PREFIX,
  MRZ_TD3_MODEL_VERSION,
  isDeterministicModelVersion,
} from './ai-run-kinds';
export { type MrzReading, MRZ_FIELD_KEYS, mrzFieldReadings } from './mrz-suggestions';
export {
  READING_SOURCES,
  READING_STAGES,
  type DocumentReadingState,
  type DocumentReadingStates,
  type NotReadReason,
  type ReadingSource,
  type ReadingStage,
  type ReadingStateFacts,
  deriveReadingState,
  listDocumentReadingStates,
} from './document-reading-state';

export {
  type AiCacheKeyComponents,
  type AiClassifyInput,
  type AiClassifyOutcome,
  type AiClassifyPort,
  type AiClassifyResult,
  type AiExplainInput,
  type AiExplainOutcome,
  type AiExplainPort,
  type AiExplainResult,
  type AiExplanationRunRow,
  type AiExtractionErrorCode,
  type AiExtractionInput,
  type AiExtractionOutcome,
  type AiExtractionPort,
  type AiExtractionResult,
  type AiInconsistencyFlag,
  type AiInconsistencyInput,
  type AiInconsistencyOutcome,
  type AiInconsistencyPort,
  type AiInconsistencyResult,
  type AiUsage,
  type ApproveDocumentTypeProposalInput,
  type ApproveProposalInput,
  type DecideInconsistencyFlagInput,
  type DocumentInconsistencyFlagRow,
  type DocumentKindSuggestion,
  type DocumentTypeProposalRow,
  type SuggestDocumentKindInput,
  type EvidenceLocationRow,
  type FieldProposal,
  type FieldProposalRow,
  type OcrRunRow,
  type ProposalWithEvidence,
  type RejectDocumentTypeProposalInput,
  type RejectProposalInput,
  type RunClassificationInput,
  type RunClassificationSummary,
  type RunExplanationInput,
  type RunExplanationSummary,
  type RunExtractionInput,
  type RunExtractionSummary,
  type RunInconsistencyCheckInput,
  type RunInconsistencyCheckSummary,
  type RunOcrInput,
  type RunOcrSummary,
  type ApproveClearProposalsResult,
  CLEAR_PROPOSAL_CONFIDENCE,
  acknowledgeInconsistencyFlag,
  approveClearProposals,
  approveDocumentTypeProposal,
  approveProposal,
  isClearReading,
  isTrustedFactStatus,
  countAiClassificationAttempts,
  countAiExtractionAttempts,
  countAiInconsistencyAttempts,
  countOcrAttempts,
  dismissInconsistencyFlag,
  documentAiCostUnits,
  explainReadinessGap,
  getLatestExplanationForRequirement,
  getLatestOcrRun,
  listPendingDocumentTypeProposals,
  listPendingInconsistencyFlags,
  listPendingProposals,
  rejectDocumentTypeProposal,
  rejectProposal,
  runClassification,
  suggestDocumentKind,
  runExtraction,
  runInconsistencyCheck,
  runOcr,
  totalAiCostUnits,
} from './ai';

export {
  type AiOcrCacheKeyComponents,
  type AiOcrContentType,
  type AiOcrErrorCode,
  type AiOcrInput,
  type AiOcrOutcome,
  type AiOcrPort,
  type AiOcrResult,
  type AiOcrUsage,
  type OcrReviewIssueCode,
  type OcrSourceImageErrorCode,
  type OcrSourceImageOutcome,
  renderOcrSourceImage,
} from './ocr';

export {
  type AiDataMode,
  type AiDataRuleSetting,
  type AiProviderDataTerms,
  type AiProviderDataTermsState,
  type AiProviderTier,
  type AiProviderUseDecision,
  type AiProviderUseInput,
  type AiTermsConcern,
  type AiTrainingAnswer,
  type RecordAiProviderDataTermsInput,
  type SetAiDataRuleSettingInput,
  AI_TERMS_RECHECK_DAYS,
  aiProviderTermsFor,
  aiTermsConcern,
  decideAiProviderUse,
  isAiTermsCheckDue,
  loadAiDataRuleSetting,
  loadAiProviderDataTerms,
  recordAiProviderDataTerms,
  setAiDataRuleSetting,
  unknownAiProviderDataTerms,
  validateAiProviderDataTerms,
} from './ai-data-terms';

export {
  type ActivateAiProviderConfigInput,
  type AiProviderConfig,
  type CreateDraftAiProviderConfigInput,
  type EmergencyDisableAiProviderConfigInput,
  type RecordAiProviderConfigEvaluationInput,
  type RecordAiProviderConfigTestInput,
  type RevokeAiProviderConfigKeyInput,
  type RollbackAiProviderConfigInput,
  type DeleteDraftAiProviderConfigInput,
  type UpdateDraftAiProviderConfigInput,
  activateAiProviderConfig,
  createDraftAiProviderConfig,
  deleteDraftAiProviderConfig,
  emergencyDisableAiProviderConfig,
  getActiveAiProviderConfig,
  getAiProviderConfigById,
  getAiProviderConfigForFallback,
  hasAnyAiProviderConfig,
  isAiDispatchAllowed,
  listAiProviderConfigHistory,
  recordAiProviderConfigEvaluation,
  recordAiProviderConfigTest,
  revealAiProviderApiKey,
  revokeAiProviderConfigKey,
  rollbackAiProviderConfig,
  updateDraftAiProviderConfig,
} from './ai-provider-config';

export { aiModelIdProblem } from './ai-model-id';

export {
  type DeletionImpactSummary,
  type DeletionRequest,
  cancelAccountDeletion,
  executeAccountDeletion,
  getDeletionImpactSummary,
  getPendingDeletion,
  listDueDeletions,
  requestAccountDeletion,
} from './deletion';

export {
  type AddDocumentVersionInput,
  type AddDocumentVersionResult,
  type Document,
  type DocumentAccessInput,
  type DocumentReview,
  type DocumentSummary,
  type DocumentVersion,
  type DownloadDocumentInput,
  type DuplicateDocumentMatch,
  type RecheckDocumentAccessResult,
  type RegisterDocumentInput,
  type RegisterDocumentWithVersionInput,
  type StorageObject,
  addDocumentVersion,
  downloadDocument,
  findDuplicateVersions,
  getCurrentDocumentReview,
  getDocumentTypeOfVersion,
  isServableProcessingState,
  listDocumentReviews,
  listDocuments,
  listDocumentsDetailed,
  prepareDocumentKind,
  previewDocument,
  recheckDocumentAccess,
  recordDocumentReview,
  registerDocument,
  registerDocumentWithVersion,
  setDocumentDate,
  setDocumentType,
} from './documents';

export {
  type DocumentAccessActorKind,
  type DocumentAccessTokenFields,
  appendDocumentAccessToken,
  readDocumentAccessToken,
  signDocumentAccessToken,
  verifyDocumentAccessToken,
} from './document-access-token';

export {
  DEFAULT_UPLOAD_QUOTAS,
  type UploadQuotaConfig,
  getAccountEvidenceBytes,
  getApplicantEvidenceBytes,
  getOrganizationEvidenceBytes,
  getPlatformEvidenceBytes,
  loadUploadQuotaConfig,
  mbLabel,
  storageLimitsForOwner,
  storageLimitsFrom,
} from './quotas';

export {
  TRAVELLER_FREE_PLAN_KEY,
  type ActivateSubscriptionInput,
  type CancelScheduledDowngradeInput,
  type CreatePlanInput,
  type EndSubscriptionInput,
  type OrganizationUsage,
  type Plan,
  type ScheduleDowngradeInput,
  type ScheduledDowngrade,
  type Subscription,
  type UpdatePlanInput,
  type UsageMeter,
  activateSubscription,
  cancelScheduledDowngrade,
  createPlan,
  endSubscription,
  executeScheduledDowngrade,
  getCurrentPlanForOrganization,
  getPendingDowngradeForOrganization,
  getPlanByKey,
  getUsageForOrganization,
  listDueDowngrades,
  listPlans,
  scheduleDowngrade,
  updatePlan,
} from './plans';

export {
  type BillingAccount,
  type BillingStatus,
  type BillingStatusHistoryEntry,
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceLedger,
  type InvoiceStatus,
  type OpenBillingAccountInput,
  type RecordInvoicePaymentInput,
  type TransitionBillingStatusInput,
  type VoidInvoiceInput,
  createInvoice,
  getBillingAccountForOrganization,
  getInvoiceLedger,
  isBillingSuspended,
  legalBillingTransitions,
  listBillingStatusHistory,
  listInvoicesForOrganization,
  openBillingAccount,
  type AgencyBillingNotice,
  RECORD_AMOUNT_PROBLEM,
  getAgencyBillingNotice,
  recordInvoicePayment,
  transitionBillingStatus,
  voidInvoice,
} from './billing';

export {
  type AgencyInvoiceView,
  type InvoicePaymentState,
  deriveInvoicePaymentState,
  listAgencyInvoices,
} from './agency-invoices';

export {
  CLAIM_AMOUNT_PROBLEM,
  CLAIM_NOTE_MAX,
  CLAIM_REASON_MAX,
  CLAIM_REFERENCE_MAX,
  MANUAL_CLAIM_METHODS,
  PROOF_FILE_MAX_BYTES,
  PROOF_FILE_TYPES,
  type ApprovedManualClaim,
  type ManualClaimMethod,
  type ManualClaimStatus,
  type ManualClaimView,
  type ManualPaymentClaim,
  type ProofFilePorts,
  approveManualPaymentClaim,
  listManualClaims,
  manualClaimsPresent,
  readClaimProofFile,
  rejectManualPaymentClaim,
  submitManualPaymentClaim,
} from './manual-claims';

export { type ReceiptDetail, type ReceiptView, getReceipt, listReceipts } from './receipt-views';
export { type PaymentReceipt, formatReceiptNumber } from './receipts';

export {
  type ApplyInvoiceCollectionInput,
  type CollectionKind,
  type CollectionRefusal,
  type CollectionRefusalCode,
  type InvoiceCollectionOutcome,
  type InvoicePayment,
  type InvoicePaymentKind,
  MAX_MINOR_UNITS,
  applyInvoiceCollection,
  invoiceLedgerPresent,
  invoiceStatusForTotals,
  isUuid,
  isValidMinorUnitAmount,
  ledgerTotal,
  outstandingMinorUnits,
} from './invoice-ledger';

export {
  COMMERCIAL_OVERRIDE_MAX_DURATION_DAYS,
  type CommercialOverride,
  type GrantCommercialOverrideInput,
  type RevokeCommercialOverrideInput,
  grantCommercialOverride,
  isCommercialOverrideActive,
  listCommercialOverridesForOrganization,
  revokeCommercialOverride,
} from './commercial-override';

export {
  type AbandonedUploadSweepResult,
  type ReserveUploadInput,
  type UploadIntent,
  failUpload,
  finalizeUpload,
  reserveUpload,
  sweepAbandonedUploads,
} from './uploads';

export {
  type CheckRateLimitInput,
  RATE_LIMITS,
  RATE_LIMIT_BUCKET_RETENTION_MS,
  type RateLimitCheck,
  type RateLimitConfig,
  type RateLimitDecision,
  checkRateLimit,
  checkRateLimits,
  pruneExpiredRateLimitBuckets,
} from './rate-limit';

export { redactErrorMessage, serverErrorEvent } from './error-report';

export {
  type PhotoPreview,
  type PhotoSizerPort,
  type PhotoSizingDeps,
  type ProduceVisaPhotoInput,
  type ProducedVisaPhoto,
  type SizedPhoto,
  type VisaPhotoCheck,
  checkVisaPhoto,
  isPassportPhotoType,
  produceVisaPhotoSize,
} from './photo-sizing';
export { formatObservabilityLine } from './observability-format';

export {
  OPERATIONAL_SIGNAL_KEYS,
  SIGNAL_THRESHOLDS,
  type AiSpendInput,
  type CollectSignalsInput,
  type OperationalSignal,
  type OperationalSignalKey,
  type SignalSource,
  type SignalStatus,
  collectOperationalSignals,
} from './operational-signals';

export {
  PRODUCT_EVENT_CATEGORIES,
  PRODUCT_EVENT_TYPES,
  type AnalyticsCategoryRow,
  type DurationSummary,
  type LabelCount,
  type PilotScorecardRow,
  type ProductAnalytics,
  type ProductAnalyticsResult,
  type ProductEventType,
  type RecordProductEventInput,
  getPilotScorecard,
  getProductAnalytics,
  recordProductEvent,
} from './product-events';

export { recordCountryChecklistStarted } from './country-start';

export {
  currencyDecimals,
  formatAmountForCurrency,
  formatMinorUnits,
  parseAmountForCurrency,
  parseDecimalToMinorUnits,
} from './payment-amounts';
export {
  EXPIRE_AFTER_MS,
  LATE_SUCCESS_WINDOW_MS,
  RECENT_ATTEMPT_MS,
  RECONCILE_MIN_AGE_MS,
  type InvoicePaymentsReader,
  type PaymentAttempt,
  type InvoicePaymentCheck,
  type PaymentAttemptView,
  type PaymentAttemptStatus,
  type PaymentResultState,
  type PaymentResultView,
  type PaymentReturnKind,
  type ReconciliationSummary,
  type SettlePaymentAttemptInput,
  type SettlementCode,
  type SettlementOutcome,
  type SettlementSource,
  type StartOnlinePaymentInput,
  type StartedPayment,
  getPaymentResultView,
  isMerchantTranId,
  isStrandedAttempt,
  getInvoicePaymentAttempts,
  paymentResultState,
  recordRejectedPaymentCallback,
  reconcilePaymentAttempts,
  refreshInvoicePaymentAttempts,
  settlePaymentAttempt,
  startOnlinePayment,
} from './payments';

export type {
  CheckoutSession,
  EmailPort,
  EnqueueJobInput,
  GeneratedDataKey,
  IdentityPort,
  JobQueuePort,
  KeyManagementPort,
  ObservabilityEvent,
  ObservabilityPort,
  PaymentPort,
  PaymentValidation,
  PaymentValidationStatus,
  CreateCheckoutInput,
  ResolvedIdentity,
  RewrappingKeyManagementPort,
  SendEmailInput,
  SendEmailResult,
} from './ports';

export { PaymentProviderUnavailableError, isRewrappingKeyManagementPort } from './ports';

export {
  type DocumentLifecycleStatus,
  type WalletAccessEntry,
  type WalletDocumentView,
  type WalletMissionUsage,
  documentLifecycleStatus,
  getWalletView,
  supersedeDocument,
} from './wallet';

export {
  type AgencyReviewSummary,
  type AssuranceTier,
  type FactAssuranceView,
  type IssuerConfirmationSummary,
  type IssuerVerification,
  type MachineCheckSummary,
  deriveAssuranceTier,
  getFactAssurance,
  listApplicantAssurance,
  listIssuerVerificationsForDocument,
  listIssuerVerificationsForFact,
  recordIssuerVerification,
} from './assurance';

export {
  type AcceptedOrganizationInvitation,
  type AbandonedOrganizationInvitationSweepResult,
  type AcceptOrganizationInvitationInput,
  type AddMemberByEmailOutcome,
  type CreatedOrganizationInvitation,
  type CreateOrganizationInvitationInput,
  type OrganizationInvitation,
  type OrganizationInvitationPreview,
  acceptOrganizationInvitation,
  addMemberByEmail,
  createOrganizationInvitation,
  listOrganizationInvitations,
  previewOrganizationInvitation,
  revokeOrganizationInvitation,
  sweepAbandonedOrganizationInvitations,
} from './invitations';

export {
  type AcceptClientInvitationInput,
  type AcceptedClientInvitation,
  type AbandonedClientInvitationSweepResult,
  type ApplicantChoice,
  type ClientInvitation,
  type ClientInvitationPreview,
  type ClientsJoined,
  type CreateClientInvitationInput,
  type CreatedClientInvitation,
  DEFAULT_CLIENT_GRANT_ACTIONS,
  type PublicClientInvitationView,
  acceptClientInvitation,
  createClientInvitation,
  getClientsJoined,
  getPublicClientInvitationView,
  isAcceptableInvitationContact,
  listClientInvitations,
  previewClientInvitation,
  readPublicClientInvitationLogo,
  revokeClientInvitation,
  sweepAbandonedClientInvitations,
} from './client-invitations';

export {
  type CaseRetentionNoticeSweepResult,
  type CaseRetentionPurgeSweepResult,
  sweepCaseRetentionNotices,
  sweepCaseRetentionPurge,
} from './case-retention';

export {
  type InactiveAccountDeletionSweepResult,
  type InactiveAccountNoticeSweepResult,
  sweepInactiveAccountDeletionRequests,
  sweepInactiveAccountNotices,
} from './account-retention';

export {
  type ReconciliationCounts,
  type ReconciliationError,
  type ReconciliationReport,
  reconcileRestoredBranch,
} from './backup-reconciliation';

export {
  type BeginContributorSubmissionInput,
  type ContributorRequest,
  type ContributorRequestPreview,
  type CreateContributorRequestInput,
  type CreatedContributorRequest,
  abandonContributorSubmission,
  beginContributorSubmission,
  completeContributorSubmission,
  createContributorRequest,
  listContributorRequests,
  previewContributorRequest,
  revokeContributorRequest,
} from './contributor-requests';
export {
  SIGNUP_FORM_LIFETIME_MS,
  SIGNUP_PRIVACY_VERSION,
  SIGNUP_TERMS_VERSION,
  acknowledgeSignupNotices,
  type SignupNoticeInput,
} from './signup-notices';
export { listPlatformMembers, type PlatformMember } from './platform-directory';
export {
  searchWorkspaceRecords,
  type WorkspaceSearchScope,
  type WorkspaceSearchResult,
} from './workspace-search';
export { loadWorkspaceToolbarState, type WorkspaceToolbarState } from './workspace-toolbar';
export {
  getTravellerPlanSummary,
  listTravellerPlansForSale,
  type TravellerPlanCatalogue,
  type TravellerPlanOffer,
  type TravellerPlanSummary,
  travellerPlansEnabled,
} from './traveller-plan';
// ADR 0025 section 12.2: a paid plan offered at the moment of need, only when it would help.
export {
  type UpgradeContext,
  type UpgradeShortfall,
  upgradeHelps,
  upgradeWouldHelp,
} from './upgrade-offer';
// ADR 0025 T3: a traveller buys and pays for their own paid plan (SelfScope from withSession).
export {
  ALREADY_COVERED,
  PERSON_SELLING_OFF,
  PURCHASE_EXPIRED,
  PURCHASE_REFUNDED,
  type PersonCheckout,
  type OwnRenewal,
  type PersonPurchase,
  RENEWAL_GRACE_DAYS,
  getOwnPurchase,
  getOwnRenewal,
  setPlanRenewal,
  startPersonCheckout,
} from './person-billing';
// ADR 0025 T4: the daily run's person step (renewals, reminders, lapses).
export type { PersonRenewalSummary } from './person-renewals';

export { type PlatformOverview, getPlatformOverview } from './platform-overview';

export {
  createSharingInvitation,
  previewSharingInvitation,
  acceptSharingInvitation,
  listSharingInvitations,
  listInvitationCaseExceptions,
  revokeSharingInvitation,
  type InvitationCaseException,
  type SharingInvitation,
} from './sharing-invitations';
export {
  assignReferenceCode,
  assignReferenceCodes,
  referenceCodeFor,
  referenceCodesFor,
  referenceCodesTablePresent,
} from './reference-codes';
export {
  AI_CONTEXT_GUIDANCE,
  DOCUMENT_TEXT_LIMIT,
  IDENTITY_BASICS_KEYS,
  MAX_CASES_PER_OUTPUT,
  OMISSION_REASONS,
  SELECTION_DEPTHS,
  VALUE_STATUSES,
  buildSelectedOutput,
  layerLabel,
  listSelectableCases,
  maskIdentifier,
  normaliseSelection,
  aiContextObject,
  renderAiContext,
  type AiContextOptions,
  type CaseSelection,
  type DocumentListStatus,
  type OmissionReason,
  type OmittedCounts,
  type OutputAction,
  type OutputCase,
  type OutputDocument,
  type OutputDocumentText,
  type OutputExpiry,
  type OutputPerson,
  type OutputRequirement,
  type OutputValue,
  type RequirementState,
  type SelectableCase,
  type SelectedOutput,
  type SelectedOutputOptions,
  type Selection,
  type SelectionDepth,
  type ValueEvidence,
  type ValueMethod,
  type ValueRelevance,
  type ValueStatus,
} from './selected-output';
export {
  OUTPUT_PREPARED_EVENT,
  OUTPUT_TEMPLATES,
  OUTPUT_TEMPLATE_IDS,
  TRIP_DOCUMENT_SLOTS,
  TRIP_FIELD_KEYS,
  buildWhatsAppShare,
  cleanText,
  defaultChoice,
  engineRequest,
  isOutputTemplateId,
  longDay,
  neutraliseFormula,
  outputFileName,
  outputFingerprint,
  recordOutputPrepared,
  renderOutputFile,
  renderOutputText,
  renderOutputView,
  renderSheetCsv,
  statusWords,
  type OutputChoice,
  type OutputFormat,
  type OutputPreparedRecord,
  type OutputTemplate,
  type OutputTemplateId,
  type OutputView,
  type ViewRow,
  type ViewSection,
  type WhatsAppShare,
} from './selected-output-views';
export {
  REQUEST_QUESTION_LIMIT,
  REQUEST_QUESTION_MAX_LENGTH,
  type RequestItemExtras,
  type RequestItemRule,
  type RequestQuestion,
  askAboutRequestItem,
  listRequestItemExtras,
  requestQuestionPrefix,
  requestQuestionText,
} from './request-items';

// Lane D: WhatsApp channel (codec, outgoing port).
export {
  MAX_TEXT_LENGTH as WHATSAPP_MAX_TEXT_LENGTH,
  MAX_WEBHOOK_BYTES as WHATSAPP_MAX_WEBHOOK_BYTES,
  parseWhatsAppWebhook,
  verifySubscription as verifyWhatsAppSubscription,
  verifyWebhookSignature as verifyWhatsAppSignature,
  type DeliveryState as WhatsAppDeliveryState,
  type IdentityChange as WhatsAppIdentityChange,
  type InboundMessage as WhatsAppInboundMessage,
  type ParsedWebhook as WhatsAppParsedWebhook,
  type StatusUpdate as WhatsAppStatusUpdate,
  type WhatsAppSender,
} from './channels/whatsapp-webhook';
export {
  LIMITS as WHATSAPP_LIMITS,
  WHATSAPP_ERROR,
  WhatsAppSendError,
  checkOutgoing,
  type ListRow as WhatsAppListRow,
  type ReplyButton as WhatsAppReplyButton,
  type WhatsAppOutgoing,
  type WhatsAppPort,
  type WhatsAppRecipient,
  type WhatsAppSendResult,
} from './channels/whatsapp-port';
export {
  LINK_CODE_TTL_MS as WHATSAPP_LINK_CODE_TTL_MS,
  WHATSAPP_OPT_IN_VERSION,
  WHATSAPP_SETTINGS_PATH,
  disconnectWhatsApp,
  getWhatsAppConnection,
  startWhatsAppLink,
  type StartLinkResult as WhatsAppLinkStart,
  type WhatsAppConnection,
} from './channels/whatsapp-link';
export {
  ingestWhatsAppWebhook,
  processWhatsAppInbox,
  type IngestResult as WhatsAppIngestResult,
  type ProcessInboxResult as WhatsAppInboxResult,
  type WhatsAppChannelSettings,
} from './channels/whatsapp-inbox';
export {
  DEADLINE_CLOCK_DEFAULT_LIMIT,
  DEADLINE_CLOCK_MAX_LIMIT,
  DEADLINE_CLOCK_PAST_DAYS,
  DEADLINE_CLOCK_SOURCE_LIMIT,
  DEADLINE_MONTH_DAYS,
  type DeadlineClock,
  type DeadlineClockOptions,
  type DeadlineDoubt,
  type DeadlineEntry,
  type DeadlineKind,
  type DeadlineUrgency,
  deadlineUrgency,
  documentExpiryDoubt,
  listDeadlineClock,
  rankDeadlines,
} from './deadline-clock';
export {
  type ConnectSignInInput,
  SIGN_IN_RECOVERY_REASON_MAX,
  SIGN_IN_RECOVERY_REFUSED,
  SIGN_IN_RECOVERY_WINDOW_DAYS,
  SIGN_IN_RECOVERY_WINDOW_MS,
  type SignInRecoveryRequest,
  connectSignInToAccount,
  listSignInRecoveryRequests,
} from './sign-in-recovery';
export {
  EMAIL_DELIVERY_DAY_MS,
  EMAIL_DELIVERY_LIST_LIMIT,
  EMAIL_DELIVERY_WAITING_AFTER_MS,
  EMAIL_RESEND_REFUSED,
  type EmailDeliveryCounts,
  type EmailDeliveryProblems,
  type EmailDeliveryRow,
  type ResendEmailInput,
  listEmailDeliveryProblems,
  resendEmail,
} from './email-delivery-admin';
export {
  AI_ACCESS_TTL_MS,
  AI_CODE_TTL_MS,
  AI_REFRESH_TTL_MS,
  type AiClientIdentity,
  type AiOAuthError,
  type AiOAuthErrorCode,
  type AiTokenSet,
  type CreateAiConnectionInput,
  type ResolvedAiConnection,
  createAiConnection,
  deleteExpiredAiTokens,
  exchangeAiAuthorizationCode,
  refreshAiTokens,
  resolveAiAccessToken,
  revokeAiToken,
} from './access/ai-connection';
export {
  AI_CONNECTION_DEFAULT_DURATION,
  AI_CONNECTION_DEFAULT_LAYERS,
  AI_CONNECTION_DURATIONS,
  AI_CONNECTION_LAYERS,
  AI_CONNECTION_WARNING_LAYERS,
  AI_DOCUMENT_TEXT_GROUPS,
  AI_OAUTH_SCOPES_SUPPORTED,
  type AiCaseMode,
  type AiConnectionChoices,
  type AiConnectionDuration,
  type AiConnectionLayer,
  type StoredAiChoices,
  aiConnectionExpiry,
  oauthScopeNames,
  scopesFromChoices,
  selectionFromStoredChoices,
} from './ai-connection-scopes';
export {
  type AiAppKey,
  type AiClientRefusal,
  type AiClientRegistration,
  type AiClientRegistrationError,
  CLIENT_METADATA_CACHE_MS,
  type ClientMetadataDeps,
  LOOPBACK_CLIENT_HOST,
  REGISTERED_CLIENT_PREFIX,
  REGISTERED_CLIENT_UNUSED_MS,
  type RegisterAiClientInput,
  type ResolvedAiClient,
  SUPPORTED_AI_APPS,
  type SupportedAiApp,
  clearClientMetadataCache,
  deleteStaleAiClients,
  fetchClientMetadataDocument,
  isLoopbackRedirect,
  redirectMatches,
  registerAiClient,
  resolveAiClient,
  touchAiClient,
} from './ai-clients';
export { isMissingRelationError } from './missing-relation';
export {
  type PackMatch,
  type PackMatchTerms,
  type TravellerCountries,
  type TravellerCoverage,
  type TravellerMatchTerms,
  findMatchingPublicPack,
  listFittingPublicPacks,
  packMatchKey,
  readTravellerCoverage,
} from './pack-matching';

// UX-B document upload: automatic titles, renaming, and the record of a converted iPhone photo.
export {
  AUTOMATIC_TITLE_REASON,
  type DocumentTitleInput,
  buildDocumentTitle,
  firstNameOf,
  titleDate,
} from './naming';
export { OWNER_RENAME_REASON, renameDocument } from './document-naming';
export { CONVERTED_FROM_HEIC_SOURCE, type RegisteredDocumentWithVersion } from './documents';
export { type GrowUploadReservationInput, growUploadReservation } from './uploads';
export {
  type CalendarFeedHolder,
  isCalendarFeedSecretShape,
  requireCalendarFeedAccess,
  resolveCalendarFeedSecret,
} from './access';
export {
  CALENDAR_FEED_LINK_REPLACED_EVENT,
  CALENDAR_FEED_SHARING_NEEDED,
  CALENDAR_FEED_TURNED_OFF_EVENT,
  CALENDAR_FEED_TURNED_ON_EVENT,
  CALENDAR_FEED_UNAVAILABLE,
  type CalendarFeedLink,
  type CalendarFeedStatus,
  getCalendarFeedStatus,
  replaceCalendarFeedLink,
  turnOffCalendarFeed,
  turnOnCalendarFeed,
} from './calendar-feeds';
export { isRateLimitReached } from './rate-limit';
// S14: the AI connector's gate and its five read-only tools (ADR 0021 sections 3, 6 and 7).
export {
  AI_CONNECTION_PURPOSE,
  type AiAdmission,
  type AiCaller,
  type AiCallRecord,
  type AiContextGateway,
  type AiGrantedScope,
  auditAiAnswerWithheld,
  authenticateAiRequest,
  isWellFormedAiAccessToken,
  withAiConnection,
} from './access/with-ai-connection';
export {
  AI_RESPONSE_LIMIT_BYTES,
  AI_TOOL_MESSAGES,
  AI_TOOLS,
  aiToolRefusal,
  type AiToolDefinition,
  type AiToolName,
  type AiToolOutcome,
  type AiToolResult,
  runAiTool,
} from './ai-tools';
// S15: the owner's AI Connections controls on the Sharing page (ADR 0021 sections 3 and 5).
export {
  AI_RECENTLY_ENDED_MS,
  type AiConnectionList,
  type AiConnectionManageError,
  type AiConnectionSummary,
  type ChangeAiConnectionInput,
  changeAiConnection,
  getAiConnection,
  listAiConnections,
  turnOffAiConnection,
} from './access/ai-connection-manage';
// S16: the staff count of AI app connections and context calls (ADR 0021 section 7).
export {
  AI_CONNECTION_COUNT_WINDOW_MS,
  type AiConnectionCounts,
  getAiConnectionCounts,
} from './ai-connection-counts';
// S27: the database half of the commercial readiness AI provider gate (M19).
export {
  type AiProviderReadinessState,
  loadAiProviderReadiness,
} from './ai-provider-readiness';
// S27: server-side re-encoding for logos and photo proofs of payment, so only image data is kept.
export {
  IMAGE_TOO_LARGE_CODE,
  type ImageSanitizerPort,
  SANITIZED_IMAGE_TYPES,
  type SanitizedImage,
  type SanitizedImageType,
  isAcceptableSanitizedImage,
  isImageTooLargeError,
} from './image-sanitizer';
export {
  LOGO_MAX_DIMENSION,
  LOGO_MAX_INPUT_PIXELS,
  LOGO_MAX_OUTPUT_BYTES,
  type LogoUploadChecks,
} from './branding';
// S23: safe copies (ADR 0022): the owner's boxes, the editor's reads, preparing and the copy.
export type {
  PositionedText,
  SafeCopyBox,
  SafeCopyBudget,
  SafeCopyFailure,
  SafeCopyFailureReason,
  SafeCopyPageImage,
  SafeCopyRendererPort,
  SafeCopySource,
} from './preview-rendering';
export {
  MAX_SUGGESTIONS_PER_PAGE,
  type PreparedSafeCopyPage,
  type ProducedSafeCopy,
  type RedactionDeps,
  type RedactionEditorView,
  type RedactionSuggestion,
  type RedactionSuggestionReason,
  type RenderedRedactionPage,
  SAFE_COPY_MAX_OUTPUT_BYTES,
  SAFE_COPY_TOO_LARGE_MESSAGE,
  type SafeCopyError,
  type SafeCopyRefusal,
  type SafeCopyState,
  type SaveRedactionMasksInput,
  type SaveRedactionPageInput,
  type SavedRedaction,
  clearRedactionMasks,
  getSafeCopyState,
  isSafeCopyReady,
  isValidIban,
  listRedactionStates,
  listSafeCopyStatesForDocuments,
  looksLikeAccountNumber,
  openRedactionEditor,
  prepareSafeCopyPage,
  produceSafeCopy,
  renderRedactionPage,
  saveRedactionMasks,
  suggestRedactions,
} from './redaction';

// S17: recurring period invoices, reminders, overdue handling and the billing rules.
export { dayCount } from '@visastack/core';
export {
  BILLING_TIME_ZONE,
  type BillingCycleSummary,
  type OverduePolicy,
  type OverduePreview,
  previewOverdueHandling,
  runBillingCycle,
} from './billing-cycle';
export {
  BILLING_DUE_DAYS_MAX,
  BILLING_DUE_DAYS_MIN,
  BILLING_POLICY_DAYS_MAX,
  BILLING_SETTINGS_UNAVAILABLE,
  type BillingSettings,
  billingRulesProblem,
  getBillingSettings,
  updateBillingSettings,
} from './billing-settings';

// S21: AI app suggestion tools ("Suggest Changes", ADR 0021 extension).
export {
  AI_READ_TOOL_NAMES,
  AI_SUGGESTION_TOOL_NAMES,
  AI_SUGGEST_CHANGES_SCOPE,
  type AiSuggestionToolName,
  allowsSuggestions,
} from './ai-connection-scopes';
export {
  type AiAddReminderInput,
  type AiSaveDraftInput,
  type AiSuggestProfileInput,
  type AiSuggestionWrites,
  type AiWriteFailure,
  type AiWriteGateway,
  withAiSuggestionConnection,
} from './access/with-ai-connection';
export {
  type AnyAiToolDefinition,
  type AiSuggestionToolDefinition,
  SUGGESTION_ANNOTATIONS,
} from './ai-tools';
export {
  AI_DRAFT_LIST_LIMIT,
  AI_SUGGESTION_LIMITS,
  type AiDraftList,
  type AiDraftView,
  aiSuggestionsAvailable,
  deleteAiDraft,
  listAiDrafts,
  aiSuggestionsInUse,
  listPendingAppSuggestions,
} from './ai-suggestions';
export { type TaskAddedBy, taskAddedByApps } from './ai-task-origins';
export {
  CONNECTOR_MODEL_PREFIX,
  isConnectorModelVersion,
} from './ai-run-kinds';
export type { MissionTaskView } from './missions';
export type { ProposalApp } from './ai';
export {
  AI_FEATURE_SETTINGS_UNAVAILABLE,
  type AiFeatureContext,
  type AiFeatureSettingView,
  type AiFeatureSettingsList,
  type AiFeatureState,
  type AiPlanEntitlement,
  type UpdateAiFeatureSettingInput,
  aiEntitlementFor,
  getAiFeatureState,
  listAiFeatureSettings,
  updateAiFeatureSetting,
} from './ai-feature-settings';
// S18: refunds, credits and the monthly accounting export.
export {
  type ApplyInvoiceRefundInput,
  REFUNDED_INVOICE_MESSAGE,
} from './invoice-ledger';
export { REFUNDED_INVOICE_STAFF_MESSAGE } from './billing';
export {
  type ApplyHeldCreditInput,
  type CreditTargetView,
  type HeldCreditOutcome,
  type HeldPaymentView,
  NO_OPEN_INVOICE_FOR_CREDIT,
  type OrganizationRefundWork,
  REFUND_PROVIDER_OFF,
  REFUNDS_UNAVAILABLE,
  type RecordManualRefundInput,
  type RefundCheckSummary,
  type RefundMethod,
  type RefundOutcome,
  type RefundOutcomeCode,
  type RefundRequestView,
  type RefundSource,
  type RefundStatus,
  type RefundableEntryView,
  type RequestRefundInput,
  NEEDS_CHECK_CODE,
  REFUND_WORK_LIMIT,
  RETRY_REFUSED_CODE,
  DUPLICATE_REFERENCE_CODE,
  REFERENCE_TAKEN,
  AMOUNT_MISMATCH,
  RETRY_REFUSED_MESSAGE,
  type RefundWorkInput,
  applyHeldPaymentCredit,
  cancelRefund,
  checkRefundsNow,
  confirmUnsentRefund,
  getOrganizationRefundWork,
  reconcileRefunds,
  recordManualRefund,
  requestRefund,
  retryRefund,
  // ADR 0025 T6: a traveller's refund, recorded by the platform owner.
  PERSON_REFUNDS_UNAVAILABLE,
  type PersonRefundOutcome,
  type PersonRefundSource,
  type RecordPersonRefundInput,
  recordPersonRefund,
} from './refunds';
// ADR 0025 T6: the platform owner's Traveller Billing view.
export {
  TRAVELLER_NEEDS_CHECK_LIMIT,
  type TravellerBilling,
  type TravellerBillingResult,
  type TravellerHeldView,
  type TravellerInvoiceView,
  type TravellerNeedsCheckItem,
  type TravellerPaymentView,
  type TravellerRefundView,
  getTravellerBilling,
  listTravellerNeedsCheck,
  travellerLookup,
} from './person-billing-admin';
export {
  LEDGER_CSV_COLUMNS,
  LEDGER_EXPORT_MAX_ROWS,
  type LedgerExport,
  exportLedgerMonth,
  ledgerMonthBounds,
} from './ledger-export';
export {
  type RefundProviderStatus,
  type RefundStatusReport,
  type RefundSubmission,
  type RefundSubmissionResult,
  type RefundingPaymentPort,
  isRefundingPaymentPort,
} from './ports';
export {
  type BillingDocument,
  type BillingDocumentFact,
  type BillingDocumentKind,
  type BillingDocumentReader,
  type BillingDocumentStamp,
  type BillingDocumentTable,
  type BillingDocumentTone,
  type BillingDocumentTotal,
  type InvoiceDocumentFacts,
  type InvoiceDocumentPayment,
  type ReceiptDocumentFacts,
  billingDocumentFileName,
  buildInvoiceDocument,
  buildReceiptDocument,
  getInvoiceDocument,
  getReceiptDocument,
  invoiceDocumentStamp,
} from './billing-documents';
// S20: AI connector original files ("Original Files", ADR 0021 amendment).
export {
  AI_FILE_CHOICES_MAX,
  AI_FILE_DEFAULT_VARIANT,
  AI_FILE_TOOL_NAMES,
  AI_FILE_VARIANTS,
  type AiFileChoice,
  type AiFileVariant,
  isAiFileVariant,
} from './ai-connection-scopes';
export {
  type AiFileCandidate,
  type AiFileCandidates,
  aiFilesAvailable,
  listAiConnectionFiles,
  listAiFileCandidates,
} from './ai-connection-files';
export {
  AI_FILE_RESPONSE_LIMIT_BYTES,
  type AiFileDeps,
  type AiFileFailure,
  type AiFileGateway,
  type AiServedFile,
} from './access/with-ai-connection';
// S29: plans admin, one entitlement resolver and test payments (ADR 0020 S29 amendment).
export {
  type EntitlementGate,
  type EntitlementSubject,
  type PlanPrice,
  type ResolvedEntitlements,
  type ResolvedPlan,
  TRAVELLER_PLAN_KEY,
  type TravellerStorageRules,
  billingPeriodStart,
} from './entitlements';
// S29 round 2: `resolveEntitlements` is not exported. It takes no scope proof, so only service
// code (behind its own gates) calls it; plans-schema.test.ts holds this.
export {
  DEFAULT_AGENCY_PLAN_KEY,
  PLANS_UNAVAILABLE,
  PLAN_NAME_MAX,
  PLAN_PERIOD_DAYS_MAX,
  PLAN_PRICE_MAX_MINOR_UNITS,
  type PlanAdminView,
  type PlanDraft,
  type PlanField,
  type PlanPriceInput,
  type PlanRefusal,
  type PlanRuleInput,
  type PlansAdminList,
  type RetirePreview,
  type SavePlanInput,
  type SavedPlan,
  DEFAULT_PLAN_PRICE_NEEDED,
  TRAVELLER_PLAN_CURRENCY,
  getPlanLatestPrice,
  listPlansForAdmin,
  pendingDowngradesSentence,
  planDraftProblem,
  previewPlanRetire,
  retirePlan,
  savePlan,
} from './plans-admin';
export { type PaymentMode, type PlanAudience, entitlementsSchemaPresent } from './plans-schema';
export {
  MODE_CHANGED,
  PAYMENT_METHOD_OFF,
  type StartPersonPaymentInput,
  TEST_PAYMENTS_ONLY,
  startPersonPayment,
} from './payments';
export { countLedgerTestRows } from './ledger-export';
export { personRefundGuardPresent } from './refunds';
export { personBillingPresent } from './traveller-billing';
export { MODE_CHANGED_CODE } from './refunds';
// S28: AI feature controls. The owner context, the gate and the charge stay inside the services.
export {
  AI_FEATURE_WINDOW_MS,
  type AiFeatureStateOptions,
  type AiUsageToday,
  aiFeatureDay,
  getAiFeatureStates,
  getAiUsageToday,
  isAiFeatureRefusal,
} from './ai-feature-settings';
export {
  type PaymentPortChoice,
  currencyListWords,
  currencyWords,
  onlineCurrencyRefusal,
  paymentPortResolver,
} from './payment-resolver';
export type { PaymentPortResolver } from './ports';
export type { PaymentProviderReason } from './errors';
export type { RefundGatewayView } from './refunds';
// S22: agency AI connectors (ADR 0021 S22 amendment). The scope, the member standing, the
// organization feature context and the code issuer stay inside the services.
export { agencyAiAvailable, aiAssistAvailable } from './agency-ai-ready';
export {
  AGENCY_AI_CONNECTION_MAX_MS,
  AGENCY_AI_ROLES,
  type AgencyAiStandingRefusal,
} from './access/agency-ai-scope';
export {
  AGENCY_AI_CONNECTION_DURATIONS,
  AGENCY_AI_DEFAULT_DURATION,
  type AgencyAiConnectionDuration,
  type AgencyAiConnectionList,
  type AgencyAiConnectionSummary,
  type CreateAgencyAiRefusal,
  createAgencyAiConnection,
  isAgencyAiConnectionDuration,
  listAgencyAiConnections,
  turnOffAgencyAiConnection,
} from './access/agency-ai-connections';
export {
  type OrganizationAiSetting,
  getOrganizationAiSetting,
  setOrganizationAiSetting,
} from './access/organization-ai-settings';
export {
  GRANT_AI_ASSIST_STEP_UP_ACTION,
  type GrantAiAssistRefusal,
  grantAllowsAiAssist,
  setGrantAiAssist,
} from './grant-ai-assist';
export {
  type AgencyAiCaseView,
  type AgencyAiGateway,
  type AgencyAiGrantedScope,
  type AgencyAiNarrowing,
  withAgencyAiConnection,
} from './access/with-ai-connection';
export { AGENCY_AI_TOOLS, aiToolsFor, isAgencyToolCall } from './ai-tools';
export type { AgencyAiToolDefinition, AnyConnectorToolDefinition } from './ai-tools/result';
// ADR 0025 T5: a person's own Billing History (purchases, receipts and their PDFs).
export {
  type OwnPurchaseStatus,
  type OwnPurchaseView,
  type OwnReceiptView,
  PERSON_REFUND_WINDOW_DAYS,
  hasOwnBilling,
  listOwnBilling,
  ownInvoiceDocument,
  ownReceiptDocument,
} from './person-billing-history';
// WP-SB0: shared paging (page sizes, scoped list cursors and the matching query helpers).
export * from './paging';

// --- Resource lifecycle programme (docs/roadmap/lifecycle/PROGRAMME.md section 5.2) ---
// One anchor per lane: each lane inserts its exports only directly below its own anchor.
// LC-F exports
export {
  DOCUMENT_ACTIONS,
  DOCUMENT_LIFECYCLE_STATES,
  DELETION_RECEIPT_STATUSES,
  LIFECYCLE_RELATIONS,
  LIFECYCLE_STAFF_ACTIONS,
  LIFECYCLE_SYSTEM_JOBS,
  type AdvanceDeletionReceiptPatch,
  type DeletionReceiptStatus,
  type DeletionReceiptView,
  type DocumentAction,
  type DocumentActionView,
  type DocumentLifecycle,
  type DocumentLifecycleState,
  type DuplicateBlockReason,
  type EnqueueDocumentRemovalInput,
  type EnqueueDocumentRemovalOutcome,
  type LifecycleAccess,
  type OpenDeletionReceiptInput,
  type ReceiptEffects,
  advanceDeletionReceipt,
  availableDocumentActions,
  enqueueDocumentRemoval,
  everydayApplicantCondition,
  everydayDocumentCondition,
  getDocumentLifecycle,
  getDocumentLifecycles,
  lifecycleTablesPresent,
  listDeletionReceipts,
  mergeReceiptEffects,
  openDeletionReceipt,
  presentApplicantCondition,
  presentDocumentCondition,
  receiptEffectsSchema,
  receiptMoveAllowed,
} from './lifecycle/foundation';

// LC-A1 exports

// LC-B exports
export {
  type DocumentLifecycleLabelInput,
  type ReplaceDocumentOutcome,
  type ReplacedInCase,
  type ReplacementCandidate,
  type ReplacementOptions,
  documentLifecycleLabel,
  listReplacementOptions,
  replaceDocument,
} from './lifecycle/replace';

// LC-C exports

// LC-D exports

// LC-E exports
