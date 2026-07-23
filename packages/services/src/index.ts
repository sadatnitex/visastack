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
export type { Db, Schema } from './db';
export { type ServiceError, type ServiceErrorCode, serviceError } from './errors';

export { type AuditEventInput, type AuditEventRow, appendAuditEvent } from './audit';

export {
  type Account,
  type ProvisionAccountInput,
  getAccountByEmail,
  getAccountByWorkosUserId,
  provisionAccount,
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
  PutObjectInput,
  StorageBucket,
  StoragePort,
  StoredBytes,
} from './storage';

export { type AccountExport, exportAccount } from './export';

export {
  type LegalHold,
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
  type Assignment,
  type AssignmentView,
  type BulkExportRow,
  type EvidenceRequest,
  type EvidenceRequestWithApplicant,
  type MissionNote,
  type OrgApplicant,
  type OrgMission,
  addNote,
  assignMember,
  bulkExport,
  listApplicantsForOrganization,
  listAssignments,
  listAssignmentsDetailed,
  listEvidenceRequestsForApplicant,
  listEvidenceRequestsForOrg,
  listEvidenceRequestsForOrgDetailed,
  listMissionsForOrganization,
  listNotes,
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
  acceptGrant,
  createGrant,
  listAccessForApplicant,
  listAccessForApplicantDetailed,
  listGrantsForRecipientAccount,
  pauseGrant,
  resumeGrant,
  revokeGrant,
} from './sharing';

export {
  type Mission,
  type MissionSnapshot,
  type MissingRequirement,
  type Readiness,
  attachPackVersion,
  computeReadiness,
  createMission,
  getMissionForOwner,
  legalTransitions,
  listMissionSnapshots,
  listMissions,
  snapshotMission,
  transitionMission,
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
  type ScannerPort,
  type ScanResult,
  nextIntakeState,
  processIntake,
} from './intake';

export {
  type ExtractedDocument,
  type ExtractionErrorCode,
  type ExtractionOutcome,
  type TextExtractionInput,
  type TextExtractionPort,
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
  type AiBudget,
  type AiExtractionInput,
  type AiExtractionPort,
  type AiExtractionResult,
  type AiUsage,
  type ApproveProposalInput,
  type FieldProposal,
  type RunExtractionInput,
  approveProposal,
  awaitingReview,
  runExtraction,
} from './ai';

export {
  type DeletionRequest,
  cancelAccountDeletion,
  executeAccountDeletion,
  getPendingDeletion,
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
  type StorageObject,
  addDocumentVersion,
  downloadDocument,
  listDocuments,
  listDocumentsDetailed,
  previewDocument,
  registerDocument,
} from './documents';

export {
  type CheckUploadQuotaInput,
  DEFAULT_UPLOAD_QUOTAS,
  type QuotaDecision,
  type UploadQuotaConfig,
  checkUploadQuota,
  getAccountEvidenceBytes,
  getApplicantEvidenceBytes,
  getPlatformEvidenceBytes,
  loadUploadQuotaConfig,
} from './quotas';
