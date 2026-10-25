import { type Result, err, ok } from '@visastack/core';
import { CATALOGUE_DOCUMENTS, CATALOGUE_DOCUMENT_GROUPS } from '@visastack/core/catalogue';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { and, eq, sql } from 'drizzle-orm';
import { StaffScope } from './access/principal';
import { DEFAULT_DOCUMENT_PROTECTION, isRestrictedDocumentType } from './access/require-access';
import {
  type DocumentProtectionOverride,
  type DocumentProtectionSettings,
  applyDocumentProtectionOverrides,
} from './access/restricted-documents';
import { appendAuditEvent } from './audit';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * Platform admin switches for the restricted-document rule (owner decision
 * 2026-10-25): which documents need a fresh sign-in check before anyone
 * previews or downloads them, changed from the admin console instead of the
 * code.
 *
 * - The built-in rule (access/restricted-documents.ts) stays the default. A
 *   row in `document_protection_settings` overrides one switch; no row means
 *   the default.
 * - `requireAccess` reads the effective rule in its own transaction
 *   (access/restricted-documents.ts `loadDocumentProtectionSettings`). If the
 *   switches cannot be read, it falls back to the defaults, never to
 *   "nothing is restricted".
 * - `setDocumentProtection` needs a `StaffScope` for DOCUMENT_PROTECTION_MANAGE
 *   (a live role check), a recent identity re-check for any change that
 *   removes protection, and writes an audit event in the same transaction.
 */

export type DocumentProtectionScope = (typeof schema.DOCUMENT_PROTECTION_SCOPES)[number];
export type DocumentProtectionRow = typeof schema.documentProtectionSettings.$inferSelect;

export const DOCUMENT_PROTECTION_AUDIT_EVENT = 'DOCUMENT_PROTECTION_CHANGED';
export const DOCUMENT_PROTECTION_UNKNOWN_KEY = schema.DOCUMENT_PROTECTION_UNKNOWN_KEY;
export const DOCUMENT_PROTECTION_REASON_MAX = schema.DOCUMENT_PROTECTION_REASON_MAX;

/**
 * How long a staff scope stays usable for a change. A scope is minted by a
 * live role check at the start of one request; anything older is refused so
 * a held-over scope cannot outlive a revoked role.
 */
const STAFF_SCOPE_MAX_AGE_MS = 5 * 60 * 1000;

const LOCK_SQL = sql`select pg_advisory_xact_lock(hashtext('visastack:document-protection'))`;

const GROUP_KEYS: ReadonlySet<string> = new Set(CATALOGUE_DOCUMENT_GROUPS.map((g) => g.key));

function overridesFrom(rows: readonly DocumentProtectionRow[]): DocumentProtectionOverride[] {
  return rows.map((row) => ({ scope: row.scope, key: row.key, restricted: row.restricted }));
}

/** The effective rule: the defaults with every stored switch applied. Throws if the read fails. */
export async function readDocumentProtectionSettings(db: Db): Promise<DocumentProtectionSettings> {
  const rows = await db.select().from(schema.documentProtectionSettings);
  return applyDocumentProtectionOverrides(DEFAULT_DOCUMENT_PROTECTION, overridesFrom(rows));
}

function staffScopeProblem(staff: unknown): ServiceError | undefined {
  if (
    !StaffScope.isGenuine(staff) ||
    staff.platformAction !== 'DOCUMENT_PROTECTION_MANAGE' ||
    Date.now() - staff.verifiedAt.getTime() > STAFF_SCOPE_MAX_AGE_MS
  ) {
    return serviceError('forbidden', 'document protection settings need the security admin role');
  }
  return undefined;
}

function keyProblem(scope: DocumentProtectionScope, key: string): ServiceError | undefined {
  switch (scope) {
    case 'CATEGORY':
      return GROUP_KEYS.has(key) ? undefined : serviceError('invalid', 'unknown document category');
    case 'DOCUMENT_TYPE':
      // Only a type's standard key, never an alias, so one type has one switch.
      return resolveDocumentType(key)?.key === key
        ? undefined
        : serviceError('invalid', 'unknown document type');
    case 'UNKNOWN_TYPE':
      return key === DOCUMENT_PROTECTION_UNKNOWN_KEY
        ? undefined
        : serviceError('invalid', 'the unknown-type switch has one key');
    default:
      return serviceError('invalid', 'unknown switch kind');
  }
}

/** Whether this one switch currently restricts, under `settings`. */
function switchRestricts(
  settings: DocumentProtectionSettings,
  scope: DocumentProtectionScope,
  key: string,
): boolean {
  switch (scope) {
    case 'CATEGORY':
      return settings.restrictedCategories.has(key);
    case 'DOCUMENT_TYPE':
      return isRestrictedDocumentType(key, settings);
    case 'UNKNOWN_TYPE':
      return settings.unknownTypesRestricted;
  }
}

export interface SetDocumentProtectionInput {
  readonly scope: DocumentProtectionScope;
  readonly key: string;
  /** On, off, or `null` to remove the switch and go back to the default. */
  readonly restricted: boolean | null;
  readonly reason?: string;
  /** True only after a genuine, recent identity re-check (lib/step-up.ts). */
  readonly stepUpSatisfied: boolean;
}

export interface DocumentProtectionChange {
  /** False when the request matched what is already stored, so nothing was written. */
  readonly changed: boolean;
  readonly restrictedBefore: boolean;
  readonly restrictedAfter: boolean;
}

/**
 * Turn one switch on or off, or back to its default. Any change that leaves
 * the switch not restricting when it restricted before needs
 * `stepUpSatisfied`; turning protection on never does. Every write is audited
 * in the same transaction, with the reason.
 */
export async function setDocumentProtection(
  db: Db,
  staff: StaffScope<'DOCUMENT_PROTECTION_MANAGE'>,
  input: SetDocumentProtectionInput,
): Promise<Result<DocumentProtectionChange, ServiceError>> {
  const denied = staffScopeProblem(staff);
  if (denied) return err(denied);
  const badKey = keyProblem(input.scope, input.key);
  if (badKey) return err(badKey);
  if (input.restricted !== null && typeof input.restricted !== 'boolean') {
    return err(serviceError('invalid', 'choose on, off or the default'));
  }
  const reason = input.reason?.trim() ?? '';
  if (reason.length > DOCUMENT_PROTECTION_REASON_MAX) {
    return err(
      serviceError('invalid', `keep the reason under ${DOCUMENT_PROTECTION_REASON_MAX} characters`),
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(LOCK_SQL);
    const rows = await tx.select().from(schema.documentProtectionSettings);
    const current = rows.find((row) => row.scope === input.scope && row.key === input.key);
    const others = rows.filter((row) => row !== current);
    const before = applyDocumentProtectionOverrides(
      DEFAULT_DOCUMENT_PROTECTION,
      overridesFrom(rows),
    );
    const after = applyDocumentProtectionOverrides(DEFAULT_DOCUMENT_PROTECTION, [
      ...overridesFrom(others),
      ...(input.restricted === null
        ? []
        : [{ scope: input.scope, key: input.key, restricted: input.restricted }]),
    ]);
    const restrictedBefore = switchRestricts(before, input.scope, input.key);
    const restrictedAfter = switchRestricts(after, input.scope, input.key);

    const unchanged =
      input.restricted === null
        ? current === undefined
        : current !== undefined &&
          current.restricted === input.restricted &&
          (current.reason ?? '') === reason;
    if (unchanged) return ok({ changed: false, restrictedBefore, restrictedAfter });

    if (restrictedBefore && !restrictedAfter && !input.stepUpSatisfied) {
      return err(
        serviceError('step_up_required', 'removing document protection needs a fresh sign-in'),
      );
    }

    if (input.restricted === null) {
      await tx
        .delete(schema.documentProtectionSettings)
        .where(
          and(
            eq(schema.documentProtectionSettings.scope, input.scope),
            eq(schema.documentProtectionSettings.key, input.key),
          ),
        );
    } else {
      const values = {
        restricted: input.restricted,
        reason: reason.length > 0 ? reason : null,
        changedByAccountId: staff.accountId,
        changedAt: new Date(),
      };
      await tx
        .insert(schema.documentProtectionSettings)
        .values({ scope: input.scope, key: input.key, ...values })
        .onConflictDoUpdate({
          target: [schema.documentProtectionSettings.scope, schema.documentProtectionSettings.key],
          set: values,
        });
    }

    await appendAuditEvent(tx, {
      eventType: DOCUMENT_PROTECTION_AUDIT_EVENT,
      actorAccountId: staff.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'document_protection_setting',
      resourceId: `${input.scope}:${input.key}`,
      reason: reason.length > 0 ? reason : null,
      metadata: {
        scope: input.scope,
        key: input.key,
        setting: input.restricted === null ? 'default' : input.restricted ? 'on' : 'off',
        restrictedBefore,
        restrictedAfter,
        stepUp: input.stepUpSatisfied,
      },
    });
    return ok({ changed: true, restrictedBefore, restrictedAfter });
  });
}

export interface ProtectionSwitchView {
  readonly scope: DocumentProtectionScope;
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  /** Whether this switch restricts now. */
  readonly restricted: boolean;
  /** What it would do with no admin switch of its own. */
  readonly defaultRestricted: boolean;
  /** An admin switch is stored for it. */
  readonly overridden: boolean;
  readonly reason: string | null;
  readonly changedAt: Date | null;
  readonly changedByEmail: string | null;
}

export interface CategorySwitchView extends ProtectionSwitchView {
  readonly types: readonly ProtectionSwitchView[];
  readonly restrictedTypeCount: number;
}

export interface DocumentProtectionOverview {
  readonly unknown: ProtectionSwitchView;
  readonly categories: readonly CategorySwitchView[];
}

/** Every switch with its current state and its last change, for the admin page. */
export async function getDocumentProtectionOverview(
  db: Db,
  staff: StaffScope<'DOCUMENT_PROTECTION_MANAGE'>,
): Promise<Result<DocumentProtectionOverview, ServiceError>> {
  const denied = staffScopeProblem(staff);
  if (denied) return err(denied);
  const rows = await db
    .select({ row: schema.documentProtectionSettings, email: schema.accounts.email })
    .from(schema.documentProtectionSettings)
    .leftJoin(
      schema.accounts,
      eq(schema.accounts.id, schema.documentProtectionSettings.changedByAccountId),
    );
  const stored = rows.map((r) => r.row);
  const settings = applyDocumentProtectionOverrides(
    DEFAULT_DOCUMENT_PROTECTION,
    overridesFrom(stored),
  );

  const view = (
    scope: DocumentProtectionScope,
    key: string,
    label: string,
    description: string | null,
  ): ProtectionSwitchView => {
    const found = rows.find((r) => r.row.scope === scope && r.row.key === key);
    const withoutThis = found
      ? applyDocumentProtectionOverrides(
          DEFAULT_DOCUMENT_PROTECTION,
          overridesFrom(stored.filter((row) => row !== found.row)),
        )
      : settings;
    return {
      scope,
      key,
      label,
      description,
      restricted: switchRestricts(settings, scope, key),
      defaultRestricted: switchRestricts(withoutThis, scope, key),
      overridden: found !== undefined,
      reason: found?.row.reason ?? null,
      changedAt: found?.row.changedAt ?? null,
      changedByEmail: found?.email ?? null,
    };
  };

  const categories = CATALOGUE_DOCUMENT_GROUPS.map((group): CategorySwitchView => {
    const types = CATALOGUE_DOCUMENTS.filter((d) => d.group === group.key).map((d) =>
      view('DOCUMENT_TYPE', d.key, d.label, null),
    );
    return {
      ...view('CATEGORY', group.key, group.label, group.description),
      types,
      restrictedTypeCount: types.filter((t) => t.restricted).length,
    };
  });
  return ok({
    unknown: view(
      'UNKNOWN_TYPE',
      DOCUMENT_PROTECTION_UNKNOWN_KEY,
      'Documents Not Sorted Yet',
      'Documents whose type is not known yet, or not recognised.',
    ),
    categories,
  });
}
