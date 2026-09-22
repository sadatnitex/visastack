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
export { type ServiceError, type ServiceErrorCode, serviceError } from './errors';

export {
  type AuditEventInput,
  type AuditEventRow,
  appendAuditEvent,
  type ApplicantAuditEvent,
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
} from './accounts';

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
  revealFactVersionValue,
} from './profile';

export {
  type FieldSensitivity,
  type ProtectedValue,
  type RevealValueInput,
  buildFactVersionAad,
  protectValue,
  requiresProtection,
  resetProtectedFieldKeyCacheForTests,
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

export { type AccountExport, exportAccount } from './export';

export {
  type LegalHold,
  type PurgeExpiredDocumentsResult,
  type RetentionPolicy,
  documentsPastRetention,
  getRetentionPolicies,
  hasActiveLegalHold,
  listActiveLegalHolds,
  listLegalHolds,
  placeLegalHold,
  purgeExpiredDocuments,
  releaseLegalHold,
  setRetentionPolicy,
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
  listTasksForOrg,
  listUnassignedActiveMissions,
  listVisibleMissionsForMember,
  orgGrantPermits,
  recordMissionDecision,
  requestEvidence,
  startEvidenceReview,
  submitEvidenceResponse,
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
} from './organizations';

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
  type MissionSnapshot,
  type MissionTask,
  type MissingRequirement,
  type MissionUsingField,
  type Readiness,
  type RequirementMappingEntry,
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
  type Pack,
  type PackRequirement,
  type PackVersion,
  type PublishedPackVersion,
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  buildManifest,
  createPack,
  getPack,
  listPackVersions,
  listPacks,
  listPublishedPackVersions,
  listRequirements,
  publishPackVersion,
  verifyPackChecksum,
} from './packs';

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
  CONFIDENCE_THRESHOLD,
  type ClassificationResult,
  classifyDocumentText,
} from './classification';

export {
  type NameComponentsInput,
  buildProposedName,
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
  type FailedJobSummary,
  type IntakeWorkerResult,
  type ProcessingJob,
  enqueueIntakeJob,
  listFailedJobs,
  retryFailedJob,
  runIntakeWorker,
} from './jobs';

export {
  type AiCacheKeyComponents,
  type AiExtractionErrorCode,
  type AiExtractionInput,
  type AiExtractionOutcome,
  type AiExtractionPort,
  type AiExtractionResult,
  type AiUsage,
  type ApproveProposalInput,
  type EvidenceLocationRow,
  type FieldProposal,
  type FieldProposalRow,
  type ProposalWithEvidence,
  type RejectProposalInput,
  type RunExtractionInput,
  type RunExtractionSummary,
  approveProposal,
  countAiExtractionAttempts,
  documentAiCostUnits,
  listPendingProposals,
  rejectProposal,
  runExtraction,
  totalAiCostUnits,
} from './ai';

export {
  type DeletionRequest,
  cancelAccountDeletion,
  executeAccountDeletion,
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
  isServableProcessingState,
  listDocumentReviews,
  listDocuments,
  listDocumentsDetailed,
  previewDocument,
  recheckDocumentAccess,
  recordDocumentReview,
  registerDocument,
  registerDocumentWithVersion,
  setDocumentDate,
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
  getPlatformEvidenceBytes,
  loadUploadQuotaConfig,
  mbLabel,
} from './quotas';

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
  type RateLimitConfig,
  type RateLimitDecision,
  checkRateLimit,
} from './rate-limit';

export {
  PRODUCT_EVENT_TYPES,
  type PilotScorecardRow,
  type ProductEventType,
  type RecordProductEventInput,
  getPilotScorecard,
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
  type AcceptOrganizationInvitationInput,
  type CreatedOrganizationInvitation,
  type CreateOrganizationInvitationInput,
  type OrganizationInvitation,
  type OrganizationInvitationPreview,
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  listOrganizationInvitations,
  previewOrganizationInvitation,
  revokeOrganizationInvitation,
} from './invitations';

export {
  type AcceptClientInvitationInput,
  type AcceptedClientInvitation,
  type ApplicantChoice,
  type ClientInvitation,
  type ClientInvitationPreview,
  type CreateClientInvitationInput,
  type CreatedClientInvitation,
  acceptClientInvitation,
  createClientInvitation,
  listClientInvitations,
  previewClientInvitation,
  revokeClientInvitation,
} from './client-invitations';

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
