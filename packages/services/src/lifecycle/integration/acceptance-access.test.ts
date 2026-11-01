// PROGRAMME section 8, row "Access" (all lanes): the owner may use every lifecycle command; every
// other actor is refused, at the gate or by the command; guessed and malformed ids read the same.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Result } from '@visastack/core';
import { schema } from '@visastack/db';
import { count, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, EACH_GRANT, requireAccess } from '../../access/require-access';
import { aiToolsFor } from '../../ai-tools';
import type { Db } from '../../db';
import type { ServiceError } from '../../errors';
import { acceptGrant, createGrant } from '../../sharing';
import { archiveDocument, restoreDocument } from '../archive';
import { listDeletionReceipts } from '../foundation';
import {
  deleteDuplicate,
  previewDeleteDuplicate,
  restoreDeleted,
  undoDelete,
} from '../recently-deleted';
import { cancelRemovalRequest, requestRemoval } from '../removal-requests';
import { listReplacementOptions, replaceDocument } from '../replace';
import {
  archiveTraveller,
  deleteEmptyTraveller,
  getTravellerManageView,
  restoreTraveller,
} from '../travellers';
import {
  JOURNEY_TIMEOUT,
  type JourneyOwner,
  SHA_A,
  SHA_B,
  SHA_C,
  addTraveller,
  daysAfter,
  freshJourneyDb,
  openCase,
  ownerProof,
  seedAccount,
  seedAgencyWithGrant,
  seedOwner,
  uploadDocument,
} from './journey-helpers.test-support';

type Manage = AuthorizedApplicant<'MANAGE'>;

/**
 * Every lifecycle command, Restore and Undo included, gives a guessed, malformed or another
 * person's id the same not-found (lane Z fixed `restoreDeleted`, which used to answer `invalid`).
 */
type Outcome = Result<unknown, ServiceError>;

interface Fixture {
  readonly db: Db;
  readonly owner: JourneyOwner;
  readonly familyId: string;
  readonly duplicate: string;
  readonly unique: string;
  readonly newer: string;
  readonly requested: string;
  readonly requestId: string;
  readonly missionId: string;
}

/** Every lifecycle command that names a document or request, with the ids it is aimed at. */
function documentCommands(ids: {
  readonly duplicate: string;
  readonly unique: string;
  readonly newer: string;
  readonly requestId: string;
}): ReadonlyArray<readonly [string, (proof: Manage) => Promise<Outcome>]> {
  return [
    ['archive', (p) => archiveDocument(ids.duplicate, p)],
    ['restore', (p) => restoreDocument(ids.duplicate, p)],
    ['delete duplicate', (p) => deleteDuplicate(p, { documentId: ids.duplicate })],
    ['preview delete', (p) => previewDeleteDuplicate(p, { documentId: ids.duplicate })],
    ['undo', (p) => undoDelete(p, { documentId: ids.duplicate })],
    ['restore deleted', (p) => restoreDeleted(p, { documentId: ids.duplicate })],
    ['request removal', (p) => requestRemoval(p, { documentId: ids.unique, reason: 'OTHER' })],
    ['cancel request', (p) => cancelRemovalRequest(p, ids.requestId)],
    ['replace', (p) => replaceDocument(p, { oldDocumentId: ids.unique, newDocumentId: ids.newer })],
    ['replacement options', (p) => listReplacementOptions(p, { oldDocumentId: ids.unique })],
  ];
}

/** The traveller commands act on the proof's own record. */
const TRAVELLER_COMMANDS: ReadonlyArray<readonly [string, (proof: Manage) => Promise<Outcome>]> = [
  ['archive traveller', (p) => archiveTraveller(p)],
  ['restore traveller', (p) => restoreTraveller(p)],
  ['remove empty traveller', (p) => deleteEmptyTraveller(p)],
  ['traveller manage view', (p) => getTravellerManageView(p)],
];

async function lifecycleRowCounts(db: Db): Promise<number[]> {
  const tables = [
    schema.documentLifecycle,
    schema.applicantLifecycle,
    schema.documentRemovalRequests,
    schema.deletionReceipts,
  ] as const;
  const counts: number[] = [];
  for (const table of tables) {
    const [row] = await db.select({ n: count() }).from(table);
    counts.push(row?.n ?? -1);
  }
  return counts;
}

async function gate(db: Db, accountId: string, applicantId: string) {
  return requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: EACH_GRANT },
  );
}

async function expectAllRefused(f: Fixture, label: string, proof: Manage): Promise<void> {
  const before = await lifecycleRowCounts(f.db);
  for (const [name, run] of [...documentCommands(f), ...TRAVELLER_COMMANDS]) {
    const outcome = await run(proof);
    expect(outcome.ok, `${label}: ${name}`).toBe(false);
  }
  const view = proof as unknown as AuthorizedApplicant<'VIEW_METADATA'>;
  expect((await listDeletionReceipts(view)).ok, `${label}: removal records`).toBe(false);
  expect(await lifecycleRowCounts(f.db), `${label}: nothing written`).toEqual(before);
}

describe('Access', () => {
  let f: Fixture;
  beforeAll(async () => {
    const { db } = await freshJourneyDb();
    const owner = await seedOwner(db, 'lcz-access-owner@example.com');
    const familyId = await addTraveller(db, owner.accountId, { relationship: 'FAMILY_MEMBER' });
    await uploadDocument(db, owner, { sha: SHA_A, docType: 'passport' });
    const duplicate = (await uploadDocument(db, owner, { sha: SHA_A, docType: 'passport' }))
      .documentId;
    const unique = (await uploadDocument(db, owner, { sha: SHA_B, docType: 'bank_statement' }))
      .documentId;
    const newer = (await uploadDocument(db, owner, { sha: SHA_C, docType: 'bank_statement' }))
      .documentId;
    const requested = (await uploadDocument(db, owner, { sha: 'd'.repeat(64) })).documentId;
    const asked = await requestRemoval(await ownerProof(db, owner), {
      documentId: requested,
      reason: 'NO_LONGER_NEEDED',
    });
    if (!asked.ok) throw new Error('request');
    const { missionId } = await openCase(db, owner, {
      documentId: unique,
      docType: 'bank_statement',
    });
    f = {
      db,
      owner,
      familyId,
      duplicate,
      unique,
      newer,
      requested,
      requestId: asked.value.id,
      missionId,
    };
  }, JOURNEY_TIMEOUT);

  it(
    'allows the owner every lifecycle command and the Removal Records',
    async () => {
      const proof = await ownerProof(f.db, f.owner);
      expect((await previewDeleteDuplicate(proof, { documentId: f.duplicate })).ok).toBe(true);
      expect((await listReplacementOptions(proof, { oldDocumentId: f.unique })).ok).toBe(true);
      expect((await archiveDocument(f.duplicate, proof)).ok).toBe(true);
      expect((await restoreDocument(f.duplicate, proof)).ok).toBe(true);
      const family = await ownerProof(f.db, {
        accountId: f.owner.accountId,
        applicantId: f.familyId,
      });
      expect((await getTravellerManageView(family)).ok).toBe(true);
      expect((await archiveTraveller(family)).ok).toBe(true);
      expect((await restoreTraveller(family)).ok).toBe(true);
      expect(
        (await listDeletionReceipts(await ownerProof(f.db, f.owner, 'VIEW_METADATA'))).ok,
      ).toBe(true);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses at the gate: a stranger, another agency, a recipient without a grant, revoked and expired grants, an inactive agency',
    async () => {
      const { db, owner } = f;
      const stranger = await seedAccount(db, 'lcz-access-stranger@example.com');
      const noGrant = await seedAccount(db, 'lcz-access-recipient@example.com');
      const agencyA = await seedAgencyWithGrant(
        db,
        await seedOwner(db, 'lcz-other-person@example.com'),
      );
      await seedAgencyWithGrant(db, owner); // agency B holds the grant, agency A does not
      const revoked = await seedAgencyWithGrant(db, owner);
      await db
        .update(schema.grants)
        .set({ status: 'REVOKED' })
        .where(eq(schema.grants.id, revoked.grantId));
      const expired = await seedAgencyWithGrant(db, owner);
      await db
        .update(schema.grants)
        .set({ expiryAt: daysAfter(new Date(), -1) })
        .where(eq(schema.grants.id, expired.grantId));
      const inactive = await seedAgencyWithGrant(db, owner, { active: false });
      const actors: ReadonlyArray<readonly [string, string]> = [
        ['stranger', stranger],
        ['agency A on agency B', agencyA.agentAccountId],
        ['recipient without a grant', noGrant],
        ['revoked grant', revoked.agentAccountId],
        ['expired grant', expired.agentAccountId],
        ['inactive agency', inactive.agentAccountId],
      ];
      for (const [label, accountId] of actors) {
        for (const applicantId of [owner.applicantId, f.familyId]) {
          expect((await gate(db, accountId, applicantId)).ok, label).toBe(false);
        }
        const byDocument = await requireAccess(
          db,
          accountPrincipal(accountId),
          'MANAGE',
          { documentId: f.duplicate },
          { purpose: EACH_GRANT },
        );
        expect(byDocument.ok, `${label} by document`).toBe(false);
      }
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'refuses in the command: an agency with a MANAGE grant, a recipient with a read grant, a read-level owner proof, a contributor',
    async () => {
      const { db, owner } = f;
      const agency = await seedAgencyWithGrant(db, owner, { actions: ['VIEW_METADATA', 'MANAGE'] });
      const agencyProof = await gate(db, agency.agentAccountId, owner.applicantId);
      if (!agencyProof.ok) throw new Error('agency proof');
      expect(agencyProof.value.actor.kind).toBe('organization_member');
      await expectAllRefused(f, 'agency with grant', agencyProof.value);

      const reader = await seedAccount(db, 'lcz-access-reader@example.com');
      const grant = await createGrant(db, {
        actorAccountId: owner.accountId,
        applicantId: owner.applicantId,
        recipientAccountId: reader,
        actions: ['VIEW_METADATA'],
        purpose: 'review',
      });
      if (!grant.ok) throw new Error(`grant: ${grant.error.code}`);
      await acceptGrant(db, { actorAccountId: reader, grantId: grant.value.id });
      expect((await gate(db, reader, owner.applicantId)).ok).toBe(false);
      const readerView = await requireAccess(
        db,
        accountPrincipal(reader),
        'VIEW_METADATA',
        { applicantId: owner.applicantId },
        { purpose: EACH_GRANT },
      );
      if (!readerView.ok) throw new Error(`reader view: ${readerView.error.code}`);
      await expectAllRefused(f, 'recipient with read grant', readerView.value as unknown as Manage);

      const ownerView = await ownerProof(db, owner, 'VIEW_METADATA');
      const before = await lifecycleRowCounts(db);
      for (const [name, run] of [...documentCommands(f), ...TRAVELLER_COMMANDS]) {
        expect((await run(ownerView as unknown as Manage)).ok, `read-level: ${name}`).toBe(false);
      }
      expect(await lifecycleRowCounts(db)).toEqual(before);

      // A contributor with a claimed, in-flight request for the case.
      const contributor = await seedAccount(db, 'lcz-access-contributor@example.com');
      const [request] = await db
        .insert(schema.contributorRequests)
        .values({
          missionId: f.missionId,
          applicantId: owner.applicantId,
          contributorEmail: 'lcz-access-contributor@example.com',
          docType: 'bank_statement',
          purpose: 'sponsor',
          tokenHash: 'lcz-synthetic-token-hash',
          expiresAt: daysAfter(new Date(), 3),
          status: 'SUBMITTED',
          contributorAccountId: contributor,
          submittedAt: new Date(),
        })
        .returning({ id: schema.contributorRequests.id });
      if (!request) throw new Error('contributor request');
      const contributorGate = await requireAccess(
        db,
        accountPrincipal(contributor),
        'MANAGE',
        { missionId: f.missionId },
        { purpose: EACH_GRANT, contributorRequestId: request.id },
      );
      expect(contributorGate.ok).toBe(false);
      const proposal = await requireAccess(
        db,
        accountPrincipal(contributor),
        'PROPOSE_EDIT',
        { missionId: f.missionId },
        { purpose: EACH_GRANT, contributorRequestId: request.id },
      );
      if (!proposal.ok) throw new Error(`contributor proof: ${proposal.error.code}`);
      expect(proposal.value.actor.kind).toBe('contributor');
      await expectAllRefused(f, 'contributor', proposal.value as unknown as Manage);
    },
    JOURNEY_TIMEOUT,
  );

  it(
    'offers no lifecycle command to an AI tool',
    async () => {
      const names = [...aiToolsFor('OWNER'), ...aiToolsFor('AGENCY')].map((tool) => tool.name);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name, name).not.toMatch(/archiv|delete|remov|replac|restor|purge|erase|destroy/);
      }
      const folder = fileURLToPath(new URL('../../ai-tools/', import.meta.url));
      const commandModules =
        /from '\.\.\/lifecycle\/(archive|recently-deleted|removal-requests|replace|travellers|duplicates)/;
      for (const entry of await readdir(folder)) {
        if (!entry.endsWith('.ts') || /\.test(-support)?\.ts$/.test(entry)) continue;
        const source = await readFile(`${folder}${entry}`, 'utf8');
        expect(commandModules.test(source), entry).toBe(false);
      }
    },
    JOURNEY_TIMEOUT,
  );

  it(
    "gives a guessed id, a malformed id and another person's real id the same not-found",
    async () => {
      const { db, owner } = f;
      const proof = await ownerProof(db, owner);
      const other = await seedOwner(db, 'lcz-access-neighbour@example.com');
      const theirs = await uploadDocument(db, other, { sha: SHA_A });
      const guessed = '3f2b8c1e-9d4a-4e7b-8a6c-1b2d3e4f5a6b';
      const variants: ReadonlyArray<readonly [string, string]> = [
        ['guessed', guessed],
        ['malformed', 'not-a-uuid'],
        ['path-like', '../../etc/passwd'],
        ['empty', ''],
        ["another person's", theirs.documentId],
      ];
      const before = await lifecycleRowCounts(db);
      for (const [name] of documentCommands(f)) {
        const answers = new Map<string, string>();
        for (const [variant, id] of variants) {
          const aimed = documentCommands({
            duplicate: id,
            unique: id,
            newer: f.newer,
            requestId: id,
          });
          const run = aimed.find(([n]) => n === name)?.[1];
          if (!run) throw new Error(name);
          const outcome = await run(proof);
          expect(outcome.ok, `${variant}: ${name}`).toBe(false);
          if (!outcome.ok) answers.set(variant, `${outcome.error.code}: ${outcome.error.message}`);
        }
        // The same not-found, word for word, whatever the id was.
        expect(new Set(answers.values()).size, `${name}: ${[...answers.values()]}`).toBe(1);
        expect(answers.get('guessed'), name).toMatch(/^not_found: /);
      }
      expect(await lifecycleRowCounts(db)).toEqual(before);
    },
    JOURNEY_TIMEOUT,
  );
});
