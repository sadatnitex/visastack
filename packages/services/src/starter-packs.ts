import {
  type Result,
  STARTER_KEY_PREFIX,
  STARTER_NOTICE,
  type StarterPackDefinition,
  type StarterRequirement,
  err,
  isStarterPackKey,
  ok,
  requirementNecessity,
  starterContentHash,
} from '@visastack/core';
import { eq, inArray, like } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { newestPublishedVersion } from './pack-draft-edit';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  listRequirements,
  packStudioWaiting,
  publishPackVersion,
} from './packs';

/**
 * Loading the starter country checklists into Pack Studio (Owner, 6 Nov 2026). A starter checklist
 * is a public pack that is not marked authoritative: it is the agency's own reading of country
 * files, labelled as such, never official. Each one is made through the same studio steps an admin
 * would take by hand (create the pack, open a draft, add the items, approve, publish), so every
 * step is audited and a published version is immutable like any other.
 *
 * The load is repeatable: a checklist whose content has not changed is left alone, and one that
 * changed becomes the next version. It never touches a pack that is not a starter pack.
 */

/** How long a starter checklist is trusted before it is shown as due for review. */
const STARTER_REVIEW_DAYS = 120;
const STARTER_REVIEW_REASON =
  'Starter list from agency files. An admin updates it when the agency changes its list.';

export type StarterImportStatus = 'new' | 'unchanged' | 'changed';

export interface StarterImportPreviewRow {
  readonly key: string;
  readonly name: string;
  readonly status: StarterImportStatus;
  readonly requirementCount: number;
  /** For a changed list: lines in the new list that are not in the current one, and the reverse. */
  readonly added: number;
  readonly removed: number;
  readonly currentVersion: number | null;
}

/** The current published content of a pack, in the shape the fingerprint reads. */
async function currentStarterContent(
  db: Db,
  packId: string,
): Promise<{ readonly version: number; readonly lines: StarterRequirement[] } | null> {
  const version = await newestPublishedVersion(db, packId);
  if (!version) return null;
  const rows = await listRequirements(db, version.id);
  return {
    version: version.version,
    lines: rows.map((row) => ({
      text: row.notes ?? '',
      docType: row.docType ?? '',
      necessity: requirementNecessity(row) as StarterRequirement['necessity'],
      appliesWhen: row.interpretation ?? '',
      reference: row.sourceTitle ?? '',
    })),
  };
}

/** What loading these lists would do, for each one, without changing anything. */
export async function previewStarterImport(
  db: Db,
  definitions: readonly StarterPackDefinition[],
): Promise<StarterImportPreviewRow[]> {
  const keys = definitions.map((d) => d.key);
  const packs =
    keys.length === 0
      ? []
      : await db.select().from(schema.packs).where(inArray(schema.packs.key, keys));
  const byKey = new Map(packs.map((p) => [p.key, p]));
  const out: StarterImportPreviewRow[] = [];
  for (const definition of definitions) {
    const pack = byKey.get(definition.key);
    const current = pack ? await currentStarterContent(db, pack.id) : null;
    if (!current) {
      out.push({
        key: definition.key,
        name: definition.name,
        status: 'new',
        requirementCount: definition.requirements.length,
        added: definition.requirements.length,
        removed: 0,
        currentVersion: null,
      });
      continue;
    }
    const same = starterContentHash(current.lines) === definition.contentHash;
    const now = new Set(definition.requirements.map((r) => r.text));
    const before = new Set(current.lines.map((r) => r.text));
    out.push({
      key: definition.key,
      name: definition.name,
      status: same ? 'unchanged' : 'changed',
      requirementCount: definition.requirements.length,
      added: same ? 0 : [...now].filter((text) => !before.has(text)).length,
      removed: same ? 0 : [...before].filter((text) => !now.has(text)).length,
      currentVersion: current.version,
    });
  }
  return out;
}

/**
 * The starter checklists as they are now (the newest published version of each), in key order, in
 * the same shape the sheet is read into, so an admin can export them, edit the sheet and load it
 * back. A list the sheet shape cannot hold (no purpose in its key) is left out.
 */
export async function currentStarterPacks(db: Db): Promise<StarterPackDefinition[]> {
  const packs = await db
    .select()
    .from(schema.packs)
    .where(like(schema.packs.key, `${STARTER_KEY_PREFIX}%`));
  const out: StarterPackDefinition[] = [];
  for (const pack of packs.sort((a, b) => a.key.localeCompare(b.key))) {
    const purpose = pack.key.split('.')[2];
    if (purpose !== 'tourist' && purpose !== 'business' && purpose !== 'medical') continue;
    if (pack.authoritative || pack.ownerOrganizationId !== null) continue;
    const current = await currentStarterContent(db, pack.id);
    if (!current) continue;
    out.push({
      key: pack.key,
      name: pack.name,
      description: pack.description ?? STARTER_NOTICE,
      jurisdiction: pack.jurisdiction ?? '',
      purpose: pack.purpose ?? '',
      starterPurpose: purpose,
      requirements: current.lines,
      contentHash: starterContentHash(current.lines),
    });
  }
  return out;
}

export interface StarterApplyResult {
  readonly key: string;
  readonly outcome: 'created' | 'updated' | 'unchanged';
  readonly version: number;
}

/**
 * Loads one starter checklist: creates the pack when it is new, or adds the next version when its
 * content changed, then approves and publishes it. A pack that exists but is not a starter pack
 * (official, or an agency's own) is refused untouched.
 */
export async function applyStarterPack(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: { readonly definition: StarterPackDefinition },
): Promise<Result<StarterApplyResult, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PACK_MANAGE');
  if (denied) return err(denied);
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  const { definition } = input;
  const actorAccountId = staff.accountId;
  if (!isStarterPackKey(definition.key) || definition.requirements.length === 0) {
    return err(serviceError('invalid', 'that is not a starter checklist'));
  }

  let pack = first(
    await db.select().from(schema.packs).where(eq(schema.packs.key, definition.key)).limit(1),
  );
  let created = false;
  if (pack) {
    if (pack.authoritative || pack.ownerOrganizationId !== null) {
      return err(
        serviceError('invalid', 'a checklist with this key exists and is not a starter list'),
      );
    }
    const current = await currentStarterContent(db, pack.id);
    if (current && starterContentHash(current.lines) === definition.contentHash) {
      return ok({ key: definition.key, outcome: 'unchanged', version: current.version });
    }
  } else {
    const made = await createPack(db, {
      actorAccountId,
      key: definition.key,
      name: definition.name,
      description: definition.description || STARTER_NOTICE,
      jurisdiction: definition.jurisdiction,
      purpose: definition.purpose,
      authoritative: false,
    });
    if (!made.ok) return made;
    pack = made.value;
    created = true;
  }

  const draft = await addPackVersion(db, { actorAccountId, packId: pack.id });
  if (!draft.ok) return draft;
  for (const line of definition.requirements) {
    const added = await addRequirement(db, {
      actorAccountId,
      packVersionId: draft.value.id,
      kind: 'DOCUMENT',
      docType: line.docType,
      citation: `Starter list: ${line.reference}`,
      necessity: line.necessity,
      provenance: 'AGENCY_ADDED',
      notes: line.text,
      ...(line.appliesWhen ? { interpretation: line.appliesWhen } : {}),
      sourceTitle: line.reference,
      publisher: 'Agency starter list',
      sourceType: 'agency_sheet',
    });
    if (!added.ok)
      return err(serviceError(added.error.code, `${definition.key}: ${added.error.message}`));
  }
  const reviewBy = new Date(Date.now() + STARTER_REVIEW_DAYS * 24 * 60 * 60 * 1000);
  const approved = await approvePackVersion(db, {
    actorAccountId,
    packVersionId: draft.value.id,
    nextReviewDate: reviewBy,
    reviewIntervalReason: STARTER_REVIEW_REASON,
  });
  if (!approved.ok) return approved;
  const published = await publishPackVersion(db, {
    actorAccountId,
    packVersionId: draft.value.id,
  });
  if (!published.ok) return published;
  return ok({
    key: definition.key,
    outcome: created ? 'created' : 'updated',
    version: published.value.version,
  });
}
