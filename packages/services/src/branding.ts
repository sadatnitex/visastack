import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  type ImageSanitizerPort,
  type SanitizedImage,
  isAcceptableSanitizedImage,
} from './image-sanitizer';
import type { MalwareScannerPort } from './intake';
import { isOrgAdmin } from './organizations';
import type { BlobStore } from './storage';

/**
 * Agency branding (Commercial V1 COM-04, master directive Part 5 §9).
 *
 * "Allow: approved logo; agency name; one accessible accent color. Always
 * retain 'Powered by VisaStack.'" -- "agency name" IS `organizations.name`
 * itself (no separate "display name" concept exists or is invented here);
 * this file adds the update path for it that never existed before (see
 * `updateOrganizationBranding` -- `createOrganization` was the only prior
 * writer). "Powered by VisaStack" is a UI-layer constant rendered wherever
 * branding shows, never a stored/overridable value.
 *
 * Owner/admin self-service, not a platform-admin action: directive §11
 * lists "manage branding" among the agency owner's own operations, and §10's
 * admin-workspace list never mentions it. Gated by `isOrgAdmin`
 * (organizations.ts) -- the exact same OWNER-or-ADMIN boundary
 * `setRequireDifferentReviewer`/`addMembership` already use for an org's own
 * configuration, not `isPlatformOwner`.
 *
 * "One ACCESSIBLE accent color" is enforced, not decorative: a color is
 * accepted only if its WCAG 2.1 contrast ratio against white is at least
 * 4.5:1 (AA, normal text) -- `isAccessibleAccentColor`. Contrast is
 * symmetric ((L1+0.05)/(L2+0.05) doesn't care which side is "foreground"),
 * so this one check covers both real uses at once: the color as text on the
 * app's white background, and the color as a badge/button background with
 * white text on it.
 *
 * The logo does NOT reuse `uploads.ts`/`documents.ts` (the applicant
 * evidence vault) -- that pipeline is shaped around an applicant, a quota
 * tier, consent, and document review states, none of which exist for an
 * organization. Instead it composes the same lower-level, evidence-agnostic
 * primitives that pipeline is itself built from (`BlobStore.putObject`,
 * `MalwareScannerPort.scan`, `StoragePort.issueReadRef`) directly, and
 * scans SYNCHRONOUSLY within the request rather than through the async
 * intake worker -- a small, single image never needs that machinery, and
 * `organizations.logoObjectKey` is only ever written AFTER a passing scan,
 * so its mere presence already means "scanned and safe": no separate
 * safety-status column is needed the way `documentVersions.safetyStatus`
 * is. Replacing a logo deletes the previous blob (best-effort, outside the
 * committing transaction) -- unlike evidence, a logo carries no retention
 * or audit reason to keep prior versions around.
 *
 * "Agency A branding can never appear in Agency B context" holds
 * structurally: every read here is scoped by a single `organizationId`
 * argument, there is no cross-organization query anywhere in this file, and
 * `getOrganizationBrandingForDisplay` mints a fresh, time-limited signed
 * reference to only THIS organization's own logo object on every call --
 * never a raw, cacheable, reusable URL. "Independent traveller wallet stays
 * VisaStack-branded" is likewise structural: nothing in this file is called
 * from any traveller-facing page (the mission/case workspace, notifications)
 * -- only the org's own console and the client-invitation accept-preview
 * page (the PRD's own named "agency-context portal" and "invitations"
 * surfaces) render what this file returns.
 */

export type OrganizationBrandingRow = typeof schema.organizations.$inferSelect;

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MiB -- a logo, not evidence.
export const ALLOWED_LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;
/** WCAG 2.1 AA, normal text. */
export const MIN_ACCENT_CONTRAST_RATIO = 4.5;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function srgbChannelToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance of a `#rrggbb` color. Throws if `hex` isn't that exact format -- callers validate format first. */
export function relativeLuminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const [rl, gl, bl] = [r, g, b].map(srgbChannelToLinear);
  return 0.2126 * (rl ?? 0) + 0.7152 * (gl ?? 0) + 0.0722 * (bl ?? 0);
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colors, always >= 1. */
export function contrastRatio(hexA: string, hexB: string): number {
  const [lLight, lDark] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
  return ((lLight ?? 0) + 0.05) / ((lDark ?? 0) + 0.05);
}

/**
 * True if `hex` is a well-formed `#rrggbb` color AND has sufficient
 * contrast against white to be legible as either text on the app's white
 * background or a background behind white text -- the PRD's own
 * "accessible" requirement, not merely "a valid color."
 */
export function isAccessibleAccentColor(hex: string): boolean {
  if (!HEX_COLOR_PATTERN.test(hex)) return false;
  return contrastRatio(hex, '#ffffff') >= MIN_ACCENT_CONTRAST_RATIO;
}

export interface OrganizationBranding {
  readonly name: string;
  readonly accentColor: string | null;
  /**
   * The app's own address for this logo (`organizationLogoPath`), `null` when no logo is set. It is a plain
   * same-origin path so an image tag can load it; the logo route decides who may fetch it. The path changes
   * when the logo is replaced, so a browser never shows a stale one.
   */
  readonly logoUrl: string | null;
}

/** Where the app serves an organization's logo. `version` changes whenever the logo does. */
export function organizationLogoPath(organizationId: string, version: string): string {
  return `/api/branding/logo/${organizationId}?v=${encodeURIComponent(version)}`;
}

/** A short, stable stand-in for a logo's stored key, used only to change the address when the logo changes. */
export function logoVersion(objectKey: string): string {
  return objectKey.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
}

export interface UpdateOrganizationBrandingInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly name?: string;
  /** `null` clears the accent color back to unset. Omit to leave it untouched. */
  readonly accentColor?: string | null;
}

/**
 * Change an organization's name and/or accent color (the two branding
 * elements that are plain fields, not stored bytes -- see
 * `uploadOrganizationLogo`/`removeOrganizationLogo` for the logo). Partial
 * update: only fields explicitly present in `input` are touched, matching
 * `updatePlan`'s own discipline.
 */
export async function updateOrganizationBranding(
  db: Db,
  input: UpdateOrganizationBrandingInput,
): Promise<Result<OrganizationBrandingRow, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(
      serviceError('forbidden', "only an org OWNER/ADMIN can change this organization's branding"),
    );
  }
  const name = input.name?.trim();
  if (input.name !== undefined && (name === undefined || name.length === 0)) {
    return err(serviceError('invalid', 'name cannot be blank'));
  }
  if (input.accentColor !== undefined && input.accentColor !== null) {
    if (!isAccessibleAccentColor(input.accentColor)) {
      return err(
        serviceError(
          'invalid',
          'accentColor must be a #rrggbb color with at least 4.5:1 contrast against white',
        ),
      );
    }
  }

  const organization = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!organization) return err(serviceError('not_found', 'organization not found'));

  let changes: Record<string, { readonly before: unknown; readonly after: unknown }> = {};
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const track = <K extends keyof OrganizationBrandingRow>(
    key: K,
    value: OrganizationBrandingRow[K] | undefined,
  ): void => {
    if (value === undefined || value === organization[key]) return;
    set[key] = value;
    changes = { ...changes, [key]: { before: organization[key], after: value } };
  };
  track('name', name);
  track('accentColor', input.accentColor);
  if (Object.keys(changes).length === 0) return ok(organization);

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.organizations)
          .set(set)
          .where(eq(schema.organizations.id, input.organizationId))
          .returning(),
      ),
      'organization',
    );
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_BRANDING_UPDATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: input.organizationId,
      metadata: { changes },
    });
    return ok(updated);
  });
}

export interface UploadOrganizationLogoInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** The longest side a stored logo may have, and the pixel ceiling an upload is refused above. */
export const LOGO_MAX_DIMENSION = 1024;
export const LOGO_MAX_INPUT_PIXELS = 40_000_000;

/** What a logo upload must pass: the configured safety scanner, then server-side re-encoding. */
export interface LogoUploadChecks {
  readonly scanner: MalwareScannerPort;
  readonly images: ImageSanitizerPort;
}

/**
 * Upload (or replace) an organization's logo. Validates content type and
 * size, writes the bytes to a temporary quarantine key, verifies the write by
 * reading it back (same discipline the applicant upload path uses), scans it
 * synchronously, re-encodes it server side so only image data is kept (S27),
 * stores and verifies the re-encoded copy, and only then attaches it to the
 * organization -- an unsafe, unreadable or oversized image never touches the
 * organization row at all, and the uploaded bytes themselves are never kept.
 */
export async function uploadOrganizationLogo(
  db: Db,
  storage: BlobStore,
  checks: LogoUploadChecks,
  input: UploadOrganizationLogoInput,
): Promise<Result<OrganizationBrandingRow, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(
      serviceError('forbidden', "only an org OWNER/ADMIN can change this organization's branding"),
    );
  }
  if (!(ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    return err(serviceError('invalid', 'logo must be a PNG or JPEG image'));
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_LOGO_BYTES) {
    return err(
      serviceError(
        'invalid',
        `logo must be between 1 byte and ${MAX_LOGO_BYTES / (1024 * 1024)} MB`,
      ),
    );
  }
  const organization = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!organization) return err(serviceError('not_found', 'organization not found'));

  const uploadKey = `logo-upload-${randomUUID()}`;
  const objectKey = randomUUID();
  let clean: SanitizedImage;
  try {
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey: uploadKey,
      contentType: input.contentType,
      bytes: input.bytes,
    });
    const verification = await storage.getObject(uploadKey);
    if (!verification || verification.bytes.byteLength !== input.bytes.byteLength) {
      return err(serviceError('invalid', 'upload failed verification -- please try again'));
    }
    const scanResult = await checks.scanner.scan({ bucket: 'QUARANTINE', objectKey: uploadKey });
    if (!scanResult.safe) {
      return err(serviceError('invalid', 'this image failed the required safety scan'));
    }
    try {
      clean = await checks.images.sanitize({
        bytes: verification.bytes,
        maxInputPixels: LOGO_MAX_INPUT_PIXELS,
        maxDimension: LOGO_MAX_DIMENSION,
      });
    } catch {
      return err(serviceError('invalid', 'this image could not be read -- try a PNG or JPEG'));
    }
    if (
      !isAcceptableSanitizedImage(clean, {
        maxBytes: MAX_LOGO_BYTES,
        maxDimension: LOGO_MAX_DIMENSION,
      })
    ) {
      return err(serviceError('invalid', 'this image could not be read -- try a PNG or JPEG'));
    }
    await storage.putObject({
      bucket: 'QUARANTINE',
      objectKey,
      contentType: clean.contentType,
      bytes: clean.bytes,
    });
    const stored = await storage.getObject(objectKey);
    if (!stored || stored.bytes.byteLength !== clean.bytes.byteLength) {
      await storage.deleteObject('QUARANTINE', objectKey).catch(() => undefined);
      return err(serviceError('invalid', 'upload failed verification -- please try again'));
    }
  } finally {
    await storage.deleteObject('QUARANTINE', uploadKey).catch(() => undefined);
  }
  const contentType = clean.contentType;

  const updated = required(
    first(
      await db.transaction(async (tx) => {
        const row = await tx
          .update(schema.organizations)
          .set({
            logoObjectKey: objectKey,
            logoContentType: contentType,
            updatedAt: new Date(),
          })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning();
        await appendAuditEvent(tx, {
          eventType: 'ORGANIZATION_LOGO_UPDATED',
          actorAccountId: input.actorAccountId,
          method: 'MANUAL',
          result: 'ALLOWED',
          resourceType: 'organization',
          resourceId: input.organizationId,
          metadata: { contentType, sizeBytes: clean.bytes.byteLength },
        });
        return row;
      }),
    ),
    'organization',
  );

  // Best-effort cleanup of the previous logo, outside the transaction that
  // just committed the new one -- a logo carries no retention/audit reason
  // to keep prior versions the way evidence documents do, so a durable
  // erasure job would be disproportionate; an orphaned old blob is inert
  // storage litter, not a compliance concern.
  if (organization.logoObjectKey && organization.logoObjectKey !== objectKey) {
    await storage.deleteObject('QUARANTINE', organization.logoObjectKey).catch(() => undefined);
  }
  return ok(updated);
}

export interface RemoveOrganizationLogoInput {
  readonly actorAccountId: string;
  readonly organizationId: string;
}

/** Remove an organization's logo, if any. Idempotent: a no-op success when none is set. */
export async function removeOrganizationLogo(
  db: Db,
  storage: BlobStore,
  input: RemoveOrganizationLogoInput,
): Promise<Result<OrganizationBrandingRow, ServiceError>> {
  if (!(await isOrgAdmin(db, input.actorAccountId, input.organizationId))) {
    return err(
      serviceError('forbidden', "only an org OWNER/ADMIN can change this organization's branding"),
    );
  }
  const organization = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!organization) return err(serviceError('not_found', 'organization not found'));
  if (!organization.logoObjectKey) return ok(organization);

  const updated = required(
    first(
      await db.transaction(async (tx) => {
        const row = await tx
          .update(schema.organizations)
          .set({ logoObjectKey: null, logoContentType: null, updatedAt: new Date() })
          .where(eq(schema.organizations.id, input.organizationId))
          .returning();
        await appendAuditEvent(tx, {
          eventType: 'ORGANIZATION_LOGO_REMOVED',
          actorAccountId: input.actorAccountId,
          method: 'MANUAL',
          result: 'ALLOWED',
          resourceType: 'organization',
          resourceId: input.organizationId,
        });
        return row;
      }),
    ),
    'organization',
  );
  await storage.deleteObject('QUARANTINE', organization.logoObjectKey).catch(() => undefined);
  return ok(updated);
}

/**
 * An organization's current branding, ready to render -- the org's own
 * console, the plan page, and the client-invitation accept-preview page are
 * this function's only real callers (never a traveller-facing mission/case
 * page or a notification). `undefined` only when the organization itself
 * doesn't exist; a real organization with no branding set yet still
 * returns its (mandatory) name with `accentColor`/`logoUrl` both null.
 */
export async function getOrganizationBrandingForDisplay(
  db: Db,
  organizationId: string,
): Promise<OrganizationBranding | undefined> {
  const organization = first(
    await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
  if (!organization) return undefined;
  return {
    name: organization.name,
    accentColor: organization.accentColor,
    logoUrl: organization.logoObjectKey
      ? organizationLogoPath(organization.id, logoVersion(organization.logoObjectKey))
      : null,
  };
}

/** The logo's bytes and image type, for the app's logo route (and, later, for documents an agency produces). */
export async function readOrganizationLogo(
  db: Db,
  storage: Pick<BlobStore, 'getObject'>,
  organizationId: string,
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | undefined> {
  const organization = first(
    await db
      .select({
        key: schema.organizations.logoObjectKey,
        contentType: schema.organizations.logoContentType,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
  if (!organization?.key || !organization.contentType) return undefined;
  if (!(ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(organization.contentType)) {
    return undefined;
  }
  const object = await storage.getObject(organization.key);
  return object ? { bytes: object.bytes, contentType: organization.contentType } : undefined;
}
