'use server';

import { randomUUID } from 'node:crypto';
import { BasicSafetyScanner } from '@visastack/adapters';
import type { ApplicantId } from '@visastack/core';
import type { Actor, Db } from '@visastack/services';
import {
  addDocumentVersion,
  editFact,
  getApplicant,
  previewDocument,
  processIntake,
  registerDocument,
  registerFieldDefinition,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { profileField } from '../../../../lib/profile-fields';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

/** Guard: the applicant must be owned by the signed-in account. */
async function assertOwned(db: Db, accountId: string, applicantId: string): Promise<boolean> {
  const applicant = await getApplicant(db, applicantId);
  return applicant?.ownerAccountId === accountId;
}

/** Save a Master Profile fact (append-only immutable version). */
export async function saveFactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const fieldKey = String(formData.get('fieldKey') ?? '');
  const value = String(formData.get('value') ?? '').trim();
  const def = profileField(fieldKey);
  if (!def) return { ok: false, message: 'Unknown field.' };
  if (value.length === 0) return { ok: false, message: 'Enter a value first.' };

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }
    await registerFieldDefinition(db, {
      key: def.key,
      dataType: def.type === 'date' ? 'date' : 'string',
      sensitivity: def.sensitivity,
    });
    const edit = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: def.key,
      value,
    });
    if (!edit.ok) return { ok: false, message: edit.error.message } satisfies ActionState;
    return { ok: true, message: `${def.label} saved.` } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`);
  return result;
}

/** Upload a document: store bytes → register → version → run intake pipeline. */
export async function uploadDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a file to upload.' };
  }
  if (file.size > 15 * 1024 * 1024) {
    return { ok: false, message: 'File exceeds the 15 MB limit.' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || 'application/octet-stream';
  const originalName = file.name || 'document';

  const result = await withSession(async ({ db, accountId }) => {
    if (!(await assertOwned(db, accountId, applicantId))) {
      return { ok: false, message: 'Not authorized.' } satisfies ActionState;
    }

    const registered = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName,
      source: 'UPLOAD',
    });
    if (!registered.ok) {
      return { ok: false, message: registered.error.message } satisfies ActionState;
    }

    const objectKey = `${applicantId}/${randomUUID()}`;
    const storage = createStorage(db);
    await storage.putObject({ objectKey, bucket: 'QUARANTINE', contentType, bytes });

    const versioned = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: registered.value.id,
      bucket: 'QUARANTINE',
      objectKey,
      sizeBytes: bytes.byteLength,
    });
    if (!versioned.ok) {
      return { ok: false, message: versioned.error.message } satisfies ActionState;
    }

    const scanner = new BasicSafetyScanner({ blobStore: storage });
    const intake = await processIntake(db, scanner, {
      documentVersionId: versioned.value.version.id,
    });
    if (!intake.ok) {
      return { ok: false, message: intake.error.message } satisfies ActionState;
    }
    const clean = intake.value.safetyStatus === 'CLEAN';
    return {
      ok: true,
      message: clean
        ? `${originalName} uploaded and passed the safety scan.`
        : `${originalName} uploaded but was quarantined by the safety scan.`,
    } satisfies ActionState;
  });

  if (result.ok) revalidatePath(`/app/applicant/${applicantId}`);
  return result;
}

/** Issue a short-lived signed preview URL and redirect the browser to it. */
export async function previewDocumentAction(formData: FormData): Promise<void> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const documentId = String(formData.get('documentId') ?? '');

  const url = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, applicantId);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const actor: Actor = {
      kind: 'applicant_owner',
      applicantId: applicantId as ApplicantId,
    };
    const storage = createStorage(db);
    const ref = await previewDocument(db, storage, {
      actor,
      documentId,
      purpose: 'owner_preview',
    });
    return ref.ok ? ref.value.url : null;
  });

  if (url) redirect(url);
}
