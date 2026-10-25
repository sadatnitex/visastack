import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import type { CropInput, PhotoMeasurements, PhotoSpec } from '@visastack/core/photo-specs';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
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
import { createOrganization, reviewOrganization } from './organizations';
import {
  type PhotoSizerPort,
  type PhotoSizingDeps,
  checkVisaPhoto,
  isPassportPhotoType,
  produceVisaPhotoSize,
} from './photo-sizing';
import { RATE_LIMITS } from './rate-limit';
import { acceptGrant, createGrant } from './sharing';
import { issueStepUpAssurance } from './step-up';

const STEP_UP_SECRET = 'photo-step-up-secret';
const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

const MEASURED: PhotoMeasurements = {
  width: 1200,
  height: 1500,
  meanLuma: 150,
  lumaStdDev: 50,
  sharpness: 300,
  borderStdDev: 4,
  borderMeanLuma: 240,
};

/** Records what reached the image work, so a refused request can be shown to do none. */
function fakeDeps(contentType = 'image/jpeg'): PhotoSizingDeps & {
  readonly calls: string[];
  readonly produced: { spec: PhotoSpec; crop: CropInput }[];
} {
  const calls: string[] = [];
  const produced: { spec: PhotoSpec; crop: CropInput }[] = [];
  const sizer: PhotoSizerPort = {
    async measure() {
      calls.push('measure');
      return MEASURED;
    },
    async preview() {
      calls.push('preview');
      return { bytes: new Uint8Array([1, 2, 3]), width: 384, height: 480 };
    },
    async produce(_bytes, spec, crop) {
      calls.push('produce');
      produced.push({ spec, crop });
      return {
        bytes: new Uint8Array([9, 9, 9]),
        widthPx: 413,
        heightPx: 531,
        dpi: 300,
        quality: 92,
        cropBox: { left: 0, top: 0, width: 1167, height: 1500 },
        withinFileSizeRange: true,
      };
    },
  };
  return {
    storage: {
      async getObject() {
        calls.push('getObject');
        return { contentType, bytes: PHOTO_BYTES };
      },
    },
    sizer,
    calls,
    produced,
  };
}

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error(`provision ${email}`);
  return result.value.id;
}

describe('isPassportPhotoType', () => {
  it('knows the Photograph kind by its key and its aliases, and nothing else', () => {
    for (const name of ['PHOTO', 'PHOTOGRAPH', 'PASSPORT_PHOTO', 'VISA_PHOTO']) {
      expect(isPassportPhotoType(name)).toBe(true);
    }
    for (const name of ['PASSPORT', 'PHOTO_FAMILY', null, undefined, '']) {
      expect(isPassportPhotoType(name)).toBe(false);
    }
  });
});

describe('visa photo sizes - access through the central gate', () => {
  let db: Db;
  let ownerId: string;
  let applicantId: string;
  let photoId: string;

  beforeEach(async () => {
    db = await freshDb();
    ownerId = await account(db, 'owner@example.com');
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, { actorAccountId: ownerId, accountId: ownerId, type, granted: true });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Owner',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    photoId = await addPhoto('PHOTOGRAPH', 'CLEAN', 'APPROVED');
  });

  async function addPhoto(
    docType: string,
    safetyStatus: 'CLEAN' | 'PENDING',
    processingStatus: 'APPROVED' | 'SCANNING',
  ): Promise<string> {
    const doc = await registerDocument(db, {
      actorAccountId: ownerId,
      applicantId,
      originalName: 'me.jpg',
      docType,
    });
    if (!isOk(doc)) throw new Error('document');
    const version = await addDocumentVersion(db, {
      actorAccountId: ownerId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `photo-${randomUUID()}`,
      sizeBytes: 4,
      safetyStatus,
      processingStatus,
    });
    if (!isOk(version)) throw new Error('version');
    return doc.value.id;
  }

  async function agencyWith(
    actions: readonly ('VIEW_METADATA' | 'PREVIEW' | 'DOWNLOAD_REDACTED')[],
  ): Promise<{ agentId: string; organizationId: string }> {
    const agentId = await account(db, `agent-${randomUUID()}@agency.example.com`);
    const org = await createOrganization(db, { actorAccountId: agentId, name: 'Agency' });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account(db, `reviewer-${randomUUID()}@platform.example.com`);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review');
    const grant = await createGrant(db, {
      actorAccountId: ownerId,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions,
      purpose: 'visa-application',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    const accepted = await acceptGrant(db, { actorAccountId: agentId, grantId: grant.value.id });
    if (!isOk(accepted)) throw new Error('accept');
    return { agentId, organizationId: org.value.id };
  }

  async function gate<A extends 'PREVIEW' | 'DOWNLOAD_REDACTED'>(
    accountId: string,
    action: A,
    documentId: string = photoId,
  ) {
    return requireAccess(
      db,
      accountPrincipal(accountId),
      action,
      { documentId },
      {
        purpose: EACH_GRANT,
      },
    );
  }

  async function photoAudits(documentId: string = photoId) {
    return db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.resourceId, documentId),
          eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'),
        ),
      );
  }

  it('lets the owner check the photo and download a size, auditing which size and no image data', async () => {
    const deps = fakeDeps();
    const preview = await gate(ownerId, 'PREVIEW');
    if (!isOk(preview)) throw new Error('owner preview gate');
    const checked = await checkVisaPhoto(preview.value, deps);
    if (!isOk(checked)) throw new Error(checked.error.message);
    expect(checked.value.sourceWidth).toBe(1200);
    expect(checked.value.findings).toEqual([]);

    const download = await gate(ownerId, 'DOWNLOAD_REDACTED');
    if (!isOk(download)) throw new Error('owner download gate');
    const crop = { offsetX: 0.2, offsetY: -0.1, zoom: 1.3 };
    const produced = await produceVisaPhotoSize(download.value, deps, {
      specId: 'us-2x2',
      crop,
    });
    if (!isOk(produced)) throw new Error(produced.error.message);
    expect(produced.value.filename).toBe('visa-photo-us-2x2.jpg');
    expect(deps.produced).toEqual([{ spec: produced.value.spec, crop }]);

    const audits = await photoAudits();
    const allowed = audits.filter((a) => a.result === 'ALLOWED');
    expect(allowed.map((a) => a.action).sort()).toEqual(['DOWNLOAD_REDACTED', 'PREVIEW']);
    const sized = allowed.find((a) => a.action === 'DOWNLOAD_REDACTED');
    expect(sized?.metadata).toMatchObject({
      variant: 'photo_size',
      disposition: 'download',
      photoSpecId: 'us-2x2',
      purpose: 'owner_photo_sizes',
      widthPx: 413,
      heightPx: 531,
      dpi: 300,
    });
    // Nothing that could hold image bytes is written to the audit trail.
    expect(JSON.stringify(audits)).not.toMatch(/jpegBase64|bytes/);
  });

  it('lets an agency whose grant includes downloads use it, and records the agency member', async () => {
    const { agentId } = await agencyWith(['VIEW_METADATA', 'PREVIEW', 'DOWNLOAD_REDACTED']);
    const deps = fakeDeps();
    const download = await gate(agentId, 'DOWNLOAD_REDACTED');
    if (!isOk(download)) throw new Error(`agency gate: ${download.error.code}`);
    const produced = await produceVisaPhotoSize(download.value, deps, {
      specId: 'schengen-35x45',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isOk(produced)).toBe(true);
    const audit = (await photoAudits()).find((a) => a.action === 'DOWNLOAD_REDACTED');
    expect(audit?.actorAccountId).toBe(agentId);
    expect(audit?.actorRole).toMatch(/^org:/);
    expect(audit?.metadata).toMatchObject({ purpose: 'shared_photo_sizes' });
  });

  it('refuses a download to an agency whose grant does not include downloads, while its preview still works', async () => {
    const { agentId } = await agencyWith(['VIEW_METADATA', 'PREVIEW']);
    expect(isOk(await gate(agentId, 'PREVIEW'))).toBe(true);
    const download = await gate(agentId, 'DOWNLOAD_REDACTED');
    expect(isErr(download) && download.error.code).toBe('forbidden');
  });

  it('refuses another account with no relationship to the traveller', async () => {
    const stranger = await account(db, 'stranger@example.com');
    for (const action of ['PREVIEW', 'DOWNLOAD_REDACTED'] as const) {
      const result = await gate(stranger, action);
      expect(isErr(result) && result.error.code).toBe('forbidden');
    }
  });

  it('asks for a step-up when an admin has made photos restricted, and accepts a genuine one', async () => {
    await db
      .insert(schema.documentProtectionSettings)
      .values({ scope: 'DOCUMENT_TYPE', key: 'PHOTO', restricted: true });
    const without = await gate(ownerId, 'DOWNLOAD_REDACTED');
    expect(isErr(without) && without.error.code).toBe('step_up_required');

    const token = issueStepUpAssurance(STEP_UP_SECRET, {
      accountId: ownerId,
      action: 'DOWNLOAD_REDACTED',
      resourceId: photoId,
    });
    const proof = verifyStepUp(STEP_UP_SECRET, token, {
      accountId: ownerId,
      action: 'DOWNLOAD_REDACTED',
      resourceId: photoId,
    });
    const withProof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'DOWNLOAD_REDACTED',
      { documentId: photoId },
      { purpose: EACH_GRANT, ...(proof ? { stepUp: proof } : {}) },
    );
    if (!isOk(withProof)) throw new Error('step-up accepted');
    const produced = await produceVisaPhotoSize(withProof.value, fakeDeps(), {
      specId: 'uk-35x45',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isOk(produced)).toBe(true);
  });

  it('refuses a proof issued for a different action (a preview proof cannot download)', async () => {
    const preview = await gate(ownerId, 'PREVIEW');
    if (!isOk(preview)) throw new Error('gate');
    const deps = fakeDeps();
    const produced = await produceVisaPhotoSize(preview.value as never, deps, {
      specId: 'us-2x2',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isErr(produced) && produced.error.code).toBe('forbidden');
    expect(deps.calls).toEqual([]);
  });

  it('refuses a spread copy of a genuine proof', async () => {
    const download = await gate(ownerId, 'DOWNLOAD_REDACTED');
    if (!isOk(download)) throw new Error('gate');
    const deps = fakeDeps();
    const produced = await produceVisaPhotoSize({ ...download.value } as never, deps, {
      specId: 'us-2x2',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isErr(produced) && produced.error.code).toBe('forbidden');
    expect(deps.calls).toEqual([]);
  });

  it('refuses a document that is not of the Photograph kind', async () => {
    const other = await addPhoto('EMPLOYMENT_CERTIFICATE', 'CLEAN', 'APPROVED');
    const download = await gate(ownerId, 'DOWNLOAD_REDACTED', other);
    if (!isOk(download)) throw new Error('gate');
    const deps = fakeDeps();
    const produced = await produceVisaPhotoSize(download.value, deps, {
      specId: 'us-2x2',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isErr(produced) && produced.error.code).toBe('invalid');
    expect(deps.calls).toEqual([]);
  });

  it('refuses a photo still being checked, before reading any bytes, and audits the refusal', async () => {
    const pending = await addPhoto('PHOTO', 'PENDING', 'SCANNING');
    const preview = await gate(ownerId, 'PREVIEW', pending);
    if (!isOk(preview)) throw new Error('gate');
    const deps = fakeDeps();
    const checked = await checkVisaPhoto(preview.value, deps);
    expect(isErr(checked) && checked.error.code).toBe('forbidden');
    expect(deps.calls).toEqual([]);
    const [audit] = await photoAudits(pending);
    expect(audit?.result).toBe('DENIED');
    expect(audit?.reason).toBe('not_yet_safe_to_serve');
  });

  it('refuses an unknown size and a stored file that is not a JPEG or PNG', async () => {
    const download = await gate(ownerId, 'DOWNLOAD_REDACTED');
    if (!isOk(download)) throw new Error('gate');
    const unknown = await produceVisaPhotoSize(download.value, fakeDeps(), {
      specId: 'made-up',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isErr(unknown) && unknown.error.code).toBe('invalid');
    const pdf = fakeDeps('application/pdf');
    const wrongType = await produceVisaPhotoSize(download.value, pdf, {
      specId: 'us-2x2',
      crop: { offsetX: 0, offsetY: 0, zoom: 1 },
    });
    expect(isErr(wrongType) && wrongType.error.code).toBe('invalid');
    expect(pdf.calls).toEqual(['getObject']);
  });

  it('rate-limits checks and sizes per person', async () => {
    const preview = await gate(ownerId, 'PREVIEW');
    if (!isOk(preview)) throw new Error('gate');
    const windowStart = new Date(
      Math.floor(Date.now() / RATE_LIMITS.PHOTO_SIZE.windowMs) * RATE_LIMITS.PHOTO_SIZE.windowMs,
    );
    await db.insert(schema.rateLimitBuckets).values({
      subjectId: ownerId,
      action: 'photo_size.read',
      windowStart,
      count: RATE_LIMITS.PHOTO_SIZE.limit,
    });
    const deps = fakeDeps();
    const checked = await checkVisaPhoto(preview.value, deps);
    expect(isErr(checked) && checked.error.code).toBe('rate_limited');
    expect(deps.calls).toEqual([]);
  });
});
