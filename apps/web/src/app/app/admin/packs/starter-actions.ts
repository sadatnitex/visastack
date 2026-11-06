'use server';

import {
  STARTER_SEED_ROWS,
  type StarterPackDefinition,
  type StarterSheetRow,
  buildStarterPacks,
  readStarterSheet,
} from '@visastack/core';
import {
  type StarterImportPreviewRow,
  applyStarterPack,
  cloneVersionToDraft,
  previewStarterImport,
  removeDraftRequirement,
  updateDraftRequirement,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { bootstrapAdminEmails, hasPlatformPermission, staffPrincipal } from '../../../../lib/admin';
import { parseDocumentTypeInput } from '../../../../lib/catalogue-input';
import { withSession } from '../../../../lib/session';
import type { ActionState } from './actions';

/**
 * Starter country checklists in Pack Studio (Owner, 6 Nov 2026): load the supplied lists or a sheet
 * the admin uploads, and update a published checklist system-wide by copying it to a draft. Every
 * action needs the same Pack Studio permission as the rest of the studio.
 */

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

/** A fresh Pack Studio staff scope for this request, or null (the same check as the rule detail forms). */
async function packScope(
  db: Parameters<typeof staffPrincipal>[0],
  accountId: string,
  email: string,
) {
  const staff = await staffPrincipal(
    db,
    { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
    'PACK_MANAGE',
  );
  return staff.ok ? staff.value : null;
}
/** A sheet this large is far past any real list (the supplied one is about 90 KB). */
const MAX_SHEET_CHARACTERS = 600_000;
const MAX_SHEET_LINES = 5_000;

export interface StarterPreviewState {
  readonly ok: boolean;
  readonly message: string;
  readonly rows: readonly StarterImportPreviewRow[];
  /** Lines of the sheet that could not be placed, with the plain reason. */
  readonly skipped: readonly string[];
}

export const NO_PREVIEW: StarterPreviewState = { ok: false, message: '', rows: [], skipped: [] };

type Source = { readonly rows: readonly StarterSheetRow[] } | { readonly problem: string };

/** The lines to load: the supplied ones, or the sheet the admin pasted or chose. */
function sourceFrom(formData: FormData): Source {
  if (String(formData.get('source') ?? 'supplied') !== 'sheet') return { rows: STARTER_SEED_ROWS };
  const csv = String(formData.get('csv') ?? '');
  if (csv.trim() === '') return { problem: 'Choose a sheet file first.' };
  if (csv.length > MAX_SHEET_CHARACTERS) return { problem: 'That sheet is too large.' };
  const read = readStarterSheet(csv);
  if (!read.ok) return { problem: read.problem };
  if (read.rows.length > MAX_SHEET_LINES) return { problem: 'That sheet has too many lines.' };
  return { rows: read.rows };
}

function definitionsFrom(source: Source) {
  if ('problem' in source) return source;
  return { built: buildStarterPacks(source.rows) };
}

/** What loading would do for each list, without changing anything. */
export async function previewStarterAction(
  _prev: StarterPreviewState,
  formData: FormData,
): Promise<StarterPreviewState> {
  const parsed = definitionsFrom(sourceFrom(formData));
  if ('problem' in parsed) return { ...NO_PREVIEW, message: parsed.problem };
  const { built } = parsed;
  return withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) {
      return { ...NO_PREVIEW, message: DENIED.message };
    }
    const rows = await previewStarterImport(db, built.packs);
    return {
      ok: true,
      message:
        rows.length === 0
          ? 'The sheet holds no lists.'
          : `${rows.length} lists found. ${rows.filter((r) => r.status !== 'unchanged').length} to load.`,
      rows,
      skipped: built.skipped.map((s) => `${s.row.country}: ${s.reason}`).slice(0, 50),
    } satisfies StarterPreviewState;
  });
}

/** Loads one list (new, or the next version of a changed one). The page calls this once per list. */
export async function loadStarterListAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const key = String(formData.get('key') ?? '').trim();
  const parsed = definitionsFrom(sourceFrom(formData));
  if ('problem' in parsed) return { ok: false, message: parsed.problem };
  const definition: StarterPackDefinition | undefined = parsed.built.packs.find(
    (pack) => pack.key === key,
  );
  if (!definition) return { ok: false, message: 'That list is not in the sheet.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const done = await applyStarterPack(db, staff, { definition });
    if (!done.ok) return { ok: false, message: done.error.message } satisfies ActionState;
    const words =
      done.value.outcome === 'created'
        ? 'Loaded'
        : done.value.outcome === 'updated'
          ? 'Updated'
          : 'Already up to date';
    return { ok: true, message: `${words}: version ${done.value.version}.` } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin/packs');
  return result;
}

/** Starts an update of a published checklist: a draft that is a copy of it. */
export async function startPackUpdateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const draft = await cloneVersionToDraft(db, staff, { fromPackVersionId: packVersionId });
    if (!draft.ok) return { ok: false, message: draft.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Draft version ${draft.value.version} started. Change its items, then approve and publish it.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

const NECESSITIES = ['MANDATORY', 'RECOMMENDED', 'OPTIONAL'] as const;

/** Changes one item of a draft: document type, how necessary, the wording and who it is for. */
export async function updateDraftItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const requirementId = String(formData.get('requirementId') ?? '').trim();
  const docTypeRaw = String(formData.get('docType') ?? '').trim();
  const necessityRaw = String(formData.get('necessity') ?? '').trim();
  const necessity = NECESSITIES.find((n) => n === necessityRaw);
  let docType: string | undefined;
  if (docTypeRaw !== '') {
    const named = parseDocumentTypeInput(docTypeRaw);
    if (!named.ok) return { ok: false, message: named.message };
    docType = named.key;
  }
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const changed = await updateDraftRequirement(db, staff, {
      requirementId,
      patch: {
        ...(docType ? { docType } : {}),
        ...(necessity ? { necessity } : {}),
        notes: String(formData.get('wording') ?? ''),
        interpretation: String(formData.get('appliesWhen') ?? ''),
      },
    });
    if (!changed.ok) return { ok: false, message: changed.error.message } satisfies ActionState;
    return { ok: true, message: 'Item saved.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Removes one item from a draft. */
export async function removeDraftItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const requirementId = String(formData.get('requirementId') ?? '').trim();
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const removed = await removeDraftRequirement(db, staff, { requirementId });
    if (!removed.ok) return { ok: false, message: removed.error.message } satisfies ActionState;
    return { ok: true, message: 'Item removed.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}
