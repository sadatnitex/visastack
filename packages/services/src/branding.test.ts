import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  MAX_LOGO_BYTES,
  contrastRatio,
  getOrganizationBrandingForDisplay,
  isAccessibleAccentColor,
  relativeLuminance,
  removeOrganizationLogo,
  updateOrganizationBranding,
  uploadOrganizationLogo,
} from './branding';
import type { Db } from './db';
import type { MalwareScannerPort } from './intake';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import type {
  AccessRef,
  BlobStore,
  IssueReadRefInput,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoragePort,
  StoredBytes,
} from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

async function seedOrganization(db: Db, tag: string) {
  const ownerAcc = await provisionAccount(db, { email: `org-owner-${tag}@acme.com` });
  if (!isOk(ownerAcc)) throw new Error('provision');
  const org = await createOrganization(db, {
    actorAccountId: ownerAcc.value.id,
    name: `Acme ${tag}`,
  });
  if (!isOk(org)) throw new Error('org');
  await activateOrg(db, org.value.id);
  return { organizationId: org.value.id, ownerAccountId: ownerAcc.value.id };
}

class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(input: { readonly bucket: StorageBucket }): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()].filter(() => input.bucket), cursor: undefined };
  }
  has(objectKey: string): boolean {
    return this.objects.has(objectKey);
  }
}

class FakeStoragePort implements StoragePort {
  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    return {
      url: `https://blob.test/${input.bucket}/${input.objectKey}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}

const cleanScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
const infectedScanner: MalwareScannerPort = {
  name: 'test-scanner',
  version: '0.0.0',
  async scan() {
    return { safe: false, detail: 'eicar' };
  },
};

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

describe('WCAG contrast math (COM-04)', () => {
  it('computes known reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepts colors with sufficient contrast against white, rejects pale/light ones', () => {
    expect(isAccessibleAccentColor('#000000')).toBe(true); // ~21:1
    expect(isAccessibleAccentColor('#0000ff')).toBe(true); // ~8.6:1
    expect(isAccessibleAccentColor('#ff0000')).toBe(false); // ~4.0:1, below the 4.5 AA floor
    expect(isAccessibleAccentColor('#cccccc')).toBe(false); // ~1.6:1
  });

  it('rejects a malformed hex string outright, regardless of contrast', () => {
    expect(isAccessibleAccentColor('blue')).toBe(false);
    expect(isAccessibleAccentColor('#000')).toBe(false);
    expect(isAccessibleAccentColor('#00000')).toBe(false);
    expect(isAccessibleAccentColor('#gggggg')).toBe(false);
  });
});

describe('updateOrganizationBranding (COM-04)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('refuses a non-admin member and a stranger -- owner/admin self-service, not platform-admin', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'auth');
    const staff = await provisionAccount(db, { email: 'staff-branding@acme.com' });
    if (!isOk(staff)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accountId: staff.value.id,
      role: 'CASE_MANAGER',
    });

    const byStaff = await updateOrganizationBranding(db, {
      actorAccountId: staff.value.id,
      organizationId,
      name: 'New Name',
    });
    expect(isErr(byStaff)).toBe(true);
    if (isErr(byStaff)) expect(byStaff.error.code).toBe('forbidden');

    const stranger = await provisionAccount(db, { email: 'stranger-branding@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const byStranger = await updateOrganizationBranding(db, {
      actorAccountId: stranger.value.id,
      organizationId,
      name: 'New Name',
    });
    expect(isErr(byStranger)).toBe(true);
    if (isErr(byStranger)) expect(byStranger.error.code).toBe('forbidden');
  });

  it('updates the name, audited, only touching fields explicitly passed', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'rename');
    const updated = await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      name: 'Acme Visas Ltd',
    });
    expect(isOk(updated)).toBe(true);
    if (isOk(updated)) {
      expect(updated.value.name).toBe('Acme Visas Ltd');
      expect(updated.value.accentColor).toBeNull();
    }
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'ORGANIZATION_BRANDING_UPDATED'));
    expect(events).toHaveLength(1);
  });

  it('refuses a blank name', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'blank');
    const result = await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      name: '   ',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('sets an accessible accent color, refuses an inaccessible one, and clears it with null', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'color');
    const inaccessible = await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accentColor: '#ff0000',
    });
    expect(isErr(inaccessible)).toBe(true);
    if (isErr(inaccessible)) expect(inaccessible.error.code).toBe('invalid');

    const set = await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accentColor: '#0000ff',
    });
    expect(isOk(set)).toBe(true);
    if (isOk(set)) expect(set.value.accentColor).toBe('#0000ff');

    const cleared = await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accentColor: null,
    });
    expect(isOk(cleared)).toBe(true);
    if (isOk(cleared)) expect(cleared.value.accentColor).toBeNull();
  });

  it('is a no-op success, with no new audit event, when nothing actually changes', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'noop');
    const same = await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      name: 'Acme noop',
    });
    expect(isOk(same)).toBe(true);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'ORGANIZATION_BRANDING_UPDATED'));
    expect(events).toHaveLength(0);
  });
});

describe('uploadOrganizationLogo / removeOrganizationLogo (COM-04)', () => {
  let db: Db;
  let storage: FakeBlobStore;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeBlobStore();
  });

  it('refuses a non-admin and requires an org OWNER/ADMIN', async () => {
    const { organizationId } = await seedOrganization(db, 'logo-auth');
    const stranger = await provisionAccount(db, { email: 'stranger-logo@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: stranger.value.id,
      organizationId,
      contentType: 'image/png',
      bytes: PNG_MAGIC,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('refuses a disallowed content type and an oversized image', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'logo-valid');
    const badType = await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/svg+xml',
      bytes: PNG_MAGIC,
    });
    expect(isErr(badType)).toBe(true);
    if (isErr(badType)) expect(badType.error.code).toBe('invalid');

    const tooBig = await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/png',
      bytes: new Uint8Array(MAX_LOGO_BYTES + 1),
    });
    expect(isErr(tooBig)).toBe(true);
    if (isErr(tooBig)) expect(tooBig.error.code).toBe('invalid');
  });

  it('refuses an unsafe image and never attaches it to the organization', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'logo-unsafe');
    const result = await uploadOrganizationLogo(db, storage, infectedScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/png',
      bytes: PNG_MAGIC,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');

    const rows = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
    expect(rows[0]?.logoObjectKey).toBeNull();
  });

  it('uploads a safe logo, audited, and replacing it deletes the previous blob', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'logo-upload');
    const first = await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/png',
      bytes: PNG_MAGIC,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    const firstKey = first.value.logoObjectKey;
    expect(firstKey).not.toBeNull();
    if (!firstKey) return;
    expect(storage.has(firstKey)).toBe(true);

    const second = await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/jpeg',
      bytes: JPEG_MAGIC,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.logoObjectKey).not.toBe(firstKey);
    expect(storage.has(firstKey)).toBe(false); // old blob cleaned up
    expect(storage.has(second.value.logoObjectKey ?? '')).toBe(true);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'ORGANIZATION_LOGO_UPDATED'));
    expect(events).toHaveLength(2);
  });

  it('removeOrganizationLogo deletes the blob and clears the fields, idempotent when none is set', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'logo-remove');
    const noop = await removeOrganizationLogo(db, storage, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(noop)).toBe(true);

    const uploaded = await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/png',
      bytes: PNG_MAGIC,
    });
    if (!isOk(uploaded)) throw new Error('upload');
    const key = uploaded.value.logoObjectKey;
    if (!key) throw new Error('key');

    const removed = await removeOrganizationLogo(db, storage, {
      actorAccountId: ownerAccountId,
      organizationId,
    });
    expect(isOk(removed)).toBe(true);
    if (isOk(removed)) {
      expect(removed.value.logoObjectKey).toBeNull();
      expect(removed.value.logoContentType).toBeNull();
    }
    expect(storage.has(key)).toBe(false);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'ORGANIZATION_LOGO_REMOVED'));
    expect(events).toHaveLength(1);
  });
});

describe('getOrganizationBrandingForDisplay -- and tenant isolation (COM-04, A28)', () => {
  let db: Db;
  let storage: FakeBlobStore;
  let storagePort: FakeStoragePort;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeBlobStore();
    storagePort = new FakeStoragePort();
  });

  it('returns the name with null accentColor/logoUrl when nothing has been set', async () => {
    const { organizationId } = await seedOrganization(db, 'display-default');
    const branding = await getOrganizationBrandingForDisplay(db, storagePort, organizationId);
    expect(branding?.name).toBe('Acme display-default');
    expect(branding?.accentColor).toBeNull();
    expect(branding?.logoUrl).toBeNull();
  });

  it('returns undefined for an unknown organization', async () => {
    const branding = await getOrganizationBrandingForDisplay(
      db,
      storagePort,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(branding).toBeUndefined();
  });

  it('reflects a set accent color and mints a fresh logo reference once a logo exists', async () => {
    const { organizationId, ownerAccountId } = await seedOrganization(db, 'display-set');
    await updateOrganizationBranding(db, {
      actorAccountId: ownerAccountId,
      organizationId,
      accentColor: '#0000ff',
    });
    await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: ownerAccountId,
      organizationId,
      contentType: 'image/png',
      bytes: PNG_MAGIC,
    });
    const branding = await getOrganizationBrandingForDisplay(db, storagePort, organizationId);
    expect(branding?.accentColor).toBe('#0000ff');
    expect(branding?.logoUrl).toContain('QUARANTINE');
  });

  it('never leaks one organization\'s branding into another\'s -- "Agency A branding can never appear in Agency B context"', async () => {
    const orgA = await seedOrganization(db, 'iso-a');
    const orgB = await seedOrganization(db, 'iso-b');
    await updateOrganizationBranding(db, {
      actorAccountId: orgA.ownerAccountId,
      organizationId: orgA.organizationId,
      name: 'Agency A',
      accentColor: '#0000ff',
    });
    await uploadOrganizationLogo(db, storage, cleanScanner, {
      actorAccountId: orgA.ownerAccountId,
      organizationId: orgA.organizationId,
      contentType: 'image/png',
      bytes: PNG_MAGIC,
    });
    await updateOrganizationBranding(db, {
      actorAccountId: orgB.ownerAccountId,
      organizationId: orgB.organizationId,
      name: 'Agency B',
      accentColor: '#000000',
    });

    const brandingA = await getOrganizationBrandingForDisplay(db, storagePort, orgA.organizationId);
    const brandingB = await getOrganizationBrandingForDisplay(db, storagePort, orgB.organizationId);
    expect(brandingA?.name).toBe('Agency A');
    expect(brandingA?.accentColor).toBe('#0000ff');
    expect(brandingA?.logoUrl).not.toBeNull();
    expect(brandingB?.name).toBe('Agency B');
    expect(brandingB?.accentColor).toBe('#000000');
    expect(brandingB?.logoUrl).toBeNull(); // B never uploaded a logo -- never inherits A's
  });
});
