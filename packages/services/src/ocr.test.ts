import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { renderOcrSourceImage } from './ocr';
import type { PreviewRenderResult, PreviewRendererPort } from './preview-rendering';
import type {
  BlobStore,
  ListObjectKeysInput,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Deterministic in-memory blob store -- no S3, no network. */
class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
  public readonly getObjectCalls: string[] = [];

  seed(objectKey: string, bytes: StoredBytes): void {
    this.objects.set(objectKey, bytes);
  }
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    this.getObjectCalls.push(objectKey);
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(_input: ListObjectKeysInput): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

/** Deterministic in-memory preview renderer -- returns whatever the test configures. */
class FakePreviewRenderer implements PreviewRendererPort {
  readonly name = 'fake-renderer';
  readonly version = '1.0.0';
  public result: PreviewRenderResult = { rendered: false, detail: 'not configured' };
  public readonly renderCalls: { bytes: Uint8Array; contentType: string }[] = [];

  async render(input: { bytes: Uint8Array; contentType: string }): Promise<PreviewRenderResult> {
    this.renderCalls.push(input);
    return this.result;
  }
}

async function seedDocumentVersion(
  db: Db,
  email: string,
  objectKey: string,
): Promise<{ documentVersionId: string }> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant failed');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'passport.pdf',
    docType: 'passport',
  });
  if (!isOk(doc)) throw new Error('document failed');
  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey,
    sizeBytes: 1024,
    safetyStatus: 'CLEAN',
    processingStatus: 'APPROVED',
  });
  if (!isOk(version)) throw new Error('version failed');
  return { documentVersionId: version.value.version.id };
}

/** Validly-shaped but non-existent UUID -- a malformed string would throw at the DB layer instead of returning zero rows. */
const UNKNOWN_DOCUMENT_VERSION_ID = '00000000-0000-0000-0000-000000000000';

describe('renderOcrSourceImage -- prepares the bytes AiOcrPort.performOcr needs from a document version alone', () => {
  let db: Db;
  let blobStore: FakeBlobStore;
  let previewRenderer: FakePreviewRenderer;

  beforeEach(async () => {
    db = await freshDb();
    blobStore = new FakeBlobStore();
    previewRenderer = new FakePreviewRenderer();
  });

  it('returns document_version_not_found for an unknown id, never touching storage', async () => {
    const outcome = await renderOcrSourceImage(
      db,
      blobStore,
      previewRenderer,
      UNKNOWN_DOCUMENT_VERSION_ID,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('document_version_not_found');
    expect(blobStore.getObjectCalls).toHaveLength(0);
    expect(previewRenderer.renderCalls).toHaveLength(0);
  });

  it('returns object_bytes_missing when the storage object row exists but the blob store has nothing for it', async () => {
    const { documentVersionId } = await seedDocumentVersion(
      db,
      'a@example.com',
      'obj-missing-bytes',
    );
    // Deliberately never seeded into blobStore.

    const outcome = await renderOcrSourceImage(db, blobStore, previewRenderer, documentVersionId);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('object_bytes_missing');
    expect(previewRenderer.renderCalls).toHaveLength(0);
  });

  it('returns unsupported_format when the renderer reports no image can be produced (e.g. a DOCX/TXT source)', async () => {
    const { documentVersionId } = await seedDocumentVersion(db, 'b@example.com', 'obj-docx');
    blobStore.seed('obj-docx', {
      contentType: 'text/plain',
      bytes: new Uint8Array([1, 2, 3]),
    });
    previewRenderer.result = { rendered: false, detail: 'no visual representation for this type' };

    const outcome = await renderOcrSourceImage(db, blobStore, previewRenderer, documentVersionId);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('unsupported_format');
    expect(outcome.message).toBe('no visual representation for this type');
  });

  it('returns render_failed when the renderer produces a content type OCR cannot use', async () => {
    const { documentVersionId } = await seedDocumentVersion(db, 'c@example.com', 'obj-weird');
    blobStore.seed('obj-weird', { contentType: 'application/pdf', bytes: new Uint8Array([9]) });
    previewRenderer.result = {
      rendered: true,
      contentType: 'text/plain',
      bytes: new Uint8Array([9]),
    };

    const outcome = await renderOcrSourceImage(db, blobStore, previewRenderer, documentVersionId);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('render_failed');
  });

  it('renders a scanned PDF to PNG, passing the original bytes/content type straight through to the renderer', async () => {
    const { documentVersionId } = await seedDocumentVersion(db, 'd@example.com', 'obj-pdf');
    const originalBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    blobStore.seed('obj-pdf', { contentType: 'application/pdf', bytes: originalBytes });
    const rasterized = new Uint8Array([1, 2, 3, 4, 5]);
    previewRenderer.result = { rendered: true, contentType: 'image/png', bytes: rasterized };

    const outcome = await renderOcrSourceImage(db, blobStore, previewRenderer, documentVersionId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contentType).toBe('image/png');
    expect(outcome.imageBytes).toBe(rasterized);
    expect(previewRenderer.renderCalls).toEqual([
      { bytes: originalBytes, contentType: 'application/pdf' },
    ]);
  });

  it('passes a directly-uploaded JPEG through to the renderer for its own redraw/re-encode', async () => {
    const { documentVersionId } = await seedDocumentVersion(db, 'e@example.com', 'obj-jpeg');
    blobStore.seed('obj-jpeg', { contentType: 'image/jpeg', bytes: new Uint8Array([1]) });
    const reencoded = new Uint8Array([2, 2, 2]);
    previewRenderer.result = { rendered: true, contentType: 'image/jpeg', bytes: reencoded };

    const outcome = await renderOcrSourceImage(db, blobStore, previewRenderer, documentVersionId);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.contentType).toBe('image/jpeg');
    expect(outcome.imageBytes).toBe(reencoded);
  });
});
