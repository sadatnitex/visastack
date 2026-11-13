import { eq } from 'drizzle-orm';
import { isActiveMember } from '../agency';
import { type Db, schema } from '../db';
import { isOrgAdmin } from '../organizations';

/**
 * Fixtures for org-actor-ratchet.test.ts: small exported functions that each do, or fail to do,
 * a check of the person acting. The ratchet judges this file in a separate pass and the self-tests
 * there say which must pass and which must be refused. Never imported by product code.
 */

// ---- Must be refused ---------------------------------------------------------------------

/** Checks someone else's account (a recipient), not the actor. */
export async function probeWrongAccount(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  recipient: { readonly accountId: string },
): Promise<boolean> {
  void actorAccountId;
  return isActiveMember(db, recipient.accountId, organizationId);
}

/** Checks a local variable that is merely called `accountId`. */
export async function probeLocalAccountId(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  ownerId: string,
): Promise<boolean> {
  void actorAccountId;
  const accountId = ownerId;
  return isActiveMember(db, accountId, organizationId);
}

/** Takes an organization and no actor at all. */
export async function probeNoActor(db: Db, orgId: string) {
  void orgId;
  return db.select().from(schema.missions).limit(1);
}

/** Reads the memberships table with nothing about the actor in the read. */
export async function probeMembershipsAnyone(
  db: Db,
  actorAccountId: string,
  organizationId: string,
) {
  void actorAccountId;
  void organizationId;
  return db.select().from(schema.memberships).limit(1);
}

async function checkMember(db: Db, accountId: string, organizationId: string) {
  return isActiveMember(db, accountId, organizationId);
}

/** Hands the actor-less account to a helper that checks "its" account parameter. */
export async function probeWrongAccountViaHelper(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  recipient: { readonly accountId: string },
): Promise<boolean> {
  void actorAccountId;
  return checkMember(db, recipient.accountId, organizationId);
}

/** An alias of another person's id. */
export async function probeAliasOfOther(
  db: Db,
  actorAccountId: string,
  organizationId: string,
  assigneeId: string,
): Promise<boolean> {
  void actorAccountId;
  const who = assigneeId;
  return isOrgAdmin(db, who, organizationId);
}

// ---- Must be accepted --------------------------------------------------------------------

/** The plain shape. */
export async function probeDirect(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<boolean> {
  return isActiveMember(db, actorAccountId, organizationId);
}

/** The actor inside an input object. */
export async function probeObjectInput(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string },
): Promise<boolean> {
  return isActiveMember(db, input.actorAccountId, input.organizationId);
}

/** Destructured parameters. */
export async function probeDestructured(
  db: Db,
  { actorAccountId, organizationId }: { actorAccountId: string; organizationId: string },
): Promise<boolean> {
  return isOrgAdmin(db, actorAccountId, organizationId);
}

/** The actor handed to a helper. */
export async function probeViaHelper(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<boolean> {
  return checkMember(db, actorAccountId, organizationId);
}

/** The actor copied to a local first. */
export async function probeAlias(
  db: Db,
  actorAccountId: string,
  organizationId: string,
): Promise<boolean> {
  const who = actorAccountId;
  return isActiveMember(db, who, organizationId);
}

/** The membership read written in place, filtered by the actor. */
export async function probeInlineRead(db: Db, actorAccountId: string, organizationId: string) {
  void organizationId;
  return db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.accountId, actorAccountId));
}

/** The person is the `accountId` of the one object passed, and there is no separate actor. */
export async function probeFieldsAccountId(
  db: Db,
  organizationId: string,
  fields: { readonly accountId: string },
): Promise<boolean> {
  return isActiveMember(db, fields.accountId, organizationId);
}
