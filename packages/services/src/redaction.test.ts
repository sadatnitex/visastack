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
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { addDocumentVersion, registerDocument } from './documents';
import { enqueueErasureJob } from './erasure';
import type { KeyManagementPort } from './ports';
import type {
  PositionedText,
  SafeCopyFailureReason,
  SafeCopyPageImage,
  SafeCopyRendererPort,
} from './preview-rendering';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { RATE_LIMITS } from './rate-limit';
import {
  MAX_SUGGESTIONS_PER_PAGE,
  type RedactionDeps,
  SAFE_COPY_TOO_LARGE_MESSAGE,
  clearRedactionMasks,
  getSafeCopyState,
  hasIban,
  isValidIban,
  listRedactionStates,
  listSafeCopyStatesForDocuments,
  looksLikeAccountNumber,
  looksLikeDate,
  openRedactionEditor,
  prepareSafeCopyPage,
  produceSafeCopy,
  renderRedactionPage,
  saveRedactionMasks,
  suggestRedactions,
} from './redaction';
import { issueStepUpAssurance } from './step-up';
import type { StorageBucket, StoredBytes } from './storage';

const STEP_UP_SECRET = 'redaction-step-up-secret';
/** A distinctive coordinate: it must never reach the audit trail. */
const BOX = { x: 0.313131, y: 0.414141, w: 0.2, h: 0.05 };
/** The bytes of the stored original; a stored drawing never contains them. */
const ORIGINAL = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x4f, 0x52, 0x49, 0x47]);

interface FakeOptions {
  readonly contentType?: string;
  readonly pageCount?: number;
  readonly text?: readonly (readonly PositionedText[])[];
  readonly fail?: SafeCopyFailureReason;
  readonly bytes?: Uint8Array;
}

/** Stored drawings, shared by every fake in one test, as a private bucket would hold them. */
let drawings: Map<string, StoredBytes>;

/** Records what reached storage and the renderer, so a refusal can be shown to do nothing. */
function fakeDeps(options: FakeOptions = {}): RedactionDeps & {
  readonly calls: string[];
  readonly drawn: { page: number; boxes: readonly unknown[] }[];
  readonly assembled: SafeCopyPageImage[][];
} {
  const calls: string[] = [];
  const drawn: { page: number; boxes: readonly unknown[] }[] = [];
  const assembled: SafeCopyPageImage[][] = [];
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
    async renderMaskedPage(_source, page, boxes, budget) {
      calls.push(`renderMaskedPage:${page}`);
      drawn.push({ page, boxes });
      if (failure) return failure;
      if (budget.maxBytes < 10) return { ok: false, reason: 'too_large', detail: 'x' };
      return {
        ok: true,
        contentType: 'image/jpeg',
        bytes: new Uint8Array([0xff, 0xd8, page, boxes.length, 0xff, 0xd9]),
        widthPt: 612,
        heightPt: 792,
      };
    },
    assembleSafeCopy(pages) {
      calls.push('assembleSafeCopy');
      assembled.push([...pages]);
      return { ok: true, contentType: 'application/pdf', bytes: new Uint8Array([0x25, 0x50]) };
    },
  };
  return {
    storage: {
      async getObject(objectKey: string) {
        const drawing = drawings.get(objectKey);
        if (drawing) return drawing;
        calls.push('getObject');
        return {
          contentType: options.contentType ?? 'application/pdf',
          bytes: options.bytes ?? ORIGINAL,
        };
      },
      async putObject(input) {
        drawings.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
      },
      async deleteObject(_bucket: StorageBucket, objectKey: string) {
        drawings.delete(objectKey);
      },
    },
    renderer,
    calls,
    drawn,
    assembled,
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
    drawings = new Map();
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

  /** What the owner's editor does after a save: each page drawn once, in order. */
  async function prepareAll(revision: string, pageCount = 2, deps = fakeDeps()) {
    let last: Awaited<ReturnType<typeof prepareSafeCopyPage>> | undefined;
    for (let page = 1; page <= pageCount; page++) {
      last = await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        page,
        maskRevision: revision,
      });
      if (!isOk(last)) throw new Error(`prepare ${page}: ${last.error.message}`);
    }
    return last;
  }

  /** Saves and prepares, returning the revision. */
  async function ready(pages: readonly (readonly unknown[])[] = [[BOX], []]) {
    const saved = await saveBoxes(pages);
    if (!isOk(saved)) throw new Error(saved.error.message);
    await prepareAll(saved.value.maskRevision, pages.length);
    return saved.value.maskRevision;
  }

  async function erasureJobs(reason = 'SAFE_COPY_REMOVAL') {
    return db
      .select()
      .from(schema.erasureJobs)
      .where(eq(schema.erasureJobs.reason, reason as never));
  }

  async function maskRows(version: string = versionId) {
    return db
      .select()
      .from(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, version))
      .orderBy(schema.redactionMasks.page);
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
    it('saves, prepares each page once, then serves only the stored pages, auditing counts only', async () => {
      expect(await stateOf()).toBe('NOT_PREPARED');
      const deps = fakeDeps();
      const editor = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), deps);
      if (!isOk(editor)) throw new Error(editor.error.message);
      expect(editor.value).toMatchObject({
        versionId,
        pageCount: 2,
        state: 'NOT_PREPARED',
        savedPages: null,
        maskRevision: null,
        preparedPages: [],
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
      expect(saved.value).toMatchObject({
        versionId,
        pageCount: 2,
        boxCount: 1,
        state: 'PREPARING',
      });
      const revision = saved.value.maskRevision;
      expect(await stateOf()).toBe('PREPARING');
      // Not served while preparing.
      const early = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), deps);
      expect(isErr(early) && early.error.refusal).toBe('not_prepared');
      expect(deps.calls).not.toContain('assembleSafeCopy');
      const [preparing] = (await audits('DOCUMENT_ACCESS')).filter((a) => a.result === 'DENIED');
      expect(preparing?.reason).toBe('still_preparing');

      const first = await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        page: 1,
        maskRevision: revision,
      });
      expect(isOk(first) && first.value).toEqual({
        page: 1,
        pageCount: 2,
        preparedPages: 1,
        state: 'PREPARING',
      });
      // Resuming after an interruption skips the page already drawn.
      const resumed = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), deps);
      expect(isOk(resumed) && resumed.value).toMatchObject({
        maskRevision: revision,
        preparedPages: [1],
        state: 'PREPARING',
      });
      const again = await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        page: 1,
        maskRevision: revision,
      });
      expect(isOk(again) && again.value.preparedPages).toBe(1);
      const second = await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        page: 2,
        maskRevision: revision,
      });
      expect(isOk(second) && second.value.state).toBe('MASKED');
      expect(deps.drawn).toEqual([
        { page: 1, boxes: [BOX] },
        { page: 2, boxes: [] },
      ]);
      expect(await stateOf()).toBe('MASKED');
      expect(drawings.size).toBe(2);

      // A download draws nothing and never reads the original.
      const download = fakeDeps();
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), download);
      if (!isOk(copy)) throw new Error(copy.error.message);
      expect(copy.value).toMatchObject({ contentType: 'application/pdf', pageCount: 2 });
      expect(download.calls).toEqual(['assembleSafeCopy']);
      expect(download.assembled[0]?.map((p) => [p.contentType, p.bytes[2], p.bytes[3]])).toEqual([
        ['image/jpeg', 1, 1],
        ['image/jpeg', 2, 0],
      ]);

      const [savedEvent] = await audits('DOCUMENT_REDACTION_SAVED');
      expect(savedEvent?.metadata).toEqual({
        documentVersionId: versionId,
        pageCount: 2,
        boxCount: 1,
        nothingToHide: false,
        acceptedSuggestions: 1,
      });
      const access = await audits('DOCUMENT_ACCESS');
      const downloaded = access.find(
        (a) => a.action === 'DOWNLOAD_REDACTED' && a.result === 'ALLOWED',
      );
      expect(downloaded?.metadata).toMatchObject({
        variant: 'redacted',
        disposition: 'download',
        pageCount: 2,
        boxCount: 1,
        purpose: 'owner_safe_copy',
      });
      // No box position, image data, file content or file name anywhere in the audit trail.
      const everything = JSON.stringify(await db.select().from(schema.auditEvents));
      expect(everything).not.toContain('313131');
      expect(everything).not.toContain('414141');
      expect(everything).not.toMatch(/"bytes"|jpeg|base64|safe-copy\//i);
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
      const nothing = await saveRedactionMasks(await gate(ownerId, 'MANAGE'), fakeDeps(), {
        versionId,
        pages: [
          { boxes: [], acceptedSuggestions: 0 },
          { boxes: [], acceptedSuggestions: 0 },
        ],
        nothingToHide: true,
      });
      if (!isOk(nothing)) throw new Error('save');
      await prepareAll(nothing.value.maskRevision);
      expect(await stateOf()).toBe('NOTHING_TO_HIDE');
      expect(
        isOk(await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), fakeDeps())),
      ).toBe(true);
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
      expect(await stateOf()).toBe('NOT_PREPARED');
    });
  });

  describe('a new revision replaces the old one, which is never served', () => {
    it('saving again queues the old drawings for erasure, deletes them, and serves nothing old', async () => {
      const first = await ready();
      const before = await maskRows();
      const oldObjects = before.map((row) => row.renderedStorageObjectId);
      expect(oldObjects.every((id) => id !== null)).toBe(true);
      const saved = await saveBoxes([[], [BOX]]);
      if (!isOk(saved)) throw new Error('save');
      expect(saved.value.maskRevision).not.toBe(first);
      expect(await stateOf()).toBe('PREPARING');
      // Old drawings: deleted at once, and queued for verified erasure in the same transaction.
      expect(drawings.size).toBe(0);
      const jobs = await erasureJobs();
      expect(jobs.map((job) => job.storageObjectId).sort()).toEqual([...oldObjects].sort());
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), fakeDeps());
      expect(isErr(copy) && copy.error.refusal).toBe('not_prepared');
      // A preparing step for the old revision is refused and stores nothing.
      const stale = await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), fakeDeps(), {
        versionId,
        page: 1,
        maskRevision: first,
      });
      expect(isErr(stale) && stale.error.refusal).toBe('out_of_date');
      expect(drawings.size).toBe(0);
    });

    it('removing the safe copy needs no drawing of the file, and queues its drawings for erasure', async () => {
      await ready();
      const deps = fakeDeps({ fail: 'unreadable' });
      const cleared = await clearRedactionMasks(await gate(ownerId, 'MANAGE'), { versionId }, deps);
      expect(isOk(cleared) && cleared.value.pagesCleared).toBe(2);
      expect(deps.calls).toEqual([]);
      expect(await stateOf()).toBe('NOT_PREPARED');
      expect(await erasureJobs()).toHaveLength(2);
      expect(drawings.size).toBe(0);
      const [event] = await audits('DOCUMENT_REDACTION_CLEARED');
      expect(event?.metadata).toEqual({
        documentVersionId: versionId,
        pageCount: 2,
        boxCount: 0,
        nothingToHide: false,
        acceptedSuggestions: 0,
      });
    });

    it('refuses a stored page that is missing or no longer matches what was stored', async () => {
      await ready();
      const [row] = await maskRows();
      const [object] = await db
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, row?.renderedStorageObjectId ?? ''));
      if (!object) throw new Error('drawing');
      drawings.set(object.objectKey, { contentType: 'image/jpeg', bytes: new Uint8Array([9, 9]) });
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), fakeDeps());
      expect(isErr(copy) && copy.error.refusal).toBe('not_prepared');
      drawings.delete(object.objectKey);
      const gone = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), fakeDeps());
      expect(isErr(gone) && gone.error.refusal).toBe('not_prepared');
      const denied = (await audits('DOCUMENT_ACCESS')).filter((a) => a.result === 'DENIED');
      expect(denied.map((a) => a.reason)).toEqual(['stored_page_missing', 'stored_page_missing']);
    });

    it('says a page took too long, not that the document is too large, and keeps nothing', async () => {
      const saved = await saveBoxes([[BOX], []]);
      if (!isOk(saved)) throw new Error('save');
      const slow = await prepareSafeCopyPage(
        await gate(ownerId, 'MANAGE'),
        fakeDeps({ fail: 'out_of_time' }),
        { versionId, page: 1, maskRevision: saved.value.maskRevision },
      );
      expect(isErr(slow) && slow.error.refusal).toBe('too_slow');
      const large = await prepareSafeCopyPage(
        await gate(ownerId, 'MANAGE'),
        fakeDeps({ fail: 'too_large' }),
        { versionId, page: 1, maskRevision: saved.value.maskRevision },
      );
      expect(isErr(large) && large.error.message).toBe(SAFE_COPY_TOO_LARGE_MESSAGE);
      expect(drawings.size).toBe(0);
      expect(await stateOf()).toBe('PREPARING');
    });
  });

  describe('nothing unmasked is ever served', () => {
    async function refusedCopy(deps = fakeDeps()) {
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), deps);
      expect(isErr(copy)).toBe(true);
      expect(deps.calls).not.toContain('assembleSafeCopy');
      return isErr(copy) ? copy.error : undefined;
    }

    it('refuses a copy with no boxes saved, and audits the refusal', async () => {
      const error = await refusedCopy();
      expect(error?.refusal).toBe('not_prepared');
      const [denied] = await audits('DOCUMENT_ACCESS');
      expect(denied).toMatchObject({ result: 'DENIED', reason: 'not_prepared' });
    });

    it('refuses rows that cover only some pages, mix revisions or hold invalid boxes', async () => {
      const revision = randomUUID();
      const insert = (page: number, boxes: unknown, maskRevision = revision) =>
        db.insert(schema.redactionMasks).values({
          documentVersionId: versionId,
          page,
          boxes: boxes as never,
          source: 'OWNER',
          createdByAccountId: ownerId,
          maskRevision,
        });
      await insert(2, [BOX]);
      expect(await stateOf()).toBe('NOT_PREPARED');
      await insert(1, [BOX], randomUUID());
      expect(await stateOf()).toBe('NOT_PREPARED');
      await db.delete(schema.redactionMasks);
      await insert(1, [{ x: 2, y: 0, w: 0.1, h: 0.1 }]);
      await insert(2, []);
      expect(await stateOf()).toBe('NOT_PREPARED');
      expect((await refusedCopy())?.refusal).toBe('not_prepared');
    });

    it('reads Not Prepared Yet and saves nothing before migration 0102 has run', async () => {
      await db.execute(sql`alter table redaction_masks rename to redaction_masks_away`);
      try {
        expect(await stateOf()).toBe('NOT_PREPARED');
        expect((await refusedCopy())?.refusal).toBe('not_prepared');
        const saved = await saveBoxes([[BOX], []]);
        expect(isErr(saved) && saved.error.refusal).toBe('not_ready_yet');
        const editor = await openRedactionEditor(await gate(ownerId, 'PREVIEW'), fakeDeps());
        expect(isOk(editor) && editor.value).toMatchObject({ canSave: false, savedPages: null });
        const cleared = await clearRedactionMasks(await gate(ownerId, 'MANAGE'), { versionId });
        expect(isErr(cleared) && cleared.error.refusal).toBe('not_ready_yet');
        const prepared = await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), fakeDeps(), {
          versionId,
          page: 1,
          maskRevision: randomUUID(),
        });
        expect(isErr(prepared) && prepared.error.refusal).toBe('not_ready_yet');
      } finally {
        await db.execute(sql`alter table redaction_masks_away rename to redaction_masks`);
      }
    });

    it('refuses while a newer version is still being checked, before reading anything', async () => {
      await ready();
      await addVersion(ownerId, documentId, 2048, 'PENDING');
      const deps = fakeDeps();
      const error = await refusedCopy(deps);
      expect(error?.refusal).toBe('not_available');
      expect(deps.calls).toEqual([]);
    });
  });

  describe('boxes and drawings never carry over, and go when the file goes', () => {
    it('starts a new version with nothing and refuses saving or preparing on an older one', async () => {
      const revision = await ready();
      const oldDrawings = (await maskRows()).map((row) => row.renderedStorageObjectId);
      const second = await addVersion(ownerId, documentId);
      expect(await stateOf(second)).toBe('NOT_PREPARED');
      // The older version's boxes go with the new version, and its drawings are queued for
      // verified erasure in the same transaction: nothing of an old version is kept.
      expect(await maskRows()).toEqual([]);
      expect((await erasureJobs()).map((job) => job.storageObjectId).sort()).toEqual(
        [...oldDrawings].sort(),
      );
      const copy = await produceSafeCopy(await gate(ownerId, 'DOWNLOAD_REDACTED'), fakeDeps());
      expect(isErr(copy) && copy.error.refusal).toBe('not_prepared');
      const stale = await saveBoxes([[BOX], []]);
      expect(isErr(stale) && stale.error.refusal).toBe('out_of_date');
      expect(await maskRows(second)).toEqual([]);
      void revision;
    });

    it('queues the drawings for erasure with the file, and with the account', async () => {
      await ready();
      const [version] = await db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, versionId));
      const [stored] = await db
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, version?.storageObjectId ?? ''));
      if (!version || !stored) throw new Error('setup');
      const drawingIds = (await maskRows()).map((row) => row.renderedStorageObjectId);
      await enqueueErasureJob(db, {
        reason: 'RETENTION_PURGE',
        bucket: 'CLEAN',
        objectKey: stored.objectKey,
        expectedHash: null,
        storageObjectId: stored.id,
        documentId,
        applicantId,
      });
      expect(await maskRows()).toEqual([]);
      expect((await erasureJobs()).map((job) => job.storageObjectId).sort()).toEqual(
        [...drawingIds].sort(),
      );

      // Account deletion: a second traveller's prepared copy is queued with their documents.
      const other = await account('leaving@example.com');
      const otherApplicant = await traveller(other);
      const theirs = await addDocument(other, otherApplicant, 'BANK_STATEMENT');
      const theirDrawing = await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: `safe-copy/${randomUUID()}`, contentHash: 'h' })
        .returning();
      await db.insert(schema.redactionMasks).values({
        documentVersionId: theirs.versionId,
        page: 1,
        boxes: [BOX],
        source: 'OWNER',
        createdByAccountId: other,
        maskRevision: randomUUID(),
        renderedStorageObjectId: theirDrawing[0]?.id ?? null,
        renderedContentType: 'image/jpeg',
        renderedByteSize: 10,
        renderedWidthPt: 612,
        renderedHeightPt: 792,
        renderedAt: new Date(),
      });
      const request = await requestAccountDeletion(db, { actorAccountId: other, accountId: other });
      if (!isOk(request)) throw new Error(`request: ${request.error.message}`);
      const executed = await executeAccountDeletion(db, {
        accountId: other,
        now: new Date(Date.now() + 40 * 24 * 3600 * 1000),
      });
      if (!isOk(executed)) throw new Error(`execute: ${executed.error.message}`);
      const accountJobs = await erasureJobs('ACCOUNT_DELETION');
      expect(accountJobs.map((job) => job.storageObjectId)).toContain(theirDrawing[0]?.id);
    });
  });

  describe('a drawing is always found again, even when preparing stops part way', () => {
    /** Storage that stores the bytes, then fails every later call, as if the process died. */
    function dyingDeps() {
      const deps = fakeDeps();
      let dead = false;
      return {
        ...deps,
        storage: {
          async getObject(objectKey: string) {
            if (dead) throw new Error('process stopped');
            return deps.storage.getObject(objectKey);
          },
          async putObject(input: Parameters<RedactionDeps['storage']['putObject']>[0]) {
            await deps.storage.putObject(input);
            dead = true;
            throw new Error('process stopped');
          },
          async deleteObject() {
            throw new Error('process stopped');
          },
        },
      };
    }

    /** Saves two pages and stops while storing page 1: its bytes and registration stay behind. */
    async function stoppedPart(): Promise<{ revision: string; drawingId: string; key: string }> {
      const saved = await saveBoxes([[BOX], []]);
      if (!isOk(saved)) throw new Error('save');
      await expect(
        prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), dyingDeps(), {
          versionId,
          page: 1,
          maskRevision: saved.value.maskRevision,
        }),
      ).rejects.toThrow('process stopped');
      const [row] = await maskRows();
      const drawingId = row?.pendingStorageObjectId;
      if (!drawingId) throw new Error('the drawing must be named on its row before its bytes');
      expect(row?.renderedStorageObjectId).toBeNull();
      const [object] = await db
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, drawingId));
      if (!object) throw new Error('registered');
      expect(drawings.has(object.objectKey)).toBe(true);
      expect(await stateOf()).toBe('PREPARING');
      return { revision: saved.value.maskRevision, drawingId, key: object.objectKey };
    }

    it('removal queues the unfinished drawing for erasure and deletes its bytes', async () => {
      const { drawingId, key } = await stoppedPart();
      const cleared = await clearRedactionMasks(
        await gate(ownerId, 'MANAGE'),
        { versionId },
        fakeDeps(),
      );
      expect(isOk(cleared)).toBe(true);
      expect((await erasureJobs()).map((job) => job.storageObjectId)).toEqual([drawingId]);
      expect(drawings.has(key)).toBe(false);
    });

    it('saving again queues it', async () => {
      const { drawingId } = await stoppedPart();
      expect(isOk(await saveBoxes([[], [BOX]]))).toBe(true);
      expect((await erasureJobs()).map((job) => job.storageObjectId)).toEqual([drawingId]);
    });

    it('the next preparing step of that page queues it and finishes the page', async () => {
      const { revision, drawingId, key } = await stoppedPart();
      const deps = fakeDeps();
      await prepareAll(revision, 2, deps);
      expect((await erasureJobs()).map((job) => job.storageObjectId)).toEqual([drawingId]);
      expect(drawings.has(key)).toBe(false);
      const rows = await maskRows();
      expect(rows.every((row) => row.pendingStorageObjectId === null)).toBe(true);
      expect(rows.every((row) => row.renderedStorageObjectId !== null)).toBe(true);
      expect(await stateOf()).toBe('MASKED');
      // Each page parsed once while preparing: the page count was fixed when the boxes were saved.
      expect(deps.calls.filter((call) => call === 'pageCount')).toEqual([]);
    });

    it('a new version and account deletion queue it', async () => {
      const { drawingId } = await stoppedPart();
      await addVersion(ownerId, documentId);
      expect((await erasureJobs()).map((job) => job.storageObjectId)).toEqual([drawingId]);

      // Account deletion: an unfinished drawing of a leaving traveller is queued with the account.
      const other = await account('leaving-unfinished@example.com');
      const otherApplicant = await traveller(other);
      const theirs = await addDocument(other, otherApplicant, 'BANK_STATEMENT');
      const [theirDrawing] = await db
        .insert(schema.storageObjects)
        .values({ bucket: 'CLEAN', objectKey: `safe-copy/${randomUUID()}`, contentHash: 'h' })
        .returning();
      await db.insert(schema.redactionMasks).values({
        documentVersionId: theirs.versionId,
        page: 1,
        boxes: [BOX],
        source: 'OWNER',
        createdByAccountId: other,
        maskRevision: randomUUID(),
        pendingStorageObjectId: theirDrawing?.id ?? null,
      });
      const request = await requestAccountDeletion(db, { actorAccountId: other, accountId: other });
      if (!isOk(request)) throw new Error(`request: ${request.error.message}`);
      const executed = await executeAccountDeletion(db, {
        accountId: other,
        now: new Date(Date.now() + 40 * 24 * 3600 * 1000),
      });
      if (!isOk(executed)) throw new Error(`execute: ${executed.error.message}`);
      const accountJobs = await erasureJobs('ACCOUNT_DELETION');
      expect(accountJobs.map((job) => job.storageObjectId)).toContain(theirDrawing?.id);
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
      const prepared = await prepareSafeCopyPage(manage, deps, {
        versionId,
        page: 1,
        maskRevision: randomUUID(),
      });
      expect(isErr(prepared) && prepared.error.code).toBe('forbidden');
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
    });

    it('lets a recipient with Download Safe Copies see the state and download, recorded as them', async () => {
      const recipient = await recipientWith(['VIEW_METADATA', 'DOWNLOAD_REDACTED']);
      const before = await getSafeCopyState(await gate(recipient, 'DOWNLOAD_REDACTED'));
      expect(isOk(before) && before.value).toBe('NOT_PREPARED');
      await ready();
      // One read for any number of documents, from view-details proofs (no identity check).
      const states = await listSafeCopyStatesForDocuments(await gate(recipient, 'VIEW_METADATA'), [
        { forged: true } as never,
      ]);
      expect([...states.entries()]).toEqual([[documentId, 'MASKED']]);
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
    });

    it('asks for a fresh identity check on a restricted document, but not to read the state', async () => {
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
      const details = await requireAccess(
        db,
        accountPrincipal(ownerId),
        'VIEW_METADATA',
        { documentId },
        { purpose: EACH_GRANT },
      );
      expect(isOk(details)).toBe(true);
    });
  });

  describe('limits', () => {
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
      const large = fakeDeps({ bytes: new Uint8Array(25 * 1024 * 1024 + 1) });
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
    });

    it('shares the output limit between pages when preparing', async () => {
      const saved = await saveBoxes([[BOX], []]);
      if (!isOk(saved)) throw new Error('save');
      const deps = fakeDeps();
      let limit = 0;
      deps.renderer.renderMaskedPage = async (_s, _p, _b, budget) => {
        limit = budget.maxBytes;
        return { ok: false, reason: 'too_large', detail: 'x' };
      };
      await prepareSafeCopyPage(await gate(ownerId, 'MANAGE'), deps, {
        versionId,
        page: 1,
        maskRevision: saved.value.maskRevision,
      });
      expect(limit).toBeGreaterThan(1_900_000);
      expect(limit * 2).toBeLessThanOrEqual(4_000_000);
    });

    it('reads a version known to have more than 20 pages as too large', async () => {
      await db
        .update(schema.documentVersions)
        .set({ pages: 21 })
        .where(eq(schema.documentVersions.id, versionId));
      expect(await stateOf()).toBe('TOO_LARGE');
    });

    it('logs which step failed and its reason code, never the renderer detail, and keeps the audit to a code', async () => {
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      };
      try {
        const page = await renderRedactionPage(
          await gate(ownerId, 'PREVIEW'),
          fakeDeps({ fail: 'unreadable' }),
          { versionId, page: 1 },
        );
        expect(isErr(page)).toBe(true);
      } finally {
        console.warn = original;
      }
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^\[safe-copy\] [a-z ]+ failed: unreadable$/);
      expect(warnings[0]).not.toContain('test failure');
      const [denied] = (await audits('DOCUMENT_ACCESS')).filter((e) => e.result === 'DENIED');
      expect(denied?.reason).toBe('render_unreadable');
      expect(JSON.stringify(denied?.metadata)).not.toContain('test failure');
    });

    it('rate-limits safe copies and page views per person, in separate buckets', async () => {
      await ready();
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
    const at = (y: number, x = 0.1) => ({ x, y, w: 0.3, h: 0.02 });

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
      const deps = {
        ...fakeDeps({
          text: [
            [
              { text: 'Passport No. eb0912345', box: at(0.2) },
              { text: 'Given names', box: at(0.3) },
            ],
            [{ text: 'P<BGDSYNTHETIC<<TRAVELLER<<<<<<<<<<<<<<<<<<', box: at(0.8) }],
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
      expect(JSON.stringify(result.value)).not.toMatch(/0912345|Passport No/i);
      const [event] = (await audits('DOCUMENT_ACCESS')).filter(
        (a) => (a.metadata as { variant?: string }).variant === 'redaction_suggestions',
      );
      expect(event?.metadata).toMatchObject({ suggestionCount: 3 });
      expect(JSON.stringify(await db.select().from(schema.auditEvents))).not.toMatch(/0912345/);
    });

    it('suggests account numbers only on a labelled line, never dates, phone numbers or amounts', async () => {
      const statement = await addDocument(ownerId, applicantId, 'BANK_STATEMENT');
      const text = [
        [
          { text: 'Account No:', box: at(0.1, 0.05) },
          { text: '1234 5678 9012', box: at(0.1, 0.4) },
          { text: 'Statement period 01/01/2024 to 31/01/2024', box: at(0.2) },
          { text: '20240131', box: at(0.25) },
          { text: 'Phone: +880 1712 345678', box: at(0.3) },
          { text: 'Balance BDT 12,345,678.00', box: at(0.35) },
          { text: 'Reference 98765432 for your records', box: at(0.4) },
          { text: 'IBAN GB82 WEST 1234 5698 7654 32', box: at(0.45) },
          { text: 'GB82 WEST 1234 5698 7654 33', box: at(0.5) },
          { text: 'GB 82 WEST and other words 12345698765432', box: at(0.55) },
          { text: 'BE68 5390 0754 7034 EUR', box: at(0.6) },
          { text: 'A/C 1234-56-7890', box: at(0.65) },
          { text: 'Account opened 31-01-2024', box: at(0.7) },
        ],
      ];
      const result = await suggestRedactions(
        await gate(ownerId, 'PREVIEW', statement.documentId),
        fakeDeps({ text }),
        { versionId: statement.versionId },
      );
      if (!isOk(result)) throw new Error(result.error.message);
      // The labelled number and the valid IBAN only.
      expect(result.value.map((s) => [s.reason, Math.round(s.box.y * 100)])).toEqual([
        ['account_number', 10],
        ['account_number', 45],
        ['account_number', 60],
        ['account_number', 65],
      ]);
    });

    it('caps suggestions per page', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => ({
        text: 'P<BGDSYNTHETIC<<TRAVELLER<<<<<<<<<<<<<<<<<<',
        box: at(0.01 + i * 0.019),
      }));
      const result = await suggestRedactions(
        await gate(ownerId, 'PREVIEW'),
        fakeDeps({ text: [lines] }),
        {
          versionId,
        },
      );
      expect(isOk(result) && result.value.length).toBe(MAX_SUGGESTIONS_PER_PAGE);
    });

    it('offers only the passport band for a photo, which has no text of its own', async () => {
      const deps = fakeDeps({ contentType: 'image/jpeg', pageCount: 1 });
      const result = await suggestRedactions(await gate(ownerId, 'PREVIEW'), deps, { versionId });
      expect(isOk(result) && result.value.map((s) => s.reason)).toEqual(['mrz']);
      expect(deps.calls).not.toContain('textPositions');
    });

    it('checks IBANs by country, length and checksum, and account numbers by context', () => {
      expect(isValidIban('GB82WEST12345698765432')).toBe(true);
      expect(isValidIban('GB82WEST12345698765433')).toBe(false);
      expect(isValidIban('ZZ82WEST12345698765432')).toBe(false);
      expect(isValidIban('DE89370400440532013000')).toBe(true);
      expect(looksLikeAccountNumber('1234567890', 'A/C 1234567890')).toBe(true);
      expect(looksLikeAccountNumber('1234567890', 'Customer 1234567890')).toBe(false);
      expect(looksLikeAccountNumber('31/01/2024', 'Account 31/01/2024')).toBe(false);
      expect(looksLikeAccountNumber('12,345,678.00', 'Account balance 12,345,678.00')).toBe(false);
      expect(looksLikeAccountNumber('+8801712345678', 'Account phone +8801712345678')).toBe(false);
    });

    it('reads a printed IBAN to its exact length, and hyphen-grouped account numbers as numbers', () => {
      // A short word after a grouped IBAN is never taken in.
      expect(hasIban('BE68 5390 0754 7034 EUR')).toBe(true);
      expect(hasIban('IBAN: BE68 5390 0754 7034')).toBe(true);
      expect(hasIban('BE68539007547034')).toBe(true);
      expect(hasIban('GB82 WEST 1234 5698 7654 32 GBP')).toBe(true);
      expect(hasIban('GB82 WEST 1234 5698 7654 33 GBP')).toBe(false);
      expect(hasIban('BE68 5390 0754 7035 EUR')).toBe(false);
      expect(hasIban('GB 82 WEST and other words 12345698765432')).toBe(false);
      // An account number grouped with hyphens on a labelled line.
      expect(looksLikeAccountNumber('A/C 1234-56-7890', 'A/C 1234-56-7890')).toBe(true);
      expect(looksLikeAccountNumber('1234-5678-9012', 'Account number 1234-5678-9012')).toBe(true);
      // Real dates stay dates, in every usual shape.
      expect(looksLikeDate('31-01-2024')).toBe(true);
      expect(looksLikeDate('2024-01-31')).toBe(true);
      expect(looksLikeDate('1/2/24')).toBe(true);
      expect(looksLikeDate('1234-56-7890')).toBe(false);
      expect(looksLikeDate('12-34-5678')).toBe(false);
      expect(looksLikeAccountNumber('31-01-2024', 'Account opened 31-01-2024')).toBe(false);
      expect(looksLikeAccountNumber('2024-01-31', 'Account opened 2024-01-31')).toBe(false);
      expect(
        looksLikeAccountNumber(
          'Statement period 01-01-2024 to 31-01-2024',
          'Account statement period 01-01-2024 to 31-01-2024',
        ),
      ).toBe(false);
      expect(looksLikeAccountNumber('01712 345678', 'Account mobile 01712 345678')).toBe(false);
      expect(looksLikeAccountNumber('12,345,678.00', 'Account balance 12,345,678.00')).toBe(false);
    });
  });
});
