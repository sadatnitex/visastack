import { type ApplicantId, type FactStatus, type Result, err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import type { KeyManagementPort } from './ports';
import { type FactVersion, revealFactVersionValue } from './profile';

/**
 * v1.2 E03 service foundation (WP-V2): compare an exact prior declaration with
 * the current confirmed value and say, in the product's fixed vocabulary
 * (PROGRAMME section 8), what kind of difference it is.
 *
 * Truth rules this module keeps:
 * - Subject, time, currency and basis are applied before values are compared.
 *   A renewal, a later salary, gross versus net, an alias or an unknown date is
 *   never automatically a contradiction.
 * - Unknown stays unknown. A missing date, currency or basis gives
 *   Insufficient information, never a guess.
 * - Values are compared, never rewritten: the stored source strings are
 *   returned exactly as recorded.
 * - An explanation (a version's recorded reason) is returned as a recorded
 *   assertion. It never changes the result, so a genuine unresolved issue is
 *   never hidden because someone wrote a note.
 * - No authenticity, fraud or approval judgement is made or implied.
 */

export const CONSISTENCY_RESULTS = [
  'CONSISTENT',
  'LEGITIMATE_CHANGE',
  'CONTEXT_DIFFERENCE',
  'NEEDS_CLARIFICATION',
  'INSUFFICIENT_INFORMATION',
] as const;
export type ConsistencyResult = (typeof CONSISTENCY_RESULTS)[number];

export const CONSISTENCY_LABELS: Readonly<Record<ConsistencyResult, string>> = {
  CONSISTENT: 'Consistent',
  LEGITIMATE_CHANGE: 'Legitimate change',
  CONTEXT_DIFFERENCE: 'Context difference',
  NEEDS_CLARIFICATION: 'Needs clarification',
  INSUFFICIENT_INFORMATION: 'Insufficient information',
};

export type ConsistencyReason =
  | 'same_value'
  | 'same_value_different_formatting'
  | 'value_missing'
  | 'currency_unknown'
  | 'different_currency'
  | 'basis_unknown'
  | 'different_basis'
  | 'known_alias'
  | 'fixed_fact_differs'
  | 'date_unknown'
  | 'later_effective_date'
  | 'same_time_different_value'
  | 'earlier_effective_date';

/** Plain-language explanation for each reason, for any screen that shows one. */
export const CONSISTENCY_REASON_TEXT: Readonly<Record<ConsistencyReason, string>> = {
  same_value: 'Both say the same thing.',
  same_value_different_formatting: 'Both say the same thing, written differently.',
  value_missing: 'One side has no value to compare.',
  currency_unknown: 'The currency is not recorded for one side.',
  different_currency: 'The amounts are in different currencies.',
  basis_unknown: 'It is not recorded whether one amount is before or after tax.',
  different_basis: 'One amount is before tax and the other after tax.',
  known_alias: 'One name is a recorded other name.',
  fixed_fact_differs: 'This detail should not change over time, but the two differ.',
  date_unknown: 'The date this became true is not recorded for one side.',
  later_effective_date: 'The newer value took effect later.',
  same_time_different_value: 'The two differ for the same date.',
  earlier_effective_date: 'The newer value says it took effect earlier than the old one.',
};

/** Details that do not change over a lifetime: a difference always needs clarification. */
const FIXED_FIELDS: ReadonlySet<string> = new Set(['date_of_birth', 'place_of_birth']);
/** Name fields an applicant's recorded other names (`name_alternate`) can explain. */
const NAME_FIELDS: ReadonlySet<string> = new Set(['given_name', 'family_name']);
/** Amount fields whose currency is a sibling `<key>_currency` field. */
const AMOUNT_FIELDS: ReadonlySet<string> = new Set([
  'annual_income',
  'monthly_salary',
  'self_employment_income',
]);

export type AmountBasis = 'GROSS' | 'NET';

export interface DeclarationSide {
  readonly value: string | null;
  /** When the value became true. Null means not recorded: never assumed. */
  readonly effectiveFrom: Date | null;
  /** Amount fields only. Null means not recorded. */
  readonly currency?: string | null;
  /** Amount fields only. Null means not recorded. */
  readonly basis?: AmountBasis | null;
}

export interface ClassifyDeclarationInput {
  readonly fieldKey: string;
  readonly prior: DeclarationSide;
  readonly current: DeclarationSide;
  /** The applicant's recorded other names, used only for name fields. */
  readonly knownAliases?: readonly string[];
}

export interface Classification {
  readonly result: ConsistencyResult;
  readonly reason: ConsistencyReason;
}

const fold = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

function classification(result: ConsistencyResult, reason: ConsistencyReason): Classification {
  return { result, reason };
}

/** Compares two recorded contexts where null means "not recorded". */
function contextCheck(
  prior: string | null | undefined,
  current: string | null | undefined,
): 'same' | 'unknown' | 'different' {
  const a = prior ?? null;
  const b = current ?? null;
  // A field that records no context on either side is not split by it.
  if (a === null && b === null) return 'same';
  if (a === null || b === null) return 'unknown';
  return fold(a) === fold(b) ? 'same' : 'different';
}

/** Pure classification of one prior declaration against one current value. */
export function classifyDeclarationChange(input: ClassifyDeclarationInput): Classification {
  const { fieldKey, prior, current } = input;
  if (prior.value === null || current.value === null) {
    return classification('INSUFFICIENT_INFORMATION', 'value_missing');
  }
  if (prior.value === current.value) return classification('CONSISTENT', 'same_value');
  if (fold(prior.value) === fold(current.value)) {
    return classification('CONSISTENT', 'same_value_different_formatting');
  }

  if (AMOUNT_FIELDS.has(fieldKey)) {
    const currency = contextCheck(prior.currency, current.currency);
    if (currency === 'unknown')
      return classification('INSUFFICIENT_INFORMATION', 'currency_unknown');
    if (currency === 'different') return classification('CONTEXT_DIFFERENCE', 'different_currency');
    const basis = contextCheck(prior.basis, current.basis);
    if (basis === 'unknown') return classification('INSUFFICIENT_INFORMATION', 'basis_unknown');
    if (basis === 'different') return classification('CONTEXT_DIFFERENCE', 'different_basis');
  }

  if (NAME_FIELDS.has(fieldKey) && input.knownAliases) {
    const aliases = new Set(input.knownAliases.map(fold));
    if (aliases.has(fold(prior.value)) || aliases.has(fold(current.value))) {
      return classification('CONTEXT_DIFFERENCE', 'known_alias');
    }
  }

  if (FIXED_FIELDS.has(fieldKey)) {
    return classification('NEEDS_CLARIFICATION', 'fixed_fact_differs');
  }

  if (prior.effectiveFrom === null || current.effectiveFrom === null) {
    return classification('INSUFFICIENT_INFORMATION', 'date_unknown');
  }
  const priorTime = prior.effectiveFrom.getTime();
  const currentTime = current.effectiveFrom.getTime();
  if (currentTime > priorTime) return classification('LEGITIMATE_CHANGE', 'later_effective_date');
  if (currentTime === priorTime) {
    return classification('NEEDS_CLARIFICATION', 'same_time_different_value');
  }
  return classification('NEEDS_CLARIFICATION', 'earlier_effective_date');
}

export interface ComparedVersion {
  readonly factVersionId: string;
  /** Exactly as recorded. */
  readonly value: string | null;
  readonly effectiveFrom: string | null;
  readonly recordedAt: string;
  readonly status: FactStatus;
  /** The version's recorded reason: an assertion by whoever saved it, not proof. */
  readonly explanation: string | null;
  readonly currency: string | null;
}

export interface DeclarationComparison {
  readonly fieldKey: string;
  readonly repeatingRecordKey: string | null;
  readonly prior: ComparedVersion;
  readonly current: ComparedVersion;
  readonly result: ConsistencyResult;
  readonly label: string;
  readonly reason: ConsistencyReason;
  readonly reasonText: string;
}

export interface CompareFactVersionsInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  /** The exact prior version, for example one a case snapshot recorded. */
  readonly priorFactVersionId: string;
  /** Defaults to the fact's current version. Must belong to the same fact. */
  readonly currentFactVersionId?: string;
  /** Required when either side is a protected value. */
  readonly encryption?: KeyManagementPort;
}

const VERSION_NOT_FOUND = 'That version is not available.';

async function reveal(
  db: Db,
  version: FactVersion,
  encryption: KeyManagementPort | undefined,
): Promise<Result<string | null, ServiceError>> {
  if (version.protectedKeyVersion === null) return ok(version.value);
  if (!encryption) {
    return err(serviceError('encryption_unavailable', 'This value cannot be shown right now.'));
  }
  const value = await revealFactVersionValue(db, encryption, version);
  return value.ok ? ok(value.value) : err(value.error);
}

/** The version of a fact in force at a moment: the latest one recorded at or before it. */
async function versionAsOf(db: Db, factId: string, at: Date): Promise<FactVersion | undefined> {
  const versions = await db
    .select()
    .from(schema.factVersions)
    .where(eq(schema.factVersions.factId, factId))
    .orderBy(asc(schema.factVersions.createdAt));
  let found: FactVersion | undefined;
  for (const version of versions) {
    if (version.createdAt.getTime() <= at.getTime()) found = version;
  }
  return found;
}

async function siblingFacts(
  db: Db,
  applicantId: string,
  fieldKey: string,
  repeatingRecordKey: string | null,
) {
  return db
    .select({ fact: schema.facts })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .where(
      and(
        eq(schema.facts.applicantId, applicantId),
        eq(schema.fieldDefinitions.key, fieldKey),
        repeatingRecordKey === null
          ? isNull(schema.facts.repeatingRecordKey)
          : eq(schema.facts.repeatingRecordKey, repeatingRecordKey),
      ),
    );
}

/**
 * Compare an exact prior version of a profile detail with its current (or a
 * named later) version. Owner only: an agency's access to a current case does
 * not authorise unrelated old declarations, and agency comparison needs an
 * explicit scope for both sides that WP-V5 defines. A version that belongs to
 * another person, another detail, or does not exist gets the same answer, so
 * nothing can be learned by guessing ids.
 */
export async function compareFactVersions(
  db: Db,
  input: CompareFactVersionsInput,
): Promise<Result<DeclarationComparison, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  const owns = applicant !== undefined && applicant.ownerAccountId === input.actorAccountId;
  const decision = owns
    ? authorize({
        actor: { kind: 'applicant_owner', applicantId: input.applicantId as ApplicantId },
        action: 'PREVIEW',
        resource: { applicantId: input.applicantId as ApplicantId },
        context: {
          now: new Date(),
          purpose: 'profile_history',
          stepUpSatisfied: false,
          grants: [],
        },
      })
    : ({ allowed: false, reason: 'default_deny' } as const);
  if (!decision.allowed) {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'DECLARATION_COMPARISON_DENIED',
        actorAccountId: input.actorAccountId,
        action: 'PREVIEW',
        result: 'DENIED',
        method: 'MANUAL',
        applicantId: applicant ? applicant.id : null,
        resourceType: 'fact_version',
        reason: decision.reason,
      });
    });
    return err(serviceError('forbidden', 'You do not have access to this history.'));
  }

  const priorRow = first(
    await db
      .select({
        version: schema.factVersions,
        fact: schema.facts,
        key: schema.fieldDefinitions.key,
      })
      .from(schema.factVersions)
      .innerJoin(schema.facts, eq(schema.facts.id, schema.factVersions.factId))
      .innerJoin(
        schema.fieldDefinitions,
        eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
      )
      .where(
        and(
          eq(schema.factVersions.id, input.priorFactVersionId),
          eq(schema.facts.applicantId, input.applicantId),
        ),
      )
      .limit(1),
  );
  if (!priorRow) return err(serviceError('not_found', VERSION_NOT_FOUND));
  const { fact, key: fieldKey } = priorRow;

  const currentId = input.currentFactVersionId ?? fact.currentVersionId;
  if (!currentId) return err(serviceError('not_found', VERSION_NOT_FOUND));
  const current = first(
    await db
      .select()
      .from(schema.factVersions)
      .where(and(eq(schema.factVersions.id, currentId), eq(schema.factVersions.factId, fact.id)))
      .limit(1),
  );
  if (!current) return err(serviceError('not_found', VERSION_NOT_FOUND));
  const prior = priorRow.version;

  const priorValue = await reveal(db, prior, input.encryption);
  if (!priorValue.ok) return priorValue;
  const currentValue = await reveal(db, current, input.encryption);
  if (!currentValue.ok) return currentValue;

  // Currency is its own detail; read the value in force for each side.
  let priorCurrency: string | null = null;
  let currentCurrency: string | null = null;
  if (AMOUNT_FIELDS.has(fieldKey)) {
    const [currencyFact] = await siblingFacts(
      db,
      input.applicantId,
      `${fieldKey}_currency`,
      fact.repeatingRecordKey,
    );
    if (currencyFact) {
      const isCurrent = current.id === fact.currentVersionId;
      const priorCurrencyVersion = await versionAsOf(db, currencyFact.fact.id, prior.createdAt);
      const currentCurrencyVersion = isCurrent
        ? first(
            await db
              .select()
              .from(schema.factVersions)
              .where(eq(schema.factVersions.id, currencyFact.fact.currentVersionId ?? ''))
              .limit(1),
          )
        : await versionAsOf(db, currencyFact.fact.id, current.createdAt);
      if (priorCurrencyVersion) {
        const value = await reveal(db, priorCurrencyVersion, input.encryption);
        if (!value.ok) return value;
        priorCurrency = value.value;
      }
      if (currentCurrencyVersion) {
        const value = await reveal(db, currentCurrencyVersion, input.encryption);
        if (!value.ok) return value;
        currentCurrency = value.value;
      }
    }
  }

  // Recorded other names explain a name difference.
  const knownAliases: string[] = [];
  if (NAME_FIELDS.has(fieldKey)) {
    const aliasFacts = await db
      .select({ version: schema.factVersions })
      .from(schema.facts)
      .innerJoin(
        schema.fieldDefinitions,
        eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
      )
      .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
      .where(
        and(
          eq(schema.facts.applicantId, input.applicantId),
          eq(schema.fieldDefinitions.key, 'name_alternate'),
        ),
      );
    for (const row of aliasFacts) {
      const value = await reveal(db, row.version, input.encryption);
      if (!value.ok) return value;
      if (value.value) knownAliases.push(value.value);
    }
  }

  const { result, reason } = classifyDeclarationChange({
    fieldKey,
    prior: { value: priorValue.value, effectiveFrom: prior.effectiveFrom, currency: priorCurrency },
    current: {
      value: currentValue.value,
      effectiveFrom: current.effectiveFrom,
      currency: currentCurrency,
    },
    knownAliases,
  });

  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DECLARATION_COMPARED',
      actorAccountId: input.actorAccountId,
      action: 'PREVIEW',
      result: 'ALLOWED',
      method: 'MANUAL',
      applicantId: input.applicantId,
      resourceType: 'fact_version',
      resourceId: prior.id,
      // Ids and the result only: never a value.
      metadata: { fieldKey, currentFactVersionId: current.id, result },
    });
  });

  const side = (
    version: FactVersion,
    value: string | null,
    currency: string | null,
  ): ComparedVersion => ({
    factVersionId: version.id,
    value,
    effectiveFrom: version.effectiveFrom ? version.effectiveFrom.toISOString() : null,
    recordedAt: version.createdAt.toISOString(),
    status: version.status,
    explanation: version.reason,
    currency,
  });

  return ok({
    fieldKey,
    repeatingRecordKey: fact.repeatingRecordKey,
    prior: side(prior, priorValue.value, priorCurrency),
    current: side(current, currentValue.value, currentCurrency),
    result,
    label: CONSISTENCY_LABELS[result],
    reason,
    reasonText: CONSISTENCY_REASON_TEXT[reason],
  });
}
