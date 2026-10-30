import { type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { AGENCY_AI_ROLES } from './access/agency-ai-scope';
import { agencyAiAvailable } from './agency-ai-ready';
import {
  type AiFeatureState,
  aiOrganizationContext,
  getAiFeatureState,
} from './ai-feature-settings';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * "AI Connections for This Agency" (S22, ADR 0021 S22 amendment): an agency's own switch for
 * connecting AI apps that read what travellers allowed the agency's AI tools to see. Off unless an
 * owner or admin turns it on; no row, or no table yet, means off. Turning it off stops every
 * agency connection on its next call (the AI gate reads it on every call); turning it on again
 * lets connections that have not ended work again.
 */

export interface OrganizationAiSetting {
  /** False until both S22 migrations have run: the page says "Available After the Next Update". */
  readonly available: boolean;
  readonly enabled: boolean;
  readonly updatedAt: Date | null;
  /** Whether this account may change it (an active owner or admin). */
  readonly canChange: boolean;
  /** Agency AI Tools for this agency: the platform owner's switch, the plan and today's limit. */
  readonly feature: AiFeatureState;
}

async function membership(db: Db, organizationId: string, accountId: string) {
  return first(
    await db
      .select({ role: schema.memberships.role, active: schema.memberships.active })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
}

/** The agency's setting, for any active member of the agency (others get `forbidden`). */
export async function getOrganizationAiSetting(
  db: Db,
  input: { readonly organizationId: string; readonly accountId: string },
): Promise<Result<OrganizationAiSetting, ServiceError>> {
  const member = await membership(db, input.organizationId, input.accountId);
  if (!member?.active) return err(serviceError('forbidden', 'not a member of this agency'));
  const feature = await getAiFeatureState(
    db,
    'ai_agency_tools',
    aiOrganizationContext(input.organizationId),
  );
  const canChange = AGENCY_AI_ROLES.includes(member.role);
  if (!(await agencyAiAvailable(db))) {
    return ok({ available: false, enabled: false, updatedAt: null, canChange, feature });
  }
  const row = first(
    await db
      .select({
        enabled: schema.organizationAiSettings.aiConnectionsEnabled,
        updatedAt: schema.organizationAiSettings.updatedAt,
      })
      .from(schema.organizationAiSettings)
      .where(eq(schema.organizationAiSettings.organizationId, input.organizationId))
      .limit(1),
  );
  return ok({
    available: true,
    enabled: row?.enabled === true,
    updatedAt: row?.updatedAt ?? null,
    canChange,
    feature,
  });
}

/**
 * Turns the agency's setting on or off. An active owner or admin of an active agency only. Turning
 * it on also needs the confirmation the screen shows (`confirmed`): the agency's statement that it
 * has a lawful basis and a written agreement with each AI provider it connects. Audited as
 * `ORGANIZATION_AI_SETTING_UPDATED` with the setting before and after.
 */
export async function setOrganizationAiSetting(
  db: Db,
  input: {
    readonly organizationId: string;
    readonly accountId: string;
    readonly enabled: boolean;
    readonly confirmed: boolean;
  },
): Promise<Result<{ readonly enabled: boolean }, ServiceError>> {
  return db.transaction(async (tx) => {
    const member = await membership(tx, input.organizationId, input.accountId);
    if (!member?.active || !AGENCY_AI_ROLES.includes(member.role)) {
      return err(serviceError('forbidden', 'only an agency owner or admin can change this'));
    }
    const organization = first(
      await tx
        .select({ status: schema.organizations.status })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, input.organizationId))
        .limit(1),
    );
    if (organization?.status !== 'ACTIVE') {
      return err(serviceError('forbidden', 'this agency is not active'));
    }
    if (!(await agencyAiAvailable(tx))) {
      return err(serviceError('invalid', 'agency AI settings are not available yet'));
    }
    if (input.enabled && !input.confirmed) {
      return err(serviceError('invalid', 'confirm the statement before turning this on'));
    }
    const table = schema.organizationAiSettings;
    const before = first(
      await tx
        .select({ enabled: table.aiConnectionsEnabled })
        .from(table)
        .where(eq(table.organizationId, input.organizationId))
        .limit(1)
        .for('update'),
    );
    const now = new Date();
    await tx
      .insert(table)
      .values({
        organizationId: input.organizationId,
        aiConnectionsEnabled: input.enabled,
        updatedByAccountId: input.accountId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: table.organizationId,
        set: {
          aiConnectionsEnabled: input.enabled,
          updatedByAccountId: input.accountId,
          updatedAt: now,
        },
      });
    await appendAuditEvent(tx, {
      eventType: 'ORGANIZATION_AI_SETTING_UPDATED',
      actorAccountId: input.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'organization',
      resourceId: input.organizationId,
      metadata: {
        before: before?.enabled === true,
        after: input.enabled,
        ...(input.enabled ? { statementConfirmed: true } : {}),
      },
    });
    return ok({ enabled: input.enabled });
  });
}
