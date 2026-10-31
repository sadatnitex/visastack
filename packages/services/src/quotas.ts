import { inArray, sql } from 'drizzle-orm';
import { listApplicantsForOrganization } from './agency';
import { type Db, schema } from './db';
import { type TravellerStorageRules, travellerStorageRulesFor } from './entitlements';

/**
 * Application-level upload quotas (master directive §10 — Release B).
 *
 * These are VisaStack application limits, not claims about unlimited
 * infrastructure. They are configuration-driven (env-overridable, so an
 * administrator can lower them without a redeploy) with conservative pilot
 * defaults, and are enforced BEFORE any bytes are written — a quota is never
 * silently exceeded.
 */

export const BYTES_PER_MB = 1024 * 1024;

export interface UploadQuotaConfig {
  /** Per-file upload size limit. */
  readonly maxUploadBytes: number;
  /** Total evidence bytes a single applicant may accumulate. */
  readonly maxApplicantEvidenceBytes: number;
  /** Total evidence bytes a single account (across all its applicants) may accumulate. */
  readonly maxAccountEvidenceBytes: number;
  /** Platform-wide tracked storage total at which a warning should be raised. */
  readonly platformWarningBytes: number;
  /** Platform-wide tracked storage total at which new uploads are hard-stopped. */
  readonly platformHardStopBytes: number;
  /** Maximum PDF page count (EVI-01: "50 PDF pages"). Checked post-scan, not at reservation time; see `ContentLimitsPort`. */
  readonly maxPdfPages: number;
  /** Maximum image resolution in megapixels (EVI-01: "40 megapixels per image"). Checked post-scan, not at reservation time. */
  readonly maxImageMegapixels: number;
}

/**
 * Pilot defaults: 20 MiB / 50 MB / 100 MB / 500 MB / 700 MB / 50 pages / 40 MP.
 * `maxUploadBytes` is Commercial V1 PRD EVI-01's explicit "20 MiB per
 * original" initial configurable limit (superseding the prior engagement's
 * own 10 MB pilot default, per this programme's standing instruction to
 * follow the newer PRD's stated numbers rather than an older build's,
 * where they conflict); `maxPdfPages`/`maxImageMegapixels` are EVI-01's own
 * "50 PDF pages" / "40 megapixels per image" initial configurable limits,
 * unimplemented until Part 3's content-limits check; the other three are
 * unchanged pilot defaults not named by EVI-01.
 */
export const DEFAULT_UPLOAD_QUOTAS: UploadQuotaConfig = {
  maxUploadBytes: 20 * BYTES_PER_MB,
  maxApplicantEvidenceBytes: 50 * BYTES_PER_MB,
  maxAccountEvidenceBytes: 100 * BYTES_PER_MB,
  platformWarningBytes: 500 * BYTES_PER_MB,
  platformHardStopBytes: 700 * BYTES_PER_MB,
  maxPdfPages: 50,
  maxImageMegapixels: 40,
};

function envInt(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Resolve the active quota configuration: an env override (in MB, so an
 * operator never has to compute byte counts) when present, else the pilot
 * default. Never silently invents a more permissive value than the default.
 */
export function loadUploadQuotaConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): UploadQuotaConfig {
  const mb = (name: string, fallbackBytes: number): number => {
    const overrideMb = envInt(env, name);
    return overrideMb !== undefined ? overrideMb * BYTES_PER_MB : fallbackBytes;
  };
  return {
    maxUploadBytes: mb('QUOTA_MAX_UPLOAD_MB', DEFAULT_UPLOAD_QUOTAS.maxUploadBytes),
    maxApplicantEvidenceBytes: mb(
      'QUOTA_MAX_APPLICANT_EVIDENCE_MB',
      DEFAULT_UPLOAD_QUOTAS.maxApplicantEvidenceBytes,
    ),
    maxAccountEvidenceBytes: mb(
      'QUOTA_MAX_ACCOUNT_EVIDENCE_MB',
      DEFAULT_UPLOAD_QUOTAS.maxAccountEvidenceBytes,
    ),
    platformWarningBytes: mb(
      'QUOTA_PLATFORM_WARNING_MB',
      DEFAULT_UPLOAD_QUOTAS.platformWarningBytes,
    ),
    platformHardStopBytes: mb(
      'QUOTA_PLATFORM_HARD_STOP_MB',
      DEFAULT_UPLOAD_QUOTAS.platformHardStopBytes,
    ),
    maxPdfPages: envInt(env, 'QUOTA_MAX_PDF_PAGES') ?? DEFAULT_UPLOAD_QUOTAS.maxPdfPages,
    maxImageMegapixels:
      envInt(env, 'QUOTA_MAX_IMAGE_MEGAPIXELS') ?? DEFAULT_UPLOAD_QUOTAS.maxImageMegapixels,
  };
}

export function mbLabel(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

/** Total evidence bytes currently stored for one applicant (sum of document version sizes). */
export async function getApplicantEvidenceBytes(db: Db, applicantId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.documentVersions.sizeBytes}), 0)` })
    .from(schema.documentVersions)
    .innerJoin(
      schema.documents,
      sql`${schema.documentVersions.documentId} = ${schema.documents.id}`,
    )
    .where(sql`${schema.documents.applicantId} = ${applicantId}`);
  return Number(rows[0]?.total ?? 0);
}

/** Total evidence bytes across every applicant owned by one account. */
export async function getAccountEvidenceBytes(db: Db, accountId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.documentVersions.sizeBytes}), 0)` })
    .from(schema.documentVersions)
    .innerJoin(
      schema.documents,
      sql`${schema.documentVersions.documentId} = ${schema.documents.id}`,
    )
    .innerJoin(schema.applicants, sql`${schema.documents.applicantId} = ${schema.applicants.id}`)
    .where(sql`${schema.applicants.ownerAccountId} = ${accountId}`);
  return Number(rows[0]?.total ?? 0);
}

/**
 * Total evidence bytes across every applicant this organization currently
 * has real (active, accepted, current) access to -- COM-01's "total
 * retained storage" plan entitlement. Deliberately reuses
 * `listApplicantsForOrganization`'s exact grant-based definition of "which
 * applicants this org serves" rather than a narrower "cases this org
 * owns" one: storage is a genuine infrastructure footprint the org's
 * access enables, not a workload/ownership count (see `plans.ts`'s own
 * doc comment on why the cases-created/concurrent-open-cases meters use a
 * different, ownership-based definition instead).
 */
export async function getOrganizationEvidenceBytes(
  db: Db,
  organizationId: string,
): Promise<number> {
  const applicants = await listApplicantsForOrganization(db, organizationId);
  if (applicants.length === 0) return 0;
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.documentVersions.sizeBytes}), 0)` })
    .from(schema.documentVersions)
    .innerJoin(
      schema.documents,
      sql`${schema.documentVersions.documentId} = ${schema.documents.id}`,
    )
    .where(
      inArray(
        schema.documents.applicantId,
        applicants.map((a) => a.applicantId),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

/** Platform-wide tracked evidence bytes (for the usage dashboard and the hard-stop gate). */
export async function getPlatformEvidenceBytes(db: Db): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${schema.documentVersions.sizeBytes}), 0)` })
    .from(schema.documentVersions);
  return Number(rows[0]?.total ?? 0);
}

// Note: there is deliberately no plain read-then-decide "checkUploadQuota"
// here anymore. A pre-upload check with no reservation is a genuine TOCTOU
// race under concurrent uploads (two callers can each individually pass a
// stale check and jointly exceed a limit) — see `reserveUpload`
// (uploads.ts), which atomically checks every tier against committed bytes
// PLUS every other still-active reservation, then reserves this one, all
// before any bytes are written (master directive §7 "PR 6").

/** The storage limits a traveller plan's rules give: each rule, else the deployment's upload setting. */
export function storageLimitsFrom(
  rules: TravellerStorageRules | null,
  config: UploadQuotaConfig,
): { readonly accountBytes: number; readonly personBytes: number } {
  return {
    accountBytes: rules?.accountBytes ?? config.maxAccountEvidenceBytes,
    personBytes: rules?.personBytes ?? config.maxApplicantEvidenceBytes,
  };
}

/**
 * The storage limits that apply to `ownerAccountId`'s records (ADR 0025): the traveller plan's own
 * rules when it has them (a paid plan covering now, or Traveller Free), else the deployment's
 * upload settings. Uploads are always judged against the record owner's account, whoever uploads.
 */
export async function storageLimitsForOwner(
  db: Db,
  ownerAccountId: string,
  config: UploadQuotaConfig,
): Promise<{ readonly accountBytes: number; readonly personBytes: number }> {
  return storageLimitsFrom(await travellerStorageRulesFor(db, ownerAccountId), config);
}
