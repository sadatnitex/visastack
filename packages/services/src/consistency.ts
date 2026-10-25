import { type ApplicantId, type FactStatus, type Result, err, ok } from '@visastack/core';
import { TAX_BASIS, taxBasisKey } from '@visastack/core/catalogue';
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
  basis_unknown: 'It is not recorded whether the amounts are before or after tax.',
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

/** A detail that cannot legitimately change over a lifetime, such as a date of birth. */
export function isFixedFieldKey(fieldKey: string): boolean {
  return FIXED_FIELDS.has(fieldKey);
}
/** Name fields an applicant's recorded other names (`name_alternate`) can explain. */
const NAME_FIELDS: ReadonlySet<string> = new Set(['given_name', 'family_name']);
/** Amount fields whose currency and tax basis are sibling `<key>_currency` and `<key>_tax_basis` fields. */
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

/** Compares two recorded contexts. Null means not recorded, so a missing side is unknown, never "same". */
function contextCheck(
  prior: string | null | undefined,
  current: string | null | undefined,
): 'same' | 'unknown' | 'different' {
  const a = prior ?? null;
  const b = current ?? null;
  if (a === null || b === null) return 'unknown';
  return fold(a) === fold(b) ? 'same' : 'different';
}

/** The same number written differently ("80,000" and "80000"); the stored strings are untouched. */
function sameAmount(prior: string, current: string): boolean {
  const number = (value: string) => {
    const digits = value.replace(/[\s,_]/g, '');
    return /^-?\d+(?:\.\d+)?$/.test(digits) ? Number(digits) : Number.NaN;
  };
  const a = number(prior);
  return !Number.isNaN(a) && a === number(current);
}

/** Pure classification of one prior declaration against one current value. */
export function classifyDeclarationChange(input: ClassifyDeclarationInput): Classification {
  const { fieldKey, prior, current } = input;
  if (prior.value === null || current.value === null) {
    return classification('INSUFFICIENT_INFORMATION', 'value_missing');
  }
  if (AMOUNT_FIELDS.has(fieldKey)) {
    // Context first: the same number in two currencies, or before and after
    // tax, is not the same amount, and an unknown currency cannot be assumed.
    const currency = contextCheck(prior.currency, current.currency);
    if (currency === 'different') return classification('CONTEXT_DIFFERENCE', 'different_currency');
    if (currency === 'unknown') {
      return classification('INSUFFICIENT_INFORMATION', 'currency_unknown');
    }
    const basis = contextCheck(prior.basis, current.basis);
    if (basis === 'different') return classification('CONTEXT_DIFFERENCE', 'different_basis');
    if (prior.value === current.value) return classification('CONSISTENT', 'same_value');
    if (sameAmount(prior.value, current.value)) {
      return classification('CONSISTENT', 'same_value_different_formatting');
    }
    // Different numbers with no recorded tax basis could be gross against net.
    if (basis === 'unknown') return classification('INSUFFICIENT_INFORMATION', 'basis_unknown');
  }

  if (prior.value === current.value) return classification('CONSISTENT', 'same_value');
  if (fold(prior.value) === fold(current.value)) {
    return classification('CONSISTENT', 'same_value_different_formatting');
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
  /** Amount fields only: before (GROSS) or after (NET) tax, or null when not recorded. */
  readonly basis: AmountBasis | null;
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
  /** Defaults to the fact's current version. Must belong to the same fact and be no older than the prior one. */
  readonly currentFactVersionId?: string;
  /**
   * When the prior declaration was made, for example the snapshot's creation
   * time. Related details such as currency are read as of then. Defaults to
   * the last moment the prior version was the current one.
   */
  readonly priorAsOf?: Date;
  /** Required when either side is a protected value. */
  readonly encryption?: KeyManagementPort;
}

const VERSION_NOT_FOUND = 'That version is not available.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Versions saved before WP-V2 got the save time as their effective date when
 * none was given. A date within seconds of the save time is that default, not
 * something a person entered (the form only takes a calendar date), so it is
 * read as not known. Stored data is unchanged.
 */
const LEGACY_DEFAULT_WINDOW_MS = 5_000;
/** Only rows saved before WP-V2 reached production can carry that default. */
export const LEGACY_DEFAULT_SAVED_BEFORE = new Date('2026-10-26T00:00:00Z');
function knownEffectiveDate(version: FactVersion): Date | null {
  const effective = version.effectiveFrom;
  if (!effective) return null;
  const legacyDefault =
    version.createdAt.getTime() < LEGACY_DEFAULT_SAVED_BEFORE.getTime() &&
    Math.abs(effective.getTime() - version.createdAt.getTime()) < LEGACY_DEFAULT_WINDOW_MS;
  return legacyDefault ? null : effective;
}

/**
 * The companion detail (currency or tax basis) that went with an amount version: the one in
 * force when the amount was saved, or, when none was set yet (the form asks for the amount
 * first), the first one entered while that amount was still current. So both save orders work,
 * and a detail changed ahead of a new amount does not leak back onto the old one. The cost of
 * that choice: a correction made while the old amount was still current reads as such a change,
 * and a detail first given after a newer amount was saved does not reach the old one, which then
 * stays not known rather than assumed. A caller with a snapshot time passes priorAsOf instead,
 * which is exact.
 */
async function valueDeclaredWith(
  db: Db,
  companionFactId: string,
  amount: FactVersion,
): Promise<FactVersion | undefined> {
  const atSave = await versionAsOf(db, companionFactId, amount.createdAt);
  if (atSave) return atSave;
  const until = await lastCurrentMoment(db, amount);
  const versions = await db
    .select()
    .from(schema.factVersions)
    .where(eq(schema.factVersions.factId, companionFactId))
    .orderBy(asc(schema.factVersions.createdAt));
  return versions.find(
    (v) =>
      v.createdAt.getTime() > amount.createdAt.getTime() &&
      v.createdAt.getTime() <= until.getTime(),
  );
}

/** The stored answer of an amount's tax basis detail, or null when blank, "Not sure" or unrecognised. */
function basisOf(value: string | null): AmountBasis | null {
  if (value === TAX_BASIS.before) return 'GROSS';
  if (value === TAX_BASIS.after) return 'NET';
  return null;
}

/**
 * The value of an amount's companion detail (its currency or tax basis) for each side. The prior
 * side reads the value declared with that amount version, or as of priorAsOf when given; the
 * current side reads the latest value when it is the amount's latest version, so a later
 * correction counts.
 */
async function companionValues(
  db: Db,
  input: {
    readonly applicantId: string;
    readonly priorAsOf?: Date;
    readonly encryption?: KeyManagementPort;
  },
  fact: { readonly currentVersionId: string | null; readonly repeatingRecordKey: string | null },
  prior: FactVersion,
  current: FactVersion,
  companionKey: string,
): Promise<
  Result<{ readonly prior: string | null; readonly current: string | null }, ServiceError>
> {
  const [companion] = await siblingFacts(
    db,
    input.applicantId,
    companionKey,
    fact.repeatingRecordKey,
  );
  if (!companion) return ok({ prior: null, current: null });
  const companionFactId = companion.fact.id;
  const priorVersion = input.priorAsOf
    ? await versionAsOf(db, companionFactId, input.priorAsOf)
    : await valueDeclaredWith(db, companionFactId, prior);
  const latestId = companion.fact.currentVersionId;
  const currentVersion =
    current.id === fact.currentVersionId && latestId
      ? first(
          await db
            .select()
            .from(schema.factVersions)
            .where(eq(schema.factVersions.id, latestId))
            .limit(1),
        )
      : await valueDeclaredWith(db, companionFactId, current);
  let priorValue: string | null = null;
  let currentValue: string | null = null;
  if (priorVersion) {
    const value = await reveal(db, priorVersion, input.encryption);
    if (!value.ok) return value;
    priorValue = value.value;
  }
  if (currentVersion) {
    const value = await reveal(db, currentVersion, input.encryption);
    if (!value.ok) return value;
    currentValue = value.value;
  }
  return ok({ prior: priorValue, current: currentValue });
}

/** The last moment a version was the current one: just before the next version, or now. */
async function lastCurrentMoment(db: Db, version: FactVersion): Promise<Date> {
  const versions = await db
    .select({ id: schema.factVersions.id, createdAt: schema.factVersions.createdAt })
    .from(schema.factVersions)
    .where(eq(schema.factVersions.factId, version.factId))
    .orderBy(asc(schema.factVersions.createdAt));
  const index = versions.findIndex((v) => v.id === version.id);
  const next = index >= 0 ? versions[index + 1] : undefined;
  return next ? new Date(next.createdAt.getTime() - 1) : new Date();
}

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

  if (
    !UUID.test(input.priorFactVersionId) ||
    (input.currentFactVersionId !== undefined && !UUID.test(input.currentFactVersionId))
  ) {
    return err(serviceError('not_found', VERSION_NOT_FOUND));
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
  const prior = priorRow.version;
  // The "current" side may not be older than the prior one.
  if (!current || current.createdAt.getTime() < prior.createdAt.getTime()) {
    return err(serviceError('not_found', VERSION_NOT_FOUND));
  }

  const priorValue = await reveal(db, prior, input.encryption);
  if (!priorValue.ok) return priorValue;
  const currentValue = await reveal(db, current, input.encryption);
  if (!currentValue.ok) return currentValue;

  // Currency and tax basis are their own details; read the value in force for each side.
  let priorCurrency: string | null = null;
  let currentCurrency: string | null = null;
  let priorBasis: AmountBasis | null = null;
  let currentBasis: AmountBasis | null = null;
  if (AMOUNT_FIELDS.has(fieldKey)) {
    const [currency, basis] = await Promise.all([
      companionValues(db, input, fact, prior, current, `${fieldKey}_currency`),
      companionValues(db, input, fact, prior, current, taxBasisKey(fieldKey)),
    ]);
    if (!currency.ok) return currency;
    priorCurrency = currency.value.prior;
    currentCurrency = currency.value.current;
    if (!basis.ok) return basis;
    priorBasis = basisOf(basis.value.prior);
    currentBasis = basisOf(basis.value.current);
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
    prior: {
      value: priorValue.value,
      effectiveFrom: knownEffectiveDate(prior),
      currency: priorCurrency,
      basis: priorBasis,
    },
    current: {
      value: currentValue.value,
      effectiveFrom: knownEffectiveDate(current),
      currency: currentCurrency,
      basis: currentBasis,
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
    basis: AmountBasis | null,
  ): ComparedVersion => ({
    factVersionId: version.id,
    value,
    effectiveFrom: knownEffectiveDate(version)?.toISOString() ?? null,
    recordedAt: version.createdAt.toISOString(),
    status: version.status,
    explanation: version.reason,
    currency,
    basis,
  });

  return ok({
    fieldKey,
    repeatingRecordKey: fact.repeatingRecordKey,
    prior: side(prior, priorValue.value, priorCurrency, priorBasis),
    current: side(current, currentValue.value, currentCurrency, currentBasis),
    result,
    label: CONSISTENCY_LABELS[result],
    reason,
    reasonText: CONSISTENCY_REASON_TEXT[reason],
  });
}
