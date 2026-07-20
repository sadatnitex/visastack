import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Requirement Packs & Pack Studio (Build Spec §4.5; PRD §4).
 *
 * A pack is a composable, versioned requirement set. Requirements are authored
 * in a DRAFT version, each carrying a citation (nothing is required without a
 * grounded source). Approval freezes a deterministic manifest + checksum;
 * publishing makes the version immutable and usable by missions. The lifecycle
 * is DRAFT → APPROVED → PUBLISHED (→ DEPRECATED), and content can only change
 * while DRAFT.
 */

export type Pack = typeof schema.packs.$inferSelect;
export type PackVersion = typeof schema.packVersions.$inferSelect;
export type PackRequirement = typeof schema.packRequirements.$inferSelect;

export interface RequirementInput {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly fieldKey?: string;
  readonly docType?: string;
  readonly citation: string;
  readonly optional?: boolean;
  readonly notes?: string;
}

/** Deterministic manifest for a set of requirements, plus its checksum. */
export function buildManifest(requirements: readonly PackRequirement[]): {
  manifest: { requirements: unknown[] };
  checksum: string;
} {
  const items = requirements
    .map((r) => ({
      kind: r.kind,
      fieldKey: r.fieldKey,
      docType: r.docType,
      citation: r.citation,
      optional: r.optional,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const manifest = { requirements: items };
  const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { manifest, checksum };
}

/** Create a pack (its first version is added separately). */
export async function createPack(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly key: string;
    readonly name: string;
    readonly description?: string;
    readonly ownerOrganizationId?: string;
  },
): Promise<Result<Pack, ServiceError>> {
  if (input.key.trim().length === 0 || input.name.trim().length === 0) {
    return err(serviceError('invalid', 'pack key and name are required'));
  }
  return db.transaction(async (tx) => {
    const pack = required(
      first(
        await tx
          .insert(schema.packs)
          .values({
            key: input.key.trim(),
            name: input.name.trim(),
            description: input.description ?? null,
            ownerOrganizationId: input.ownerOrganizationId ?? null,
          })
          .returning(),
      ),
      'pack',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack',
      resourceId: pack.id,
      metadata: { key: pack.key },
    });
    return ok(pack);
  });
}

/** Open a new DRAFT version of a pack. */
export async function addPackVersion(
  db: Db,
  input: { readonly actorAccountId: string; readonly packId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const pack = first(
    await db.select().from(schema.packs).where(eq(schema.packs.id, input.packId)).limit(1),
  );
  if (!pack) return err(serviceError('not_found', 'pack not found'));

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: schema.packVersions.version })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.packId, input.packId));
    const nextVersion = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;

    const version = required(
      first(
        await tx
          .insert(schema.packVersions)
          .values({ packId: input.packId, version: nextVersion })
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_OPENED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: version.id,
      metadata: { packId: input.packId, version: nextVersion },
    });
    return ok(version);
  });
}

async function loadVersion(db: Db, id: string): Promise<PackVersion | undefined> {
  return first(
    await db.select().from(schema.packVersions).where(eq(schema.packVersions.id, id)).limit(1),
  );
}

/** Add a cited requirement to a DRAFT pack version. */
export async function addRequirement(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string } & RequirementInput,
): Promise<Result<PackRequirement, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'DRAFT') {
    return err(serviceError('invalid', 'requirements can only change while the version is DRAFT'));
  }
  if (input.citation.trim().length === 0) {
    return err(serviceError('invalid', 'every requirement must carry a citation'));
  }
  if (input.kind === 'FIELD' && !input.fieldKey) {
    return err(serviceError('invalid', 'a FIELD requirement needs a fieldKey'));
  }
  if (input.kind === 'DOCUMENT' && !input.docType) {
    return err(serviceError('invalid', 'a DOCUMENT requirement needs a docType'));
  }

  return db.transaction(async (tx) => {
    const requirement = required(
      first(
        await tx
          .insert(schema.packRequirements)
          .values({
            packVersionId: input.packVersionId,
            kind: input.kind,
            fieldKey: input.fieldKey ?? null,
            docType: input.docType ?? null,
            citation: input.citation.trim(),
            optional: input.optional ?? false,
            notes: input.notes ?? null,
          })
          .returning(),
      ),
      'requirement',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_REQUIREMENT_ADDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: input.packVersionId,
      metadata: {
        kind: input.kind,
        fieldKey: input.fieldKey ?? null,
        docType: input.docType ?? null,
      },
    });
    return ok(requirement);
  });
}

export async function listRequirements(db: Db, packVersionId: string): Promise<PackRequirement[]> {
  return db
    .select()
    .from(schema.packRequirements)
    .where(eq(schema.packRequirements.packVersionId, packVersionId));
}

/**
 * Approve a DRAFT version (admin/reviewer action). Freezes the manifest +
 * checksum; the version becomes immutable content.
 */
export async function approvePackVersion(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'DRAFT') {
    return err(serviceError('invalid', 'only a DRAFT version can be approved'));
  }
  const requirements = await listRequirements(db, input.packVersionId);
  if (requirements.length === 0) {
    return err(serviceError('invalid', 'cannot approve a version with no requirements'));
  }
  const { manifest, checksum } = buildManifest(requirements);

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({
            status: 'APPROVED',
            manifest,
            checksum,
            approvedByAccountId: input.actorAccountId,
            approvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.packVersions.id, input.packVersionId))
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_APPROVED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
      metadata: { checksum },
    });
    return ok(updated);
  });
}

/** Publish an APPROVED version, making it usable by missions. */
export async function publishPackVersion(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'APPROVED') {
    return err(serviceError('invalid', 'only an APPROVED version can be published'));
  }
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({ status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.packVersions.id, input.packVersionId))
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_PUBLISHED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/** Verify a version's stored checksum matches its current requirements. */
export async function verifyPackChecksum(db: Db, packVersionId: string): Promise<boolean> {
  const version = await loadVersion(db, packVersionId);
  if (!version || !version.checksum) return false;
  const { checksum } = buildManifest(await listRequirements(db, packVersionId));
  return checksum === version.checksum;
}
