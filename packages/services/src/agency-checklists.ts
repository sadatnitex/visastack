import { type Result, err, isStarterPackKey, ok } from '@visastack/core';
import { and, desc, eq, ilike, inArray, isNull } from 'drizzle-orm';
import {
  type AgencyChecklistScope,
  agencyChecklistScopeProblem,
} from './access/agency-checklist-scope';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError, serviceError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import {
  type DraftRequirementPatch,
  MAX_AUDIENCE_LENGTH,
  MAX_WORDING_LENGTH,
  removeDraftRequirement,
  updateDraftRequirement,
} from './pack-draft-edit';
import {
  type Pack,
  type PackRequirement,
  type PackVersion,
  addRequirement,
  approvePackVersion,
  cloneVersionToDraft,
  copyVersionItems,
  listRequirements,
  openPackDraft,
  packStudioWaiting,
  publishPackVersion,
} from './packs';

/**
 * An agency keeps its own copy of a country checklist (Owner, 6 Nov 2026: the agency owner or an
 * admin can update too). The shared starter and reviewed lists stay with the platform; an agency
 * copies one into a list of its own, changes it, and publishes it. The copy belongs to that agency
 * alone: only that agency's cases can pick it, it is never offered to another agency, and it is
 * shown to anyone else as an agency checklist. (A document request offers public lists only.)
 *
 * Every function takes an `AgencyChecklistScope` (a live check that the person is an active owner
 * or admin of one open agency), checks it first, and puts the scope's organization id in every
 * query, so a list of another agency is simply not found. Changes use the same draft steps the
 * platform studio does, so each one is audited. Nothing an agency does reaches the shared lists or
 * another agency's lists, and a published version is never edited: a change is a new draft.
 */

const PUBLISH_FAILED_WORDS = 'This list could not be published. Reload the page and try again.';

/** A year: the agency decides when its own list needs another look. */
const OWN_LIST_REVIEW_DAYS = 365;
const OWN_LIST_REVIEW_REASON = 'The agency reviews its own checklist when it changes it.';

/** The key of an agency's copy of a shared list: stable, so a second copy is refused. */
function ownKey(organizationId: string, sourceKey: string): string {
  return `agency.${organizationId}.${sourceKey}`;
}

/** A published shared list an agency may copy: reviewed public, or a starter list. */
export interface AgencyStartingList {
  readonly packVersionId: string;
  readonly packName: string;
  readonly jurisdiction: string | null;
  readonly purpose: string | null;
  readonly starter: boolean;
  readonly version: number;
  /** The id of the agency's own copy, when it already has one. */
  readonly ownCopyPackId: string | null;
}

/** The shared lists an agency may copy (newest published version of each), by name, optionally narrowed. */
export async function listAgencyStartingLists(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly search?: string } = {},
): Promise<Result<AgencyStartingList[], ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  const term = (input.search ?? '').replace(/[%_\\]/g, '').trim();
  const rows = await db
    .selectDistinctOn([schema.packVersions.packId], {
      packVersionId: schema.packVersions.id,
      packKey: schema.packs.key,
      packName: schema.packs.name,
      jurisdiction: schema.packs.jurisdiction,
      purpose: schema.packs.purpose,
      authoritative: schema.packs.authoritative,
      version: schema.packVersions.version,
    })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(
      and(
        eq(schema.packVersions.status, 'PUBLISHED'),
        isNull(schema.packs.ownerOrganizationId),
        term.length > 0 ? ilike(schema.packs.name, `%${term}%`) : undefined,
      ),
    )
    .orderBy(schema.packVersions.packId, desc(schema.packVersions.version));
  const copies = await db
    .select({ id: schema.packs.id, key: schema.packs.key })
    .from(schema.packs)
    .where(eq(schema.packs.ownerOrganizationId, scope.organizationId));
  const copyKeys = new Map(copies.map((c) => [c.key, c.id]));
  return ok(
    rows
      .filter((row) => row.authoritative || isStarterPackKey(row.packKey))
      .map((row) => ({
        packVersionId: row.packVersionId,
        packName: row.packName,
        jurisdiction: row.jurisdiction,
        purpose: row.purpose,
        starter: isStarterPackKey(row.packKey),
        version: row.version,
        ownCopyPackId: copyKeys.get(ownKey(scope.organizationId, row.packKey)) ?? null,
      }))
      .sort((a, b) => a.packName.localeCompare(b.packName, 'en')),
  );
}

/** One of the agency's own lists. */
export interface AgencyOwnList {
  readonly packId: string;
  readonly name: string;
  readonly jurisdiction: string | null;
  readonly purpose: string | null;
  readonly publishedVersion: number | null;
  readonly openDraftVersion: number | null;
}

export async function listAgencyOwnLists(
  db: Db,
  scope: AgencyChecklistScope,
): Promise<Result<AgencyOwnList[], ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  const packs = await db
    .select()
    .from(schema.packs)
    .where(eq(schema.packs.ownerOrganizationId, scope.organizationId));
  if (packs.length === 0) return ok([]);
  const versions = await db
    .select({
      packId: schema.packVersions.packId,
      version: schema.packVersions.version,
      status: schema.packVersions.status,
    })
    .from(schema.packVersions)
    .where(
      inArray(
        schema.packVersions.packId,
        packs.map((p) => p.id),
      ),
    );
  return ok(
    packs
      .map((pack): AgencyOwnList => {
        const own = versions.filter((v) => v.packId === pack.id);
        const newest = (status: string) =>
          own
            .filter((v) => v.status === status)
            .reduce<number | null>(
              (max, v) => (max === null || v.version > max ? v.version : max),
              null,
            );
        return {
          packId: pack.id,
          name: pack.name,
          jurisdiction: pack.jurisdiction,
          purpose: pack.purpose,
          publishedVersion: newest('PUBLISHED'),
          // A version waiting to be published (approved, not yet published) is still open work.
          openDraftVersion: Math.max(newest('DRAFT') ?? 0, newest('APPROVED') ?? 0) || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en')),
  );
}

/**
 * Copies a shared list into a list of the agency's own: a new pack owned by the agency and a draft
 * version holding every item of the shared one, as the agency's items. Nothing is published until
 * the agency publishes it. Refused when the agency already has a copy of that list.
 */
export async function makeAgencyCopy(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly fromPackVersionId: string },
): Promise<Result<{ readonly packId: string; readonly draftVersionId: string }, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  if (!isUuid(input.fromPackVersionId))
    return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  return db.transaction(async (tx) => {
    const source = first(
      await tx
        .select({ version: schema.packVersions, pack: schema.packs })
        .from(schema.packVersions)
        .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
        .where(eq(schema.packVersions.id, input.fromPackVersionId))
        .limit(1),
    );
    const shared =
      source !== undefined &&
      source.version.status === 'PUBLISHED' &&
      source.pack.ownerOrganizationId === null &&
      (source.pack.authoritative || isStarterPackKey(source.pack.key));
    if (!source || !shared)
      return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));

    const key = ownKey(scope.organizationId, source.pack.key);
    // The key is unique, so two copies made at the same moment cannot both succeed: the second gets
    // the same plain answer as a second press later.
    const inserted = first(
      await tx
        .insert(schema.packs)
        .values({
          key,
          name: source.pack.name,
          description: `Our copy of ${source.pack.name}. Not official.`,
          ownerOrganizationId: scope.organizationId,
          jurisdiction: source.pack.jurisdiction,
          route: source.pack.route,
          purpose: source.pack.purpose,
          nationalityApplicability: source.pack.nationalityApplicability,
          residenceApplicability: source.pack.residenceApplicability,
          authoritative: false,
        })
        .onConflictDoNothing({ target: schema.packs.key })
        .returning(),
    );
    if (!inserted)
      return err(keyedError('invalid', 'agency_checklists.your_agency_already_has_a_copy'));
    const pack = inserted as Pack;
    await appendAuditEvent(tx, {
      eventType: 'PACK_CREATED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack',
      resourceId: pack.id,
      metadata: {
        key: pack.key,
        organizationId: scope.organizationId,
        copiedFromPackVersionId: source.version.id,
      },
    });
    const opened = await openPackDraft(tx, scope, { packId: pack.id });
    if (!opened.ok) return opened;
    const draft = opened.value;
    // Once the agency owns the copy, no item of it is presented as the authority's.
    const items = await copyVersionItems(tx, {
      fromVersionId: source.version.id,
      toVersionId: draft.id,
      actorAccountId: scope.accountId,
      provenance: 'AGENCY_ADDED',
      // Who the list is for (application posts, travel window) is part of what was copied.
      withRouteConditions: true,
    });
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_CLONED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: draft.id,
      metadata: {
        fromPackVersionId: source.version.id,
        items,
        organizationId: scope.organizationId,
      },
    });
    return ok({ packId: pack.id, draftVersionId: draft.id });
  });
}

/** What the agency sees of one of its lists. */
export interface AgencyListDetail {
  readonly packId: string;
  readonly name: string;
  readonly jurisdiction: string | null;
  readonly purpose: string | null;
  /** The version being shown: the open draft, else one waiting to be published, else the published one. */
  readonly version: Pick<PackVersion, 'id' | 'version' | 'status'>;
  readonly hasPublished: boolean;
  readonly items: readonly PackRequirement[];
}

/** The agency's own list with the items of its open draft, or of its published version. */
export async function getAgencyListDetail(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly packId: string },
): Promise<Result<AgencyListDetail, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  if (!isUuid(input.packId))
    return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  const pack = first(
    await db
      .select()
      .from(schema.packs)
      .where(
        and(
          eq(schema.packs.id, input.packId),
          eq(schema.packs.ownerOrganizationId, scope.organizationId),
        ),
      )
      .limit(1),
  );
  if (!pack) return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  const versions = await db
    .select()
    .from(schema.packVersions)
    .where(eq(schema.packVersions.packId, pack.id))
    .orderBy(desc(schema.packVersions.version));
  const draft = versions.find((v) => v.status === 'DRAFT');
  const waiting = versions.find((v) => v.status === 'APPROVED');
  const published = versions.find((v) => v.status === 'PUBLISHED');
  const shown = draft ?? waiting ?? published;
  if (!shown) return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  return ok({
    packId: pack.id,
    name: pack.name,
    jurisdiction: pack.jurisdiction,
    purpose: pack.purpose,
    version: { id: shown.id, version: shown.version, status: shown.status },
    hasPublished: published !== undefined,
    items: await listRequirements(db, shown.id),
  });
}

/** The version, when it belongs to a list of this agency, else a refusal that reveals nothing more. */
async function ownVersion(
  db: Db,
  scope: AgencyChecklistScope,
  packVersionId: string,
): Promise<Result<PackVersion, ServiceError>> {
  if (!isUuid(packVersionId))
    return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  const row = first(
    await db
      .select({ version: schema.packVersions })
      .from(schema.packVersions)
      .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
      .where(
        and(
          eq(schema.packVersions.id, packVersionId),
          eq(schema.packs.ownerOrganizationId, scope.organizationId),
        ),
      )
      .limit(1),
  );
  return row
    ? ok(row.version as PackVersion)
    : err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
}

/** Starts an update of the agency's published list: a draft copy of it. */
export async function startAgencyListUpdate(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly packId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  if (!isUuid(input.packId))
    return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  const published = first(
    await db
      .select({ id: schema.packVersions.id })
      .from(schema.packVersions)
      .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
      .where(
        and(
          eq(schema.packVersions.packId, input.packId),
          eq(schema.packVersions.status, 'PUBLISHED'),
          eq(schema.packs.ownerOrganizationId, scope.organizationId),
        ),
      )
      .orderBy(desc(schema.packVersions.version))
      .limit(1),
  );
  if (!published) return err(keyedError('not_found', 'agency_checklists.checklist_not_found'));
  const waiting = first(
    await db
      .select({ id: schema.packVersions.id })
      .from(schema.packVersions)
      .where(
        and(
          eq(schema.packVersions.packId, input.packId),
          eq(schema.packVersions.status, 'APPROVED'),
        ),
      )
      .limit(1),
  );
  if (waiting) return err(keyedError('invalid', 'agency_checklists.a_change_is_waiting_to_be'));
  return cloneVersionToDraft(db, scope, { fromPackVersionId: published.id });
}

/** Changes one item of the agency's open draft. */
export async function updateAgencyItem(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly requirementId: string; readonly patch: DraftRequirementPatch },
): Promise<Result<PackRequirement, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  return updateDraftRequirement(db, scope, input);
}

/** Removes one item from the agency's open draft. */
export async function removeAgencyItem(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly requirementId: string },
): Promise<Result<{ readonly removed: true }, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  return removeDraftRequirement(db, scope, input);
}

/** Adds the agency's own item to its open draft: the wording, a document type and how necessary it is. */
export async function addAgencyItem(
  db: Db,
  scope: AgencyChecklistScope,
  input: {
    readonly packVersionId: string;
    readonly wording: string;
    readonly docType: string;
    readonly necessity: 'MANDATORY' | 'RECOMMENDED' | 'OPTIONAL';
    readonly appliesWhen?: string;
  },
): Promise<Result<PackRequirement, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  const owned = await ownVersion(db, scope, input.packVersionId);
  if (!owned.ok) return owned;
  const wording = input.wording.trim();
  const appliesWhen = input.appliesWhen?.trim() ?? '';
  if (wording === '') {
    return err(keyedError('invalid', 'agency_checklists.write_the_item_as_a_traveller'));
  }
  if (wording.length > MAX_WORDING_LENGTH || appliesWhen.length > MAX_AUDIENCE_LENGTH) {
    return err(keyedError('invalid', 'agency_checklists.the_wording_is_too_long_or'));
  }
  if (input.docType.trim() === '') {
    return err(keyedError('invalid', 'agency_checklists.a_document_item_needs_a_document'));
  }
  return addRequirement(db, {
    actorAccountId: scope.accountId,
    packVersionId: input.packVersionId,
    kind: 'DOCUMENT',
    docType: input.docType.trim(),
    citation: 'Our agency list',
    necessity: input.necessity,
    provenance: 'AGENCY_ADDED',
    notes: wording,
    ...(appliesWhen ? { interpretation: appliesWhen } : {}),
    publisher: 'Agency',
    sourceType: 'agency_own',
  });
}

/**
 * Approves and publishes the agency's open draft as the next version of its list. The two steps are
 * separate transactions in the studio, so a version left approved by a failure in between is
 * finished here, never stranded: publishing accepts an approved version too.
 */
export async function publishAgencyDraft(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  const owned = await ownVersion(db, scope, input.packVersionId);
  if (!owned.ok) return owned;
  if (owned.value.status !== 'DRAFT' && owned.value.status !== 'APPROVED') {
    return err(keyedError('invalid', 'agency_checklists.only_a_draft_can_be_published'));
  }
  if (owned.value.status === 'DRAFT') {
    if ((await listRequirements(db, input.packVersionId)).length === 0) {
      return err(keyedError('invalid', 'agency_checklists.add_at_least_one_item_before'));
    }
    const approved = await approvePackVersion(db, {
      actorAccountId: scope.accountId,
      packVersionId: input.packVersionId,
      nextReviewDate: new Date(Date.now() + OWN_LIST_REVIEW_DAYS * 24 * 60 * 60 * 1000),
      reviewIntervalReason: OWN_LIST_REVIEW_REASON,
    });
    if (!approved.ok)
      return err(serviceError(approved.error.code, plainPublishProblem(approved.error)));
  }
  const published = await publishPackVersion(db, {
    actorAccountId: scope.accountId,
    packVersionId: input.packVersionId,
  });
  return published.ok
    ? published
    : err(serviceError(published.error.code, plainPublishProblem(published.error)));
}

/** A service refusal in the words an agency reads: the rule problems are shown, the rest are not. */
function plainPublishProblem(error: ServiceError): string {
  return error.code === 'invalid' && /requirement|item/i.test(error.message)
    ? 'One of the items needs fixing before you can publish. Check the wording and document types.'
    : PUBLISH_FAILED_WORDS;
}

/**
 * Throws away the agency's open draft, so a new update can start. The published version is never
 * touched. When the draft is the only version the list has (a copy never published), the empty
 * list goes with it, so the agency can start the copy again instead of being left with a list that
 * has nothing to open.
 */
export async function discardAgencyDraft(
  db: Db,
  scope: AgencyChecklistScope,
  input: { readonly packVersionId: string },
): Promise<Result<{ readonly discarded: true }, ServiceError>> {
  const denied = agencyChecklistScopeProblem(scope);
  if (denied) return err(denied);
  const owned = await ownVersion(db, scope, input.packVersionId);
  if (!owned.ok) return owned;
  return db.transaction(async (tx) => {
    // Locked and read again here: a publish that finished a moment ago must never be deleted.
    const version = first(
      await tx
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, input.packVersionId))
        .limit(1)
        .for('update'),
    );
    if (!version || version.status !== 'DRAFT') {
      return err(keyedError('invalid', 'agency_checklists.only_a_draft_can_be_discarded'));
    }
    const all = await tx
      .select({ id: schema.packVersions.id })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.packId, version.packId));
    const onlyVersion = all.length === 1;
    if (onlyVersion) {
      await tx.delete(schema.packs).where(eq(schema.packs.id, version.packId));
    } else {
      await tx
        .delete(schema.packVersions)
        .where(
          and(
            eq(schema.packVersions.id, input.packVersionId),
            eq(schema.packVersions.status, 'DRAFT'),
          ),
        );
    }
    await appendAuditEvent(tx, {
      eventType: 'PACK_DRAFT_DISCARDED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: input.packVersionId,
      metadata: {
        organizationId: scope.organizationId,
        packId: version.packId,
        listRemoved: onlyVersion,
      },
    });
    return ok({ discarded: true as const });
  });
}
