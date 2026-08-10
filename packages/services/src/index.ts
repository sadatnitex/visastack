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
  listRecentAuditEvents,
} from './audit';

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
} from './profile';

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
  type BulkExportRow,
  type EvidenceRequest,
  type EvidenceRequestWithApplicant,
  type MissionDecision,
  type MissionNote,
  type OrgApplicant,
  type OrgMission,
  addNote,
  assignMember,
  bulkExport,
  isActiveMember,
  listApplicantsForOrganization,
  listAssignments,
  listAssignmentsDetailed,
  listEvidenceRequestsForApplicant,
  listEvidenceRequestsForOrg,
  listEvidenceRequestsForOrgDetailed,
  listMissionDecisions,
  listMissionRequirementsForOrg,
  listMissionsForOrganization,
  listNotes,
  recordMissionDecision,
  requestEvidence,
  respondEvidence,
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
  acceptGrant,
  createGrant,
  getRecipientWorkspace,
  listAccessForApplicant,
  listAccessForApplicantDetailed,
  listGrantsForRecipientAccount,
  loadGrantsForPolicy,
  pauseGrant,
  resumeGrant,
  revokeGrant,
} from './sharing';

export {
  type DocumentInstance,
  type EvidenceCandidateEntry,
  type FactInstance,
  type GeneratedOutput,
  type Mission,
  type MissionSnapshot,
  type MissionTask,
  type MissingRequirement,
  type MissionUsingField,
  type Readiness,
  type RequirementMappingEntry,
  type SelectedEvidence,
  attachPackVersion,
  computeReadiness,
  createMission,
  createTask,
  decideTask,
  generateCoverLetter,
  getEvidenceCandidates,
  getMissionForOwner,
  getMissionSnapshot,
  isFactStatusEligible,
  legalTransitions,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissions,
  listMissionsUsingField,
  listSelectedEvidence,
  listTasks,
  selectEvidence,
  snapshotMission,
  transitionMission,
  unselectEvidence,
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
  type MrzError,
  type Td3Result,
  checkDigit,
  parseTd3,
} from './mrz';

export {
  PIPELINE_VERSION,
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
  type DocumentSummary,
  type DocumentVersion,
  type DownloadDocumentInput,
  type RegisterDocumentInput,
  type RegisterDocumentWithVersionInput,
  type StorageObject,
  addDocumentVersion,
  downloadDocument,
  isServableProcessingState,
  listDocuments,
  listDocumentsDetailed,
  previewDocument,
  registerDocument,
  registerDocumentWithVersion,
} from './documents';

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
  type ReserveUploadInput,
  type UploadIntent,
  failUpload,
  finalizeUpload,
  reserveUpload,
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
  IdentityPort,
  JobQueuePort,
  ObservabilityEvent,
  ObservabilityPort,
  PaymentPort,
  ResolvedIdentity,
  SendEmailInput,
} from './ports';
