import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  listPackVersions,
  listPacks,
  publishPackVersion,
  verifyPackChecksum,
} from './packs';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function authorId(db: Db): Promise<string> {
  const p = await provisionAccount(db, { email: 'author@example.com' });
  if (!isOk(p)) throw new Error('provision');
  return p.value.id;
}

describe('Pack Studio — versioned, cited, admin-approved requirement packs', () => {
  let db: Db;
  let actor: string;
  beforeEach(async () => {
    db = await freshDb();
    actor = await authorId(db);
  });

  async function draftWithRequirement() {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key: 'uk.tourist',
      name: 'UK Tourist',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'UK Immigration Rules Appendix V 4.2',
    });
    if (!isOk(req)) throw new Error('req');
    return version.value.id;
  }

  it('opens sequential versions', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'p1', name: 'P1' });
    if (!isOk(pack)) throw new Error('pack');
    const v1 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    const v2 = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    expect(isOk(v1) && isOk(v2)).toBe(true);
    if (!isOk(v1) || !isOk(v2)) return;
    expect(v1.value.version).toBe(1);
    expect(v2.value.version).toBe(2);
  });

  it('lists packs and pack versions (highest version first)', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'pv', name: 'PV' });
    if (!isOk(pack)) throw new Error('pack');
    await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });

    const packs = await listPacks(db);
    expect(packs.map((p) => p.key)).toContain('pv');

    const versions = await listPackVersions(db, pack.value.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it('rejects a requirement with no citation', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'p2', name: 'P2' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const req = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: '   ',
    });
    expect(isErr(req)).toBe(true);
    if (isErr(req)) expect(req.error.code).toBe('invalid');
  });

  it('approves (freezing a checksum), then publishes; content then frozen', async () => {
    const versionId = await draftWithRequirement();

    const approved = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(approved)).toBe(true);
    if (!isOk(approved)) return;
    expect(approved.value.status).toBe('APPROVED');
    expect(approved.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPackChecksum(db, versionId)).toBe(true);

    // No more requirement edits once out of DRAFT.
    const late = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: versionId,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'x',
    });
    expect(isErr(late)).toBe(true);

    const published = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: versionId,
    });
    expect(isOk(published)).toBe(true);
    if (isOk(published)) expect(published.value.status).toBe('PUBLISHED');
  });

  it('refuses to approve an empty version and to publish an unapproved one', async () => {
    const pack = await createPack(db, { actorAccountId: actor, key: 'p3', name: 'P3' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');

    const approveEmpty = await approvePackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    expect(isErr(approveEmpty)).toBe(true);

    const publishUnapproved = await publishPackVersion(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
    });
    expect(isErr(publishUnapproved)).toBe(true);
    if (isErr(publishUnapproved)) expect(publishUnapproved.error.code).toBe('invalid');
  });
});
