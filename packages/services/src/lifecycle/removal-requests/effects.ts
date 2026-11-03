import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { withCaseExclusions } from '../../access/grant-scope';
import { type Db, schema } from '../../db';
import { incrementMaterialRevision } from '../../material-revision';
import { createTask } from '../../missions';
import { enqueueNotification } from '../../notifications';
import {
  type LifecycleAccess,
  lifecycleAccessCovers,
  lifecycleCommandCovers,
} from '../foundation/access';
import { FINISHED_CASE_STATES_FOR_REPLACE } from '../replace/replace';

/*
 * What removing one document changes for everyone else, shared by the two ways a document is
 * removed for good: support approving Ask Us to Remove This File (requests.ts) and the owner's
 * own Delete My File (self-delete.ts). One rule in one place, so the two paths cannot drift: the
 * same open cases lose the selection, get the same task and revision bump, and the same agencies
 * are told, never with the document's name.
 */

/**
 * Case states that are over (owner decision D5: closed, cancelled, submitted). A removal leaves
 * them exactly as they were: their snapshot stays, their selection is never edited here.
 */
export const FINISHED_CASE_STATES_FOR_REMOVAL = FINISHED_CASE_STATES_FOR_REPLACE;

/** What removing one document changes. The queue preview and the receipt read the same counts. */
export interface RemovalImpact {
  /** Open cases that selected the document: each loses the selection and gets a task. */
  readonly openCaseIds: readonly string[];
  /** Finished cases that selected it: their snapshots stay as they are. */
  readonly finishedCases: number;
  /**
   * For each open case, the agencies that can see it: an active, started, unexpired grant to the
   * agency that reaches the case (a grant for that case, or an all-cases grant without an
   * exception for it), the same rule the agency's own case list uses.
   */
  readonly agenciesByCase: ReadonlyMap<string, readonly string[]>;
  /** Active, unexpired shares that name this document. */
  readonly sharesAffected: number;
  /** Stored bytes the removal frees once every file is verified gone. */
  readonly storageBytes: number;
}

/**
 * The impact of removing `documentId` of `applicantId`, read through `db` (a transaction during
 * a removal, so the counts match what is changed). `access` is any genuine proof for that
 * traveller, a lifecycle job or fresh staff; anything else is refused.
 */
export async function removalImpact(
  db: Db,
  applicantId: string,
  documentId: string,
  now: Date,
  access: LifecycleAccess,
): Promise<RemovalImpact> {
  if (!lifecycleAccessCovers(access, applicantId)) {
    throw new Error('removal impact: this access does not cover that traveller');
  }
  const cases = await db
    .selectDistinct({ missionId: schema.missions.id, state: schema.missions.state })
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(
      and(
        eq(schema.selectedEvidence.documentId, documentId),
        eq(schema.missions.applicantId, applicantId),
      ),
    );
  const finished: ReadonlySet<string> = new Set(FINISHED_CASE_STATES_FOR_REMOVAL);
  const open = cases
    .filter((row) => !finished.has(row.state))
    .sort((a, b) => a.missionId.localeCompare(b.missionId));
  const openCaseIds = open.map((row) => row.missionId);

  const liveGrant = and(
    eq(schema.grants.applicantId, applicantId),
    eq(schema.grants.status, 'ACTIVE'),
    lte(schema.grants.startAt, now),
    or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
  );
  const agenciesByCase = new Map<string, readonly string[]>();
  if (openCaseIds.length > 0) {
    await withCaseExclusions(db, async (covers) => {
      for (const missionId of openCaseIds) {
        const rows = await db
          .selectDistinct({ organizationId: schema.grants.recipientOrganizationId })
          .from(schema.grants)
          .where(and(liveGrant, covers(missionId)));
        agenciesByCase.set(
          missionId,
          rows.flatMap((row) => (row.organizationId ? [row.organizationId] : [])).sort(),
        );
      }
    });
  }

  const [shares] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.applicantId, applicantId),
        liveGrant,
        sql`${documentId}::uuid = any(${schema.grants.documentIds})`,
      ),
    );

  const [bytes] = await db
    .select({
      n: sql<number>`coalesce(sum(${schema.storageObjects.sizeBytes}), 0)::bigint`,
    })
    .from(schema.storageObjects)
    .where(
      inArray(
        schema.storageObjects.id,
        db
          .selectDistinct({ id: schema.documentVersions.storageObjectId })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId)),
      ),
    );

  return {
    openCaseIds,
    finishedCases: cases.length - open.length,
    agenciesByCase,
    sharesAffected: Number(shares?.n ?? 0),
    storageBytes: Number(bytes?.n ?? 0),
  };
}

export interface OpenCaseEffectsInput {
  readonly applicantId: string;
  readonly documentId: string;
  /** The record owner: the task's recorded author. */
  readonly ownerAccountId: string;
  readonly impact: RemovalImpact;
  /** What the case's task says; the person's own words for why they must choose again. */
  readonly taskDescription: string;
}

/**
 * Open cases lose the selection, get a task and a material revision bump (their confirmation no
 * longer stands). Finished cases are not touched: their snapshots stay exact. `access` must be
 * allowed to change this traveller's lifecycle records (the owner's own MANAGE proof, a lifecycle
 * job or fresh compliance staff); anything else is refused. Runs inside the caller's transaction.
 */
export async function applyOpenCaseEffects(
  tx: Db,
  input: OpenCaseEffectsInput,
  access: LifecycleAccess,
): Promise<void> {
  if (!lifecycleCommandCovers(access, input.applicantId)) {
    throw new Error('removal effects: this access may not change that traveller');
  }
  for (const missionId of input.impact.openCaseIds) {
    await tx
      .delete(schema.selectedEvidence)
      .where(
        and(
          eq(schema.selectedEvidence.missionId, missionId),
          eq(schema.selectedEvidence.documentId, input.documentId),
        ),
      );
    await incrementMaterialRevision(tx, missionId);
    // createTask is the one writer of case tasks (ai-tools/tool-guard.test.ts). It records the
    // record owner as the task's author; whoever caused the removal is named on the audit event
    // the caller writes, with the cases it touched.
    const task = await createTask(tx, {
      actorAccountId: input.ownerAccountId,
      missionId,
      description: input.taskDescription,
    });
    if (!task.ok) throw new Error(`removal: case task refused (${task.error.code})`);
  }
}

export interface TellAgenciesInput {
  readonly applicantId: string;
  /** The notice's resource: one removal's own id, so the same notice is never queued twice. */
  readonly resourceId: string;
  readonly ownerAccountId: string;
  readonly impact: RemovalImpact;
  /** Reference codes of the open cases, for the notice's words. */
  readonly caseCodes: ReadonlyMap<string, string>;
  /**
   * Agencies that were given this document by name but work no open case that used it: their
   * owners and admins are told too (Delete My File only; support's approval never did).
   */
  readonly otherOrganizationIds?: readonly string[];
}

/**
 * Agencies that can see an open case that used the document are told, never with its name, and
 * only the members who see that case: owners and admins, and members assigned to it (the same
 * rule as the agency's case list, listVisibleMissionsForMember). Returns the agencies told.
 * Runs inside the caller's transaction.
 */
export async function tellAgenciesOfRemoval(
  tx: Db,
  input: TellAgenciesInput,
  access: LifecycleAccess,
): Promise<ReadonlySet<string>> {
  if (!lifecycleCommandCovers(access, input.applicantId)) {
    throw new Error('removal notice: this access may not change that traveller');
  }
  const { impact, ownerAccountId } = input;
  const told = new Set<string>();
  const caseOrganizationIds = [...new Set([...impact.agenciesByCase.values()].flat())];
  const otherOrganizationIds = (input.otherOrganizationIds ?? []).filter(
    (id) => !caseOrganizationIds.includes(id),
  );
  const organizationIds = [...caseOrganizationIds, ...otherOrganizationIds];
  if (organizationIds.length === 0) return told;

  const members = await tx
    .select({
      accountId: schema.memberships.accountId,
      organizationId: schema.memberships.organizationId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(
      and(
        inArray(schema.memberships.organizationId, organizationIds),
        eq(schema.memberships.active, true),
        eq(schema.organizations.status, 'ACTIVE'),
      ),
    );
  if (caseOrganizationIds.length > 0) {
    const assigned = await tx
      .select({
        missionId: schema.assignments.missionId,
        organizationId: schema.assignments.organizationId,
        accountId: schema.assignments.memberAccountId,
      })
      .from(schema.assignments)
      .where(
        and(
          inArray(schema.assignments.organizationId, caseOrganizationIds),
          inArray(schema.assignments.missionId, impact.openCaseIds),
        ),
      );
    for (const [missionId, organizations] of impact.agenciesByCase) {
      const code = input.caseCodes.get(missionId);
      for (const member of members) {
        if (!organizations.includes(member.organizationId)) continue;
        if (member.accountId === ownerAccountId) continue;
        const seesCase =
          member.role === 'OWNER' ||
          member.role === 'ADMIN' ||
          assigned.some(
            (row) =>
              row.missionId === missionId &&
              row.organizationId === member.organizationId &&
              row.accountId === member.accountId,
          );
        if (!seesCase) continue;
        told.add(member.organizationId);
        await enqueueNotification(tx, {
          eventType: 'DOCUMENT_REMOVED_BY_TRAVELLER',
          channel: 'IN_APP',
          recipientAccountId: member.accountId,
          resourceId: input.resourceId,
          threshold: missionId,
          organizationId: member.organizationId,
          missionId,
          payload: {
            subject: 'A document was removed by the traveller',
            summary: `A document in case ${code ?? 'you work on'} was removed by the traveller. Ask them for another one if the case still needs it.`,
            deepLinkPath: `/app/agency/${member.organizationId}/cases`,
          },
        });
      }
    }
  }
  for (const member of members) {
    if (!otherOrganizationIds.includes(member.organizationId)) continue;
    if (member.accountId === ownerAccountId) continue;
    if (member.role !== 'OWNER' && member.role !== 'ADMIN') continue;
    told.add(member.organizationId);
    await enqueueNotification(tx, {
      eventType: 'DOCUMENT_REMOVED_BY_TRAVELLER',
      channel: 'IN_APP',
      recipientAccountId: member.accountId,
      resourceId: input.resourceId,
      threshold: 'shared',
      organizationId: member.organizationId,
      payload: {
        subject: 'A document was removed by the traveller',
        summary:
          'A document the traveller shared with your agency was removed by the traveller. Ask them for another one if you still need it.',
        deepLinkPath: `/app/agency/${member.organizationId}/cases`,
      },
    });
  }
  return told;
}

/**
 * How a Removal Record names who added the document (a role, never a name): a contributor's
 * hand-over, the record owner, another account (an agency member), or unknown.
 */
export function removalUploaderRole(
  document: { readonly uploaderAccountId: string | null; readonly source: string | null },
  ownerAccountId: string | null,
): 'OWNER' | 'AGENCY_MEMBER' | 'CONTRIBUTOR' | 'SYSTEM' | null {
  if (document.source === 'CONTRIBUTOR') return 'CONTRIBUTOR';
  if (!document.uploaderAccountId) return null;
  if (document.uploaderAccountId === ownerAccountId) return 'OWNER';
  return 'AGENCY_MEMBER';
}
