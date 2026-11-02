'use server';

import {
  type AgencyCollectionScope,
  type Db,
  type DraftEdit,
  agencyCollectionPrincipal,
  chooseCollectionPack,
  createCollectionLink,
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  getCollectionRequest,
  issueCollectionRequest,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { resolveBaseUrl } from '../../../../../lib/base-url';
import { caseCountry } from '../../../../../lib/case-choices';
import { triggerNotificationWorker } from '../../../../../lib/jobs';
import { createKeyManagementPort } from '../../../../../lib/providers';
import { sendEmailNow } from '../../../../../lib/send-now';
import { withSession } from '../../../../../lib/session';
import { collectionPackTerms, purposeByLabel } from './terms';

/**
 * Document Requests (UMPE P6): every action re-checks, live, that the person is an owner or admin
 * of this agency and that the switch is on (`agencyCollectionPrincipal`), then hands the services
 * that scope. A refused or missing request gets the same answer.
 */

export interface CollectionActionState {
  readonly ok: boolean;
  readonly message: string;
  readonly field?: string;
  /** A private link, shown once right after it is made. */
  readonly linkUrl?: string;
}

/** A result inside the session, before it is turned into what the screen sees. */
type Inner = CollectionActionState & { readonly id?: string };

const NOT_FOUND: CollectionActionState = {
  ok: false,
  message: 'This request is not available. Reload the page and try again.',
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function linkUrl(rawToken: string): string {
  return `${resolveBaseUrl()}/collect/open?token=${encodeURIComponent(rawToken)}`;
}

function pathFor(organizationId: string, requestId?: string): string {
  const base = `/app/agency/${organizationId}/collection`;
  return requestId ? `${base}/${requestId}` : base;
}

async function withScope<T>(
  organizationId: string,
  fallback: T,
  work: (db: Db, scope: AgencyCollectionScope) => Promise<T>,
): Promise<T> {
  return withSession(async ({ db, accountId }) => {
    const scope = await agencyCollectionPrincipal(db, accountId, organizationId);
    if (!scope.ok) return fallback;
    return work(db, scope.value);
  });
}

/** Start a request; the checklist is proposed from the official pack that fits, if one does. */
export async function createRequestAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const destination = text(formData, 'destination');
  if (!caseCountry(destination)) {
    return { ok: false, message: 'Choose a destination.', field: 'destination' };
  }
  const purposeLabel = text(formData, 'purpose');
  const purpose = purposeLabel.length > 0 ? purposeByLabel(purposeLabel) : null;
  if (purposeLabel.length > 0 && !purpose) {
    return { ok: false, message: 'Choose a purpose, or Not Sure Yet.', field: 'purpose' };
  }
  const due = text(formData, 'dueAt');
  const dueAt = due.length > 0 ? new Date(`${due}T23:59:59Z`) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return { ok: false, message: 'Enter a valid due date.', field: 'dueAt' };
  }
  const optional = (name: string) => {
    const value = text(formData, name);
    return value.length > 0 ? value : null;
  };
  const request = {
    destination,
    purpose: purpose?.label ?? null,
    nationality: optional('nationality'),
    residence: optional('residence'),
  };
  const created = await withScope<Inner>(organizationId, NOT_FOUND, async (db, scope) => {
    const result = await createCollectionRequest(db, scope, {
      ...request,
      route: optional('route'),
      travelFrom: optional('travelFrom'),
      travelTo: optional('travelTo'),
      dueAt,
      applicationPlace: optional('applicationPlace'),
      recipientNameHint: optional('recipientName'),
      recipientEmailHint: optional('recipientEmail'),
      packTerms: collectionPackTerms(request),
    });
    if (!result.ok) return { ok: false, message: result.error.message };
    return { ok: true, message: '', id: result.value.id };
  });
  if (!created.ok || !created.id) return { ok: false, message: created.message };
  revalidatePath(pathFor(organizationId));
  redirect(pathFor(organizationId, created.id));
}

function draftEdit(formData: FormData): DraftEdit | null {
  const type = text(formData, 'edit');
  const itemId = text(formData, 'itemId');
  switch (type) {
    case 'add':
      return {
        type: 'add',
        label: text(formData, 'label'),
        necessity: text(formData, 'necessity'),
        note: text(formData, 'note'),
      };
    case 'remove':
      return { type: 'remove', itemId };
    case 'up':
    case 'down':
      return { type: 'move', itemId, direction: type };
    case 'note':
      return { type: 'note', itemId, note: text(formData, 'note') };
    case 'necessity':
      return { type: 'necessity', itemId, necessity: text(formData, 'necessity') };
    default:
      return null;
  }
}

/** One change to the working checklist. */
export async function editDraftAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const requestId = text(formData, 'requestId');
  const edit = draftEdit(formData);
  if (!edit) return NOT_FOUND;
  const result = await withScope(organizationId, NOT_FOUND, async (db, scope) => {
    const edited = await editCollectionDraft(db, scope, requestId, edit);
    if (!edited.ok) {
      return {
        ok: false,
        message: edited.error.message,
        ...(edit.type === 'add' ? { field: 'label' } : {}),
      };
    }
    return { ok: true, message: 'Checklist updated.' };
  });
  if (result.ok) revalidatePath(pathFor(organizationId, requestId));
  return result;
}

/** Follow one of the official checklists that fit, or none (the agency's own list). */
export async function choosePackAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const requestId = text(formData, 'requestId');
  const chosen = text(formData, 'packVersionId');
  const result = await withScope(organizationId, NOT_FOUND, async (db, scope) => {
    const detail = await getCollectionRequest(db, scope, requestId);
    if (!detail.ok) return NOT_FOUND;
    const changed = await chooseCollectionPack(db, scope, requestId, {
      packVersionId: chosen.length > 0 ? chosen : null,
      packTerms: collectionPackTerms(detail.value),
    });
    if (!changed.ok) return { ok: false, message: changed.error.message };
    return {
      ok: true,
      message: chosen.length > 0 ? 'Official checklist applied.' : 'Now your agency checklist.',
    };
  });
  if (result.ok) revalidatePath(pathFor(organizationId, requestId));
  return result;
}

/** Freeze the checklist into the next revision and make its private link. */
export async function issueRequestAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const requestId = text(formData, 'requestId');
  const result = await withScope(organizationId, NOT_FOUND, async (db, scope) => {
    const issued = await issueCollectionRequest(db, scope, requestId);
    if (!issued.ok) return { ok: false, message: issued.error.message };
    return {
      ok: true,
      message: `Revision ${issued.value.revisionNo} issued. Copy the link now: it is shown only once.`,
      linkUrl: linkUrl(issued.value.link.rawToken),
    };
  });
  if (result.ok) revalidatePath(pathFor(organizationId, requestId));
  return result;
}

/** Another private link for the current revision, to copy or share. */
export async function newLinkAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const requestId = text(formData, 'requestId');
  const result = await withScope(organizationId, NOT_FOUND, async (db, scope) => {
    const created = await createCollectionLink(db, scope, requestId);
    if (!created.ok) return { ok: false, message: created.error.message };
    return {
      ok: true,
      message: 'New link ready. Copy it now: it is shown only once.',
      linkUrl: linkUrl(created.value.link.rawToken),
    };
  });
  if (result.ok) revalidatePath(pathFor(organizationId, requestId));
  return result;
}

const EMAIL_WORDS = {
  sent: 'Email accepted for delivery. That does not prove it reached the inbox.',
  pending: 'Email queued. It will be retried if the first try did not go through.',
  failed: 'The email could not be sent. Copy a link and share it yourself instead.',
} as const;

/** Send a new private link by email through the outbox. */
export async function emailLinkAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const requestId = text(formData, 'requestId');
  const address = text(formData, 'email');
  if (address.length === 0) {
    return { ok: false, message: 'Enter an email address.', field: 'email' };
  }
  const queued = await withScope<Inner>(organizationId, NOT_FOUND, async (db, scope) => {
    const encryption = createKeyManagementPort();
    if (!encryption) {
      return {
        ok: false,
        message: 'Email is not available here. Copy a link and share it yourself instead.',
      };
    }
    const created = await createCollectionLink(db, scope, requestId, {
      email: { address, encryption },
    });
    if (!created.ok) return { ok: false, message: created.error.message, field: 'email' };
    return { ok: true, message: '', id: created.value.link.id };
  });
  if (!queued.ok || !queued.id) {
    return { ok: false, message: queued.message, ...(queued.field ? { field: queued.field } : {}) };
  }
  const outcome = await sendEmailNow(queued.id);
  after(() => triggerNotificationWorker().then(() => undefined));
  revalidatePath(pathFor(organizationId, requestId));
  return { ok: outcome !== 'failed', message: EMAIL_WORDS[outcome] };
}

/** Revoke (withdraw) or close a request: every link stops working. */
export async function endRequestAction(
  _prev: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const organizationId = text(formData, 'organizationId');
  const requestId = text(formData, 'requestId');
  const outcome = text(formData, 'outcome') === 'CLOSED' ? 'CLOSED' : 'REVOKED';
  const result = await withScope(organizationId, NOT_FOUND, async (db, scope) => {
    const ended = await endCollectionRequest(db, scope, requestId, outcome);
    if (!ended.ok) return { ok: false, message: ended.error.message };
    return {
      ok: true,
      message:
        outcome === 'CLOSED'
          ? 'Request closed. Its links no longer work.'
          : 'Request revoked. Its links no longer work.',
    };
  });
  if (result.ok) revalidatePath(pathFor(organizationId, requestId));
  return result;
}
