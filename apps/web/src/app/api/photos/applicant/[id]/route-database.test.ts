import { createHash } from 'node:crypto';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { type Db, createApplicant, provisionAccount, setConsent } from '@visastack/services';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The photo route and the page photo loaders against a real database, including the window
 * after a deployment and before migration 0088 has created the photo table (WP-PH1).
 */

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  accountId: '',
  objects: new Map<string, { contentType: string; bytes: Uint8Array }>(),
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: { db: unknown; accountId: string }) => unknown) =>
    fn({ db: state.db, accountId: state.accountId }),
}));
vi.mock('../../../../../lib/storage', () => ({
  createStorage: () => ({ getObject: async (key: string) => state.objects.get(key) }),
}));
vi.mock('../../../../../lib/providers', () => ({ createMalwareScanner: () => ({}) }));

const { GET } = await import('./route');
const { loadOwnedTravellers, ownedPhotoUrl } = await import('../../../../../lib/profile-photos');

let db: Db;
let applicantId: string;

const call = (id = applicantId) =>
  GET(new Request(`https://example.test/api/photos/applicant/${id}`), {
    params: Promise.resolve({ id }),
  });

async function givePhoto(): Promise<Uint8Array> {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 7, 7, 7]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const [object] = await db
    .insert(schema.storageObjects)
    .values({ bucket: 'CLEAN', objectKey: 'profile-photo-x', sizeBytes: 7, contentHash: sha })
    .returning();
  if (!object) throw new Error('object');
  await db
    .insert(schema.applicantPhotos)
    .values({ applicantId, storageObjectId: object.id, contentSha256: sha, sizeBytes: 7 });
  state.objects.set('profile-photo-x', { contentType: 'image/jpeg', bytes });
  return bytes;
}

beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  state.db = db;
  state.objects.clear();
  const account = await provisionAccount(db, { email: 'owner@example.com' });
  if (!account.ok) throw new Error('account');
  state.accountId = account.value.id;
  await setConsent(db, {
    actorAccountId: state.accountId,
    accountId: state.accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: state.accountId,
    ownerAccountId: state.accountId,
    displayName: 'Rahima Akter',
  });
  if (!applicant.ok) throw new Error('applicant');
  applicantId = applicant.value.id;
}, 60_000);

describe('the photo route and loaders on a real database', () => {
  it('serves the owner their photo, and nobody else', async () => {
    const bytes = await givePhoto();
    const response = await call();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(await ownedPhotoUrl(db, state.accountId, applicantId)).toMatch(
      new RegExp(`^/api/photos/applicant/${applicantId}\\?v=[0-9a-f]{16}$`),
    );
    const stranger = await provisionAccount(db, { email: 'stranger@example.com' });
    if (!stranger.ok) throw new Error('stranger');
    state.accountId = stranger.value.id;
    expect((await call()).status).toBe(404);
  });

  it('answers "no photo" (404, initials), never an error, before the photo table exists', async () => {
    await db.execute(sql`drop table applicant_photos`);
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const owned = await loadOwnedTravellers(db, state.accountId);
    expect(owned.people.map((person) => person.id)).toEqual([applicantId]);
    expect(owned.photos.size).toBe(0);
    expect(await ownedPhotoUrl(db, state.accountId, applicantId)).toBeNull();
  });
});
