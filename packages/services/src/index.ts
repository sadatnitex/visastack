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
export { type ServiceError, type ServiceErrorCode, serviceError } from './errors';

export {
  type AuditEventInput,
  type AuditEventRow,
  appendAuditEvent,
  type ApplicantAuditEvent,
  checkRecentAuditChain,
  listAuditEventsForApplicant,
  listRecentAuditEvents,
} from './audit';

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
  listAllApplicants,
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
  type CreateGrantInput,
  type Grant,
  type GrantRecipient,
  type GrantWithRecipient,
  type IncomingGrant,
  type RecipientDocumentView,
  type RecipientFieldView,
  type RecipientWorkspaceView,
  type ScopeExpansionCandidate,
  acceptGrant,
  createGrant,
  documentCategory,
  expandGrantScope,
  getRecipientWorkspace,
  listAccessForApplicant,
  listAccessForApplicantDetailed,
  listGrantsForRecipientAccount,
  loadGrantsForPolicy,
  pauseGrant,
  previewScopeExpansion,
  resumeGrant,
  revokeGrant,
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
  type Readiness,
  type RequirementMappingEntry,
  type RequirementResultState,
  type RequirementResultSummary,
  type SelectedEvidence,
  type UpdateAppointmentInput,
  type UpdateTaskInput,
  attachPackVersion,
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

export {
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
  DUE_SOON_DAYS,
  type NeedsAttention,
  type NeedsAttentionOptions,
  attentionTier,
  daysUntilDueDay,
  listNeedsAttention,
  rankAttentionItems,
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
  type ScanResult,
  getLatestExtractedText,
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
  type FailedJobSummary,
  type IntakeWorkerResult,
  type ProcessingJob,
  enqueueIntakeJob,
  requestDocumentReExtraction,
  listFailedJobs,
  retryFailedJob,
  runIntakeWorker,
} from './jobs';

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
  activateAiProviderConfig,
  createDraftAiProviderConfig,
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
} from './ai-provider-config';

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
  type InvoiceStatus,
  type OpenBillingAccountInput,
  type RecordInvoicePaymentInput,
  type TransitionBillingStatusInput,
  type VoidInvoiceInput,
  createInvoice,
  getBillingAccountForOrganization,
  isBillingSuspended,
  legalBillingTransitions,
  listBillingStatusHistory,
  listInvoicesForOrganization,
  openBillingAccount,
  recordInvoicePayment,
  transitionBillingStatus,
  voidInvoice,
} from './billing';

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
  ResolvedIdentity,
  SendEmailInput,
  SendEmailResult,
} from './ports';

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
  type CreateClientInvitationInput,
  type CreatedClientInvitation,
  acceptClientInvitation,
  createClientInvitation,
  isAcceptableInvitationContact,
  listClientInvitations,
  previewClientInvitation,
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

export { type PlatformOverview, getPlatformOverview } from './platform-overview';

export {
  createSharingInvitation,
  previewSharingInvitation,
  acceptSharingInvitation,
  listSharingInvitations,
  revokeSharingInvitation,
  type SharingInvitation,
} from './sharing-invitations';
