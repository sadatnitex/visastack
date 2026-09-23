/**
 * Typed, declarative rule condition AST and evaluator (Commercial V1 RUL-03).
 *
 * A pure, standalone module -- no database, Next.js, or mission/fact schema
 * dependency -- matching the codebase's existing pattern for logic that must
 * stay independently testable and never drift between a write site and a
 * read site (e.g. `snapshot-facts.ts`, `composeSelectionCandidateKey`).
 * Wiring this into `computeReadiness`/`buildRequirementMapping` (adapting
 * real FactInstance/DocumentInstance data into `EvaluationContext`) is a
 * separate, later change.
 *
 * Deliberately NOT a general-purpose expression language: the directive is
 * explicit that only a fixed, allowlisted operator set is permitted --
 * existence, equality, membership, date comparison, duration, numeric
 * bounds, and safe boolean composition -- and forbids `eval`, arbitrary JS,
 * remote scripts, and any URL fetch during evaluation. This module has no
 * code path that could do any of those: every node is a plain discriminated
 * union evaluated by a `switch`, never interpreted as code.
 *
 * A referenced field with no value evaluates to `'unknown'`, never silently
 * `'false'` -- "missing facts: UNKNOWN. Never convert missing into
 * false/satisfied" (directive §4). Three-valued (Kleene) logic governs
 * `and`/`or`/`not` composition so `unknown` propagates honestly rather than
 * collapsing to a boolean partway through a compound condition.
 */

export type RuleFieldValue = string | number | boolean | Date;

/** Looks up a field's current value for one evaluation. Returns `undefined` for a field with no known value -- never throws for a missing field. */
export interface EvaluationContext {
  readonly now: Date;
  getValue(field: string): RuleFieldValue | undefined;
}

/** An operand is a literal, a reference to another field's value, or the evaluation instant -- so date/duration rules can compare two fields (e.g. "passport expiry vs. travel end date") as readily as a field against "now." */
export type RuleOperand =
  | { readonly kind: 'literal'; readonly value: string | number }
  | { readonly kind: 'field'; readonly field: string }
  | { readonly kind: 'now' };

export type RuleCondition =
  | { readonly op: 'exists'; readonly field: string }
  | { readonly op: 'equals'; readonly field: string; readonly value: string | number | boolean }
  | { readonly op: 'notEquals'; readonly field: string; readonly value: string | number | boolean }
  | {
      readonly op: 'memberOf';
      readonly field: string;
      readonly values: readonly (string | number)[];
    }
  | { readonly op: 'dateBefore'; readonly date: RuleOperand; readonly than: RuleOperand }
  | { readonly op: 'dateAfter'; readonly date: RuleOperand; readonly than: RuleOperand }
  | {
      readonly op: 'durationAtLeastDays';
      readonly from: RuleOperand;
      readonly to: RuleOperand;
      readonly days: number;
    }
  | {
      readonly op: 'durationAtMostDays';
      readonly from: RuleOperand;
      readonly to: RuleOperand;
      readonly days: number;
    }
  | { readonly op: 'numberAtLeast'; readonly field: string; readonly value: number }
  | { readonly op: 'numberAtMost'; readonly field: string; readonly value: number }
  | {
      readonly op: 'numberBetween';
      readonly field: string;
      readonly min: number;
      readonly max: number;
    }
  | { readonly op: 'and'; readonly conditions: readonly RuleCondition[] }
  | { readonly op: 'or'; readonly conditions: readonly RuleCondition[] }
  | { readonly op: 'not'; readonly condition: RuleCondition };

export type RuleConditionResult = 'true' | 'false' | 'unknown';

function resolveOperand(
  operand: RuleOperand,
  context: EvaluationContext,
): RuleFieldValue | undefined {
  switch (operand.kind) {
    case 'literal':
      return operand.value;
    case 'now':
      return context.now;
    case 'field':
      return context.getValue(operand.field);
  }
}

function toDate(value: RuleFieldValue | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function toNumber(value: RuleFieldValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Kleene AND: false if any operand is false, true only if every operand is true, unknown otherwise. */
function andResults(results: readonly RuleConditionResult[]): RuleConditionResult {
  if (results.some((r) => r === 'false')) return 'false';
  if (results.every((r) => r === 'true')) return 'true';
  return 'unknown';
}

/** Kleene OR: true if any operand is true, false only if every operand is false, unknown otherwise. */
function orResults(results: readonly RuleConditionResult[]): RuleConditionResult {
  if (results.some((r) => r === 'true')) return 'true';
  if (results.every((r) => r === 'false')) return 'false';
  return 'unknown';
}

function negate(result: RuleConditionResult): RuleConditionResult {
  if (result === 'unknown') return 'unknown';
  return result === 'true' ? 'false' : 'true';
}

/** Evaluates a `RuleCondition` against one evaluation context. Total: every allowlisted node has a defined result for every input, including a value of the wrong type (treated as `unknown`, never thrown). */
export function evaluateCondition(
  condition: RuleCondition,
  context: EvaluationContext,
): RuleConditionResult {
  switch (condition.op) {
    case 'exists':
      return context.getValue(condition.field) !== undefined ? 'true' : 'unknown';

    case 'equals': {
      const actual = context.getValue(condition.field);
      if (actual === undefined) return 'unknown';
      return actual === condition.value ? 'true' : 'false';
    }

    case 'notEquals': {
      const actual = context.getValue(condition.field);
      if (actual === undefined) return 'unknown';
      return actual !== condition.value ? 'true' : 'false';
    }

    case 'memberOf': {
      const actual = context.getValue(condition.field);
      if (actual === undefined) return 'unknown';
      if (typeof actual !== 'string' && typeof actual !== 'number') return 'unknown';
      return condition.values.includes(actual) ? 'true' : 'false';
    }

    case 'dateBefore': {
      const date = toDate(resolveOperand(condition.date, context));
      const than = toDate(resolveOperand(condition.than, context));
      if (date === undefined || than === undefined) return 'unknown';
      return date.getTime() < than.getTime() ? 'true' : 'false';
    }

    case 'dateAfter': {
      const date = toDate(resolveOperand(condition.date, context));
      const than = toDate(resolveOperand(condition.than, context));
      if (date === undefined || than === undefined) return 'unknown';
      return date.getTime() > than.getTime() ? 'true' : 'false';
    }

    case 'durationAtLeastDays': {
      const from = toDate(resolveOperand(condition.from, context));
      const to = toDate(resolveOperand(condition.to, context));
      if (from === undefined || to === undefined) return 'unknown';
      const actualDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
      return actualDays >= condition.days ? 'true' : 'false';
    }

    case 'durationAtMostDays': {
      const from = toDate(resolveOperand(condition.from, context));
      const to = toDate(resolveOperand(condition.to, context));
      if (from === undefined || to === undefined) return 'unknown';
      const actualDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
      return actualDays <= condition.days ? 'true' : 'false';
    }

    case 'numberAtLeast': {
      const actual = toNumber(context.getValue(condition.field));
      if (actual === undefined) return 'unknown';
      return actual >= condition.value ? 'true' : 'false';
    }

    case 'numberAtMost': {
      const actual = toNumber(context.getValue(condition.field));
      if (actual === undefined) return 'unknown';
      return actual <= condition.value ? 'true' : 'false';
    }

    case 'numberBetween': {
      const actual = toNumber(context.getValue(condition.field));
      if (actual === undefined) return 'unknown';
      return actual >= condition.min && actual <= condition.max ? 'true' : 'false';
    }

    case 'and':
      return andResults(condition.conditions.map((c) => evaluateCondition(c, context)));

    case 'or':
      return orResults(condition.conditions.map((c) => evaluateCondition(c, context)));

    case 'not':
      return negate(evaluateCondition(condition.condition, context));
  }
}

const RULE_OPERAND_KINDS = ['literal', 'field', 'now'] as const;
const RULE_CONDITION_OPS = [
  'exists',
  'equals',
  'notEquals',
  'memberOf',
  'dateBefore',
  'dateAfter',
  'durationAtLeastDays',
  'durationAtMostDays',
  'numberAtLeast',
  'numberAtMost',
  'numberBetween',
  'and',
  'or',
  'not',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLiteralValue(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function isValidOperand(operand: unknown): operand is RuleOperand {
  if (!isPlainObject(operand)) return false;
  const { kind, value, field } = operand;
  if (!RULE_OPERAND_KINDS.includes(kind as (typeof RULE_OPERAND_KINDS)[number])) return false;
  if (kind === 'literal') return isLiteralValue(value);
  if (kind === 'field') return typeof field === 'string' && field.length > 0;
  return kind === 'now';
}

/**
 * Validates untrusted, admin-authored JSON (from `packRequirements.condition`)
 * against the exact `RuleCondition` shape before it is ever evaluated or
 * trusted -- "treat source/rule text as untrusted content" (directive §12).
 * Rejects anything that isn't one of the allowlisted operator shapes,
 * including an unknown `op` value, rather than passing it through.
 */
export function isValidRuleCondition(input: unknown): input is RuleCondition {
  if (!isPlainObject(input)) return false;
  const { op, field, value, values, date, than, from, to, days, min, max, conditions, condition } =
    input;
  if (
    typeof op !== 'string' ||
    !RULE_CONDITION_OPS.includes(op as (typeof RULE_CONDITION_OPS)[number])
  ) {
    return false;
  }

  switch (op) {
    case 'exists':
      return typeof field === 'string' && field.length > 0;

    case 'equals':
    case 'notEquals':
      return (
        typeof field === 'string' &&
        field.length > 0 &&
        ['string', 'number', 'boolean'].includes(typeof value)
      );

    case 'memberOf':
      return (
        typeof field === 'string' &&
        field.length > 0 &&
        Array.isArray(values) &&
        values.length > 0 &&
        values.every(isLiteralValue)
      );

    case 'dateBefore':
    case 'dateAfter':
      return isValidOperand(date) && isValidOperand(than);

    case 'durationAtLeastDays':
    case 'durationAtMostDays':
      return (
        isValidOperand(from) &&
        isValidOperand(to) &&
        typeof days === 'number' &&
        Number.isFinite(days)
      );

    case 'numberAtLeast':
    case 'numberAtMost':
      return (
        typeof field === 'string' &&
        field.length > 0 &&
        typeof value === 'number' &&
        Number.isFinite(value)
      );

    case 'numberBetween':
      return (
        typeof field === 'string' &&
        field.length > 0 &&
        typeof min === 'number' &&
        typeof max === 'number' &&
        Number.isFinite(min) &&
        Number.isFinite(max)
      );

    case 'and':
    case 'or':
      return (
        Array.isArray(conditions) && conditions.length > 0 && conditions.every(isValidRuleCondition)
      );

    case 'not':
      return isValidRuleCondition(condition);

    default:
      return false;
  }
}
