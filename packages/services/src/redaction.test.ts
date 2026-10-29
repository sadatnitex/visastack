import { randomBytes, randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal } from './access/principal';
import { EACH_GRANT, requireAccess } from './access/require-access';
import { verifyStepUp } from './access/step-up-proof';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { enqueueErasureJob } from './erasure';
import type { KeyManagementPort } from './ports';
import type {
  PositionedText,
  SafeCopyFailureReason,
  SafeCopyRendererPort,
} from './preview-rendering';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { RATE_LIMITS } from './rate-limit';
import {
  type RedactionDeps,
  SAFE_COPY_TOO_LARGE_MESSAGE,
  clearRedactionMasks,
  getSafeCopyState,
  listRedactionStates,
  masksMismatch,
  openRedactionEditor,
  produceSafeCopy,
  renderRedactionPage,
  saveRedactionMasks,
  suggestRedactions,
} from './redaction';
import { issueStepUpAssurance } from './step-up';

const STEP_UP_SECRET = 'redaction-step-up-secret';
/** A distinctive coordinate: it must never reach the audit trail. */
const BOX = { x: 0.313131, y: 0.414141, w: 0.2, h: 0.05 };

interface FakeOptions {
  readonly contentType?: string;
  readonly pageCount?: number;
  readonly text?: readonly (readonly PositionedText[])[];
  readonly fail?: SafeCopyFailureReason;
  readonly bytes?: Uint8Array;
}

/** Records what reached storage and the renderer, so a refusal can be shown to draw nothing. */
function fakeDeps(options: FakeOptions = {}): RedactionDeps & {
  readonly calls: string[];
  readonly masksDrawn: (readonly (readonly unknown[])[])[];
} {
  const calls: string[] = [];
  const masksDrawn: (readonly (readonly unknown[])[])[] = [];
  const pageCount = options.pageCount ?? 2;
  const failure = options.fail
    ? { ok: false as const, reason: options.fail, detail: 'test failure' }
    : undefined;
  const renderer: SafeCopyRendererPort = {
    name: 'fake',
    version: '0',
    async pageCount() {
      calls.push('pageCount');
      return failure ?? { ok: true, pageCount };
    },
    async renderPage(_source, page) {
      calls.push(`renderPage:${page}`);
      return (
        failure ?? {
          ok: true,
          contentType: 'image/jpeg',
          bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
          width: 1240,
          height: 1754,
        }
      );
    },
    async textPositions() {
      calls.push('textPositions');
      return { ok: true, pages: options.text ?? [] };
    },
    async renderSafeCopy(_source, masks) {
      calls.push('renderSafeCopy');
      masksDrawn.push(masks);
      if (failure) return failure;
      if (masks.length !== pageCount) return masksMismatch();
      return {
        ok: true,
        contentType: 'application/pdf',
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        pageCount,
      };
    },
  };
  return {
    storage: {
      async getObject() {
        calls.push('getObject');
        return {
          contentType: options.contentType ?? 'application/pdf',
          bytes: options.bytes ?? new Uint8Array([0x25, 0x50, 0x44, 0x46]),
        };
      },
    },
    renderer,
    calls,
    masksDrawn,
  };
}

/** A key service whose data key unwraps to itself, so protected values round-trip. */
function testKeyManagement(): KeyManagementPort {
  const key = randomBytes(32);
  return {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: key };
    },
    async unwrapDataKey() {
      return key;
    },
  };
}

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

describe('safe copies (S23, ADR 0022)', () => {
  let db: Db;
  let ownerId: string;
  let applicantId: string;
  let documentId: string;
  let versionId: string;

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error(`provision ${email}`);
    return result.value.id;
  }

  async function traveller(owner: string): Promise<string> {
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, { actorAccountId: owner, accountId: owner, type, granted: true });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: owner,
      ownerAccountId: owner,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    return applicant.value.id;
  }

  async function addDocument(
    owner: string,
    applicant: string,
    docType: string,
    originalName = 'synthetic.pdf',
    sizeBytes = 2048,
  ): Promise<{ documentId: string; versionId: string }> {
    const doc = await registerDocument(db, {
      actorAccountId: owner,
      applicantId: applicant,
      originalName,
      docType,
    });
    if (!isOk(doc)) throw new Error('document');
    const version = await addVersion(owner, doc.value.id, sizeBytes);
    return { documentId: doc.value.id, versionId: version };
  }

  async function addVersion(
    owner: string,
    document: string,
    sizeBytes = 2048,
    safetyStatus: 'CLEAN' | 'PENDING' = 'CLEAN',
  ): Promise<string> {
    const version = await addDocumentVersion(db, {
      actorAccountId: owner,
      documentId: document,
      bucket: 'CLEAN',
      objectKey: `redaction-${randomUUID()}`,
      sizeBytes,
      safetyStatus,
      processingStatus: safetyStatus === 'CLEAN' ? 'APPROVED' : 'SCANNING',
    });
    if (!isOk(version)) throw new Error('version');
    return version.value.version.id;
  }

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    ownerId = await account('owner@example.com');
    applicantId = await traveller(ownerId);
    ({ documentId, versionId } = await addDocument(ownerId, applicantId, 'PASSPORT'));
  });

  async function gate<A extends 'PREVIEW' | 'MANAGE' | 'DOWNLOAD_REDACTED' | 'VIEW_METADATA'>(
    accountId: string,
    action: A,
    document: string = documentId,
  ) {
    // Passports are restricted documents: every preview or download carries a genuine fresh
    // identity check here, exactly as the web routes obtain one (tested on its own below).
    const binding = { accountId, action, resourceId: document };
    const stepUp = verifyStepUp(
      STEP_UP_SECRET,
      issueStepUpAssurance(STEP_UP_SECRET, binding),
      binding,
    );
    const result = await requireAccess(
      db,
      accountPrincipal(accountId),
      action,
      { documentId: document },
      { purpose: EACH_GRANT, ...(stepUp ? { stepUp } : {}) },
    );
    if (!isOk(result)) throw new Error(`gate ${action}: ${result.error.code}`);
    return result.value;
  }

  async function applicantProof(accountId: string, applicant: string = applicantId) {
    const result = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: applicant },
      { purpose: 'self' },
    );
    if (!isOk(result)) throw new Error('applicant gate');
    return result.value;
  }

  async function saveBoxes(pages: readonly (readonly unknown[])[], deps = fakeDeps()) {
    return saveRedactionMasks(await gate(ownerId, 'MANAGE'), deps, {
      versionId,
      pages: pages.map((boxes) => ({ boxes, acceptedSuggestions: 0 })),
      nothingToHide: false,
    });
  }

  async function stateOf(version: string = versionId) {
    const listed = await listRedactionStates(await applicantProof(ownerId), [version]);
    if (!isOk(listed)) throw new Error('states');
    return listed.value.get(version);
  }

  async function audits(eventType: string) {
    return db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.resourceId, documentId),
          eq(schema.auditEvents.eventType, eventType),
        ),
      );
  }

  /** A person with a direct grant on this traveller, for the actions given. */
  async function recipientWith(actions: readonly string[]): Promise<string> {
    const recipient = await account(`recipient-${randomUUID()}@example.com`);
    await db.insert(schema.grants).values({
      applicantId,
      recipientAccountId: recipient,
      recipientOrganizationId: null,
      status: 'ACTIVE',
      actions: actions as never,
      purpose: 'visa-application',
      acceptedAt: new Date(Date.now() - 60_000),
      startAt: new Date(Date.now() - 60_000),
    });
    return recipient;
  }

  describe('the owner prepares and downloads a safe copy', () => {
    it('saves boxes for every page, then draws exactly them, auditing counts only', async () => {
      expect(await stateOf()).toBe('NOT_PREPARED');
      const deps = fakeDeps();
      const editor = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), deps);
      if (!isOk(editor)) throw new Error(editor.error.message);
      expect(editor.value).toMatchObject({
        versionId,
        pageCount: 2,
        state: 'NOT_PREPARED',
        savedPages: null,
        canSave: true,
      });
      const page = await renderRedactionPage(await gate(ownerId, 'PREVIEW'), deps, {
        versionId,
        page: 2,
      });
      expect(isOk(page) && page.value.contentType).toBe('image/jpeg');

      const saved = await saveRedactionMasks(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        pages: [
          { boxes: [BOX], acceptedSuggestions: 1 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: false,
      });
      if (!isOk(saved)) throw new Error(saved.error.message);
      expect(saved.value).toEqual({ versionId, pageCount: 2, boxCount: 1, state: 'MASKED' });
      expect(await stateOf()).toBe('MASKED');
      const rows = await db
        .select()
        .from(schema.redactionMasks)
        .where(eq(schema.redactionMasks.documentVersionId, versionId));
      expect(rows.map((row) => [row.page, row.source, row.createdByAccountId])).toEqual([
        [1, 'SUGGESTED_ACCEPTED', ownerId],
        [2, 'OWNER', ownerId],
      ]);

      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), deps);
      if (!isOk(copy)) throw new Error(copy.error.message);
      expect(copy.value).toMatchObject({
        contentType: 'application/pdf',
        pageCount: 2,
        filename: 'safe-copy.pdf',
      });
      expect(deps.masksDrawn).toEqual([[[BOX], []]]);

      const [savedEvent] = await audits('DOCUMENT_REDACTION_SAVED');
      expect(Object.keys(savedEvent?.metadata as object).sort()).toEqual([
        'acceptedSuggestions',
        'boxCount',
        'documentVersionId',
        'nothingToHide',
        'pageCount',
      ]);
      expect(savedEvent?.metadata).toEqual({
        documentVersionId: versionId,
        pageCount: 2,
        boxCount: 1,
        nothingToHide: false,
        acceptedSuggestions: 1,
      });
      const access = await audits('DOCUMENT_ACCESS');
      const download = access.find((a) => a.action === 'DOWNLOAD_REDACTED');
      expect(download).toMatchObject({ result: 'ALLOWED', actorRole: 'applicant_owner' });
      expect(download?.metadata).toMatchObject({
        variant: 'redacted',
        disposition: 'download',
        pageCount: 2,
        boxCount: 1,
        purpose: 'owner_safe_copy',
      });
      // No box position, image data or file content anywhere in the audit trail.
      const everything = JSON.stringify(await db.select().from(schema.auditEvents));
      expect(everything).not.toContain('313131');
      expect(everything).not.toContain('414141');
      expect(everything).not.toMatch(/"bytes"|jpeg|base64/i);

      const reopened = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), deps);
      expect(isOk(reopened) && reopened.value.savedPages).toEqual([[BOX], []]);
    });

    it('needs the explicit Nothing to Hide choice for a copy with no boxes', async () => {
      const empty = await saveBoxes([[], []]);
      expect(isErr(empty) && empty.error.code).toBe('invalid');
      const contradictory = await saveRedactionMasks(await gate(ownerId, 'MANAGE'), fakeDeps(), {
        versionId,
        pages: [
          { boxes: [BOX], acceptedSuggestions: 0 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: true,
      });
      expect(isErr(contradictory) && contradictory.error.code).toBe('invalid');
      expect(await stateOf()).toBe('NOT_PREPARED');

      const deps = fakeDeps();
      const nothing = await saveRedactionMasks(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        pages: [
          { boxes: [], acceptedSuggestions: 0 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: true,
      });
      expect(isOk(nothing) && nothing.value.state).toBe('NOTHING_TO_HIDE');
      expect(await stateOf()).toBe('NOTHING_TO_HIDE');
      expect(isOk(await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), deps))).toBe(
        true,
      );
      expect(deps.masksDrawn).toEqual([[[], []]]);
      const [event] = await audits('DOCUMENT_REDACTION_SAVED');
      expect(event?.metadata).toMatchObject({ nothingToHide: true, boxCount: 0 });
    });

    it('refuses a save that does not cover exactly the pages of the file, or a box off the page', async () => {
      for (const pages of [[[BOX]], [[BOX], [], []]]) {
        const result = await saveBoxes(pages);
        expect(isErr(result) && result.error.code).toBe('invalid');
      }
      for (const bad of [{ ...BOX, x: 0.9 }, { ...BOX, w: Number.NaN }, { x: 0, y: 0 }, 'box']) {
        const result = await saveBoxes([[bad], []]);
        expect(isErr(result) && result.error.code).toBe('invalid');
      }
      const tooMany = await saveBoxes([Array.from({ length: 201 }, () => BOX), []]);
      expect(isErr(tooMany) && tooMany.error.code).toBe('invalid');
      const wrongCount = await saveRedactionMasks(await gate(ownerId, 'MANAGE'), fakeDeps(), {
        versionId,
        pages: [
          { boxes: [BOX], acceptedSuggestions: 2 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: false,
      });
      expect(isErr(wrongCount) && wrongCount.error.code).toBe('invalid');
      expect(await stateOf()).toBe('NOT_PREPARED');
    });

    it('clears the boxes, so the copy is not prepared again, auditing counts only', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const cleared = await clearRedactionMasks(await gate(ownerId, 'MANAGE'), { versionId });
      expect(isOk(cleared) && cleared.value.pagesCleared).toBe(2);
      expect(await stateOf()).toBe('NOT_PREPARED');
      const [event] = await audits('DOCUMENT_REDACTION_CLEARED');
      expect(event?.metadata).toEqual({
        documentVersionId: versionId,
        pageCount: 2,
        boxCount: 0,
        nothingToHide: false,
        acceptedSuggestions: 0,
      });
    });
  });

  describe('nothing unmasked is ever served', () => {
    async function refusedCopy(deps = fakeDeps()) {
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), deps);
      expect(isErr(copy)).toBe(true);
      expect(deps.calls).not.toContain('renderSafeCopy');
      return isErr(copy) ? copy.error : undefined;
    }

    it('refuses a copy with no boxes saved, and audits the refusal', async () => {
      const error = await refusedCopy();
      expect(error?.refusal).toBe('not_prepared');
      const [denied] = await audits('DOCUMENT_ACCESS');
      expect(denied).toMatchObject({ result: 'DENIED', reason: 'not_prepared' });
    });

    it('refuses a copy whose boxes cover only some pages, or hold anything but valid boxes', async () => {
      await db.insert(schema.redactionMasks).values({
        documentVersionId: versionId,
        page: 2,
        boxes: [BOX],
        source: 'OWNER',
        createdByAccountId: ownerId,
      });
      expect(await stateOf()).toBe('NOT_PREPARED');
      expect((await refusedCopy())?.refusal).toBe('not_prepared');
      await db.insert(schema.redactionMasks).values({
        documentVersionId: versionId,
        page: 1,
        boxes: [{ x: 2, y: 0, w: 0.1, h: 0.1 }],
        source: 'OWNER',
        createdByAccountId: ownerId,
      });
      expect(await stateOf()).toBe('NOT_PREPARED');
      expect((await refusedCopy())?.refusal).toBe('not_prepared');
    });

    it('refuses when the saved pages no longer match the file, as not prepared', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const threePages = fakeDeps({ pageCount: 3 });
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), threePages);
      expect(isErr(copy) && copy.error.refusal).toBe('not_prepared');
      const denied = (await audits('DOCUMENT_ACCESS')).find((a) => a.result === 'DENIED');
      expect(denied?.reason).toBe('masks_do_not_cover_pages');
    });

    it('reads Not Prepared Yet and saves nothing before migration 0102 has run', async () => {
      await db.execute(sql`alter table redaction_masks rename to redaction_masks_away`);
      try {
        expect(await stateOf()).toBe('NOT_PREPARED');
        const error = await refusedCopy();
        expect(error?.refusal).toBe('not_prepared');
        const saved = await saveBoxes([[BOX], []]);
        expect(isErr(saved) && saved.error.refusal).toBe('not_ready_yet');
        const editor = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), fakeDeps());
        expect(isOk(editor) && editor.value).toMatchObject({ canSave: false, savedPages: null });
        const cleared = await clearRedactionMasks(await gate(ownerId, 'MANAGE'), { versionId });
        expect(isErr(cleared) && cleared.error.refusal).toBe('not_ready_yet');
      } finally {
        await db.execute(sql`alter table redaction_masks_away rename to redaction_masks`);
      }
    });

    it('refuses a version still being checked, before reading any bytes', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      await addVersion(ownerId, documentId, 2048, 'PENDING');
      const deps = fakeDeps();
      const error = await refusedCopy(deps);
      expect(error?.refusal).toBe('not_available');
      expect(deps.calls).toEqual([]);
    });

    it('refuses when drawing fails, never returning a partial copy', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const copy = await produceSafeCopy(
        await gate(ownerId, 'DOWNLOAD_REDACTED'),
        fakeDeps({ fail: 'unreadable' }),
      );
      expect(isErr(copy) && copy.error.refusal).toBe('unreadable');
    });
  });

  describe('boxes never carry over', () => {
    it('starts a new version with no boxes and refuses saving on an older one', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const second = await addVersion(ownerId, documentId);
      expect(await stateOf(second)).toBe('NOT_PREPARED');
      expect(await stateOf(versionId)).toBe('MASKED');
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), fakeDeps());
      expect(isErr(copy) && copy.error.refusal).toBe('not_prepared');
      const stale = await saveBoxes([[BOX], []]);
      expect(isErr(stale) && stale.error.refusal).toBe('out_of_date');
      const page = await renderRedactionPage(await gate(ownerId, 'PREVIEW'), fakeDeps(), {
        versionId,
        page: 1,
      });
      expect(isErr(page) && page.error.refusal).toBe('out_of_date');
      const newRows = await db
        .select()
        .from(schema.redactionMasks)
        .where(eq(schema.redactionMasks.documentVersionId, second));
      expect(newRows).toEqual([]);
    });

    it('removes the boxes when the file is queued for erasure, and with the document', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const [version] = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, versionId));
      const [storage] = await db
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, version?.storageObjectId ?? ''));
      if (!version || !storage) throw new Error('setup');
      await enqueueErasureJob(db, {
        reason: 'RETENTION_PURGE',
        bucket: 'CLEAN',
        objectKey: storage.objectKey,
        expectedHash: null,
        storageObjectId: storage.id,
        documentId,
        applicantId,
      });
      expect(await db.select().from(schema.redactionMasks)).toEqual([]);

      const other = await addDocument(ownerId, applicantId, 'BANK_STATEMENT');
      await db.insert(schema.redactionMasks).values({
        documentVersionId: other.versionId,
        page: 1,
        boxes: [BOX],
        source: 'OWNER',
        createdByAccountId: ownerId,
      });
      await db.delete(schema.documents).where(eq(schema.documents.id, other.documentId));
      expect(await db.select().from(schema.redactionMasks)).toEqual([]);
    });
  });

  describe('only the record owner edits boxes or sees the editor', () => {
    it('refuses a recipient holding manage, preview and download grants', async () => {
      const recipient = await recipientWith([
        'VIEW_METADATA',
        'PREVIEW',
        'MANAGE',
        'DOWNLOAD_REDACTED',
      ]);
      const deps = fakeDeps();
      const manage = await gate(recipient, 'MANAGE');
      expect(manage.actor.kind).toBe('individual_recipient');
      const saved = await saveRedactionMasks(manage, deps, {
        versionId,
        pages: [
          { boxes: [BOX], acceptedSuggestions: 0 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: false,
      });
      expect(isErr(saved) && saved.error.code).toBe('forbidden');
      const cleared = await clearRedactionMasks(manage, { versionId });
      expect(isErr(cleared) && cleared.error.code).toBe('forbidden');
      const preview = await gate(recipient, 'PREVIEW');
      const outcomes = [
        await openRedactionEditor(preview, deps),
        await renderRedactionPage(preview, deps, { versionId, page: 1 }),
        await suggestRedactions(preview, deps, { versionId }),
      ].map((result) => (result.ok ? 'served' : result.error.code));
      expect(outcomes).toEqual(['forbidden', 'forbidden', 'forbidden']);
      expect(deps.calls).toEqual([]);
      expect(await db.select().from(schema.redactionMasks)).toEqual([]);
    });

    it('refuses a copied or wrong-action proof, and another traveller version', async () => {
      const deps = fakeDeps();
      const manage = await gate(ownerId, 'MANAGE');
      const forged = await saveRedactionMasks({ ...manage } as never, deps, {
        versionId,
        pages: [
          { boxes: [BOX], acceptedSuggestions: 0 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: false,
      });
      expect(isErr(forged) && forged.error.code).toBe('forbidden');
      const preview = await gate(ownerId, 'PREVIEW');
      const wrongAction = await saveRedactionMasks(preview as never, deps, {
        versionId,
        pages: [{ boxes: [BOX], acceptedSuggestions: 0 }],
        nothingToHide: false,
      });
      expect(isErr(wrongAction) && wrongAction.error.code).toBe('forbidden');
      const copyWithPreview = await produceSafeCopy(preview as never, deps);
      expect(isErr(copyWithPreview) && copyWithPreview.error.code).toBe('forbidden');

      // Another traveller's owner, with a genuine proof for their own document, cannot reach this
      // version, and does not even learn its state.
      const otherOwner = await account('other@example.com');
      const otherApplicant = await traveller(otherOwner);
      const theirs = await addDocument(otherOwner, otherApplicant, 'PASSPORT');
      const crossed = await saveRedactionMasks(
        await gate(otherOwner, 'MANAGE', theirs.documentId),
        deps,
        {
          versionId,
          pages: [
            { boxes: [BOX], acceptedSuggestions: 0 },
            { boxes: [], acceptedSuggestions: 0 },
          ],
          nothingToHide: false,
        },
      );
      expect(isErr(crossed) && crossed.error.refusal).toBe('out_of_date');
      const crossClear = await clearRedactionMasks(
        await gate(otherOwner, 'MANAGE', theirs.documentId),
        { versionId },
      );
      expect(isErr(crossClear) && crossClear.error.code).toBe('not_found');
      const listed = await listRedactionStates(await applicantProof(otherOwner, otherApplicant), [
        versionId,
      ]);
      expect(isOk(listed) && listed.value.size).toBe(0);
      expect(await db.select().from(schema.redactionMasks)).toEqual([]);
      // The stranger has no relationship at all with this traveller.
      const stranger = await requireAccess(
        db,
        accountPrincipal(otherOwner),
        'MANAGE',
        { documentId },
        { purpose: EACH_GRANT },
      );
      expect(isErr(stranger) && stranger.error.code).toBe('forbidden');
    });

    it('lets a recipient with Download Safe Copies see the state and download, recorded as them', async () => {
      const recipient = await recipientWith(['VIEW_METADATA', 'DOWNLOAD_REDACTED']);
      const before = await getSafeCopyState(await gate(recipient, 'DOWNLOAD_REDACTED'));
      expect(isOk(before) && before.value).toBe('NOT_PREPARED');
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const after = await getSafeCopyState(await gate(recipient, 'DOWNLOAD_REDACTED'));
      expect(isOk(after) && after.value).toBe('MASKED');
      const copy = await produceSafeCopy(await gate(recipient, 'DOWNLOAD_REDACTED'), fakeDeps());
      expect(isOk(copy)).toBe(true);
      const download = (await audits('DOCUMENT_ACCESS')).find(
        (a) => a.action === 'DOWNLOAD_REDACTED' && a.result === 'ALLOWED',
      );
      expect(download).toMatchObject({
        actorAccountId: recipient,
        actorRole: 'individual_recipient',
      });
      expect(download?.metadata).toMatchObject({ purpose: 'shared_safe_copy' });
      // Preview alone never reaches a safe copy.
      const previewOnly = await recipientWith(['VIEW_METADATA', 'PREVIEW']);
      const refused = await requireAccess(
        db,
        accountPrincipal(previewOnly),
        'DOWNLOAD_REDACTED',
        { documentId },
        { purpose: EACH_GRANT },
      );
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
    });

    it('asks for a fresh identity check on a restricted document, and accepts a genuine one', async () => {
      // Passports are restricted by default: page images (PREVIEW) and the safe copy
      // (DOWNLOAD_REDACTED) need the step-up like any preview or download.
      for (const action of ['PREVIEW', 'DOWNLOAD_REDACTED'] as const) {
        const restricted = await requireAccess(
          db,
          accountPrincipal(ownerId),
          action,
          { documentId },
          { purpose: EACH_GRANT },
        );
        expect(isErr(restricted) && restricted.error.code).toBe('step_up_required');
      }
      const token = issueStepUpAssurance(STEP_UP_SECRET, {
        accountId: ownerId,
        action: 'DOWNLOAD_REDACTED',
        resourceId: documentId,
      });
      const proof = verifyStepUp(STEP_UP_SECRET, token, {
        accountId: ownerId,
        action: 'DOWNLOAD_REDACTED',
        resourceId: documentId,
      });
      const stepped = await requireAccess(
        db,
        accountPrincipal(ownerId),
        'DOWNLOAD_REDACTED',
        { documentId },
        { purpose: EACH_GRANT, ...(proof ? { stepUp: proof } : {}) },
      );
      expect(isOk(stepped)).toBe(true);
    });
  });

  describe('limits', () => {
    it('refuses too many pages, too much time and an output too large in plain words, audited', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      for (const fail of ['too_large', 'out_of_time'] as const) {
        const copy = await produceSafeCopy(
          await gate(ownerId, 'DOWNLOAD_REDACTED'),
          fakeDeps({ fail }),
        );
        expect(isErr(copy) && copy.error).toMatchObject({
          refusal: 'too_large',
          message: SAFE_COPY_TOO_LARGE_MESSAGE,
        });
      }
      const denied = (await audits('DOCUMENT_ACCESS')).filter((a) => a.result === 'DENIED');
      expect(denied.map((a) => a.reason).sort()).toEqual([
        'render_out_of_time',
        'render_too_large',
      ]);
      const editor = await openRedactionEditor(
        await gate(ownerId, 'PREVIEW'),
        fakeDeps({ fail: 'too_large' }),
      );
      expect(isErr(editor) && editor.error.message).toBe(SAFE_COPY_TOO_LARGE_MESSAGE);
    });

    it('refuses a file over 25 MB without reading it, and one whose bytes are over 25 MB', async () => {
      const big = await addDocument(
        ownerId,
        applicantId,
        'PASSPORT',
        'big.pdf',
        25 * 1024 * 1024 + 1,
      );
      expect(await stateOf(big.versionId)).toBe('TOO_LARGE');
      const deps = fakeDeps();
      const editor = await openRedactionEditor(
        await gate(ownerId, 'PREVIEW', big.documentId),
        deps,
      );
      expect(isErr(editor) && editor.error.refusal).toBe('too_large');
      expect(deps.calls).toEqual([]);

      const bytes = new Uint8Array(25 * 1024 * 1024 + 1);
      const large = fakeDeps({ bytes });
      const opened = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), large);
      expect(isErr(opened) && opened.error.refusal).toBe('too_large');
      expect(large.calls).toEqual(['getObject']);
    });

    it('refuses documents and text files as unsupported', async () => {
      const docx = await addDocument(ownerId, applicantId, 'EMPLOYMENT_CERTIFICATE', 'letter.docx');
      expect(await stateOf(docx.versionId)).toBe('UNSUPPORTED');
      const deps = fakeDeps({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const editor = await openRedactionEditor(
        await gate(ownerId, 'PREVIEW', docx.documentId),
        deps,
      );
      expect(isErr(editor) && editor.error.refusal).toBe('unsupported');
      const text = fakeDeps({ contentType: 'text/plain' });
      const copy = await produceSafeCopy(
        await gate(ownerId, 'DOWNLOAD_REDACTED', docx.documentId),
        text,
      );
      expect(isErr(copy) && copy.error.refusal).toBe('not_prepared');
      expect(text.calls).not.toContain('renderSafeCopy');
    });

    it('reads a version known to have more than 20 pages as too large', async () => {
      await db
        .update(schema.documentVersions)
        .set({ pages: 21 })
        .where(eq(schema.documentVersions.id, versionId));
      expect(await stateOf()).toBe('TOO_LARGE');
    });

    it('rate-limits safe copies and page views per person, in separate buckets', async () => {
      expect(isOk(await saveBoxes([[BOX], []]))).toBe(true);
      const fill = async (action: string, limit: number) => {
        const windowMs = RATE_LIMITS.SAFE_COPY.windowMs;
        await db
          .insert(schema.rateLimitBuckets)
          .values({
            subjectId: ownerId,
            action,
            windowStart: new Date(Math.floor(Date.now() / windowMs) * windowMs),
            count: limit,
          })
          .onConflictDoUpdate({
            target: [
              schema.rateLimitBuckets.subjectId,
              schema.rateLimitBuckets.action,
              schema.rateLimitBuckets.windowStart,
            ],
            set: { count: limit },
          });
      };
      await fill('safe_copy', RATE_LIMITS.SAFE_COPY.limit);
      const deps = fakeDeps();
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), deps);
      expect(isErr(copy) && copy.error.code).toBe('rate_limited');
      expect(deps.calls).toEqual([]);
      const page = await renderRedactionPage(await gate(ownerId, 'PREVIEW'), deps, {
        versionId,
        page: 1,
      });
      expect(isOk(page)).toBe(true);
      await fill('redaction_page', RATE_LIMITS.REDACTION_PAGE.limit);
      const limited = await renderRedactionPage(await gate(ownerId, 'PREVIEW'), fakeDeps(), {
        versionId,
        page: 1,
      });
      expect(isErr(limited) && limited.error.code).toBe('rate_limited');
    });
  });

  describe('suggestions', () => {
    it("suggests the passport band, machine-readable lines and the owner's own numbers, never their values", async () => {
      const encryption = testKeyManagement();
      await registerFieldDefinition(db, {
        key: 'passport_number',
        dataType: 'string',
        sensitivity: 'SENSITIVE',
      });
      const saved = await editFact(db, {
        actorAccountId: ownerId,
        applicantId,
        fieldKey: 'passport_number',
        value: 'EB 0912345',
        status: 'APPLICANT_CONFIRMED',
        method: 'MANUAL',
        encryption,
      });
      if (!isOk(saved)) throw new Error(saved.error.message);
      const at = (y: number) => ({ x: 0.1, y, w: 0.3, h: 0.02 });
      const deps = {
        ...fakeDeps({
          text: [
            [
              { text: 'Passport No. eb0912345', box: at(0.2) },
              { text: 'Given names', box: at(0.3) },
            ],
            [
              { text: 'P<BGDSYNTHETIC<<TRAVELLER<<<<<<<<<<<<<<<<<<', box: at(0.8) },
              { text: '1234 5678 9012', box: at(0.5) },
            ],
          ],
        }),
        encryption,
      };
      const result = await suggestRedactions(await gate(ownerId, 'PREVIEW'), deps, { versionId });
      if (!isOk(result)) throw new Error(result.error.message);
      expect(result.value.map((s) => [s.page, s.reason])).toEqual([
        [1, 'mrz'],
        [1, 'identifier'],
        [2, 'mrz'],
      ]);
      // Positions only: padded to hide a little more than the text.
      const identifier = result.value[1];
      expect(identifier?.box.x).toBeLessThan(0.1);
      expect(identifier?.box.w).toBeGreaterThan(0.3);
      expect(JSON.stringify(result.value)).not.toMatch(/0912345|Passport No/i);
      const [event] = (await audits('DOCUMENT_ACCESS')).filter(
        (a) => (a.metadata as { variant?: string }).variant === 'redaction_suggestions',
      );
      expect(event?.metadata).toMatchObject({ suggestionCount: 3 });
      expect(JSON.stringify(await db.select().from(schema.auditEvents))).not.toMatch(
        /0912345|EB 0912345/,
      );

      // The account number is suggested on a financial document only.
      const statement = await addDocument(ownerId, applicantId, 'BANK_STATEMENT');
      const onStatement = await suggestRedactions(
        await gate(ownerId, 'PREVIEW', statement.documentId),
        deps,
        { versionId: statement.versionId },
      );
      expect(isOk(onStatement) && onStatement.value.map((s) => [s.page, s.reason])).toEqual([
        [1, 'identifier'],
        [2, 'mrz'],
        [2, 'account_number'],
      ]);
    });

    it('offers only the passport band for a photo, which has no text of its own', async () => {
      const deps = fakeDeps({ contentType: 'image/jpeg', pageCount: 1 });
      const result = await suggestRedactions(await gate(ownerId, 'PREVIEW'), deps, { versionId });
      expect(isOk(result) && result.value.map((s) => s.reason)).toEqual(['mrz']);
      expect(deps.calls).not.toContain('textPositions');
    });
  });
});
