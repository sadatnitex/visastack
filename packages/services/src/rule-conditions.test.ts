import { describe, expect, it } from 'vitest';
import {
  type EvaluationContext,
  type RuleCondition,
  evaluateCondition,
  isValidRuleCondition,
} from './rule-conditions';

const NOW = new Date('2026-06-01T00:00:00Z');

function context(
  values: Readonly<Record<string, string | number | boolean | Date>>,
): EvaluationContext {
  return {
    now: NOW,
    getValue: (field) => values[field],
  };
}

describe('evaluateCondition - existence, equality, membership', () => {
  it('exists is true when present, unknown when missing (never false)', () => {
    expect(
      evaluateCondition(
        { op: 'exists', field: 'passport_number' },
        context({ passport_number: 'X1' }),
      ),
    ).toBe('true');
    expect(evaluateCondition({ op: 'exists', field: 'passport_number' }, context({}))).toBe(
      'unknown',
    );
  });

  it('equals/notEquals compare present values and report unknown when missing', () => {
    const ctx = context({ nationality: 'BD' });
    expect(evaluateCondition({ op: 'equals', field: 'nationality', value: 'BD' }, ctx)).toBe(
      'true',
    );
    expect(evaluateCondition({ op: 'equals', field: 'nationality', value: 'FR' }, ctx)).toBe(
      'false',
    );
    expect(evaluateCondition({ op: 'notEquals', field: 'nationality', value: 'FR' }, ctx)).toBe(
      'true',
    );
    expect(evaluateCondition({ op: 'equals', field: 'missing', value: 'BD' }, ctx)).toBe('unknown');
  });

  it('equals works across string/number/boolean literal types', () => {
    const ctx = context({ age: 30, verified: true });
    expect(evaluateCondition({ op: 'equals', field: 'age', value: 30 }, ctx)).toBe('true');
    expect(evaluateCondition({ op: 'equals', field: 'verified', value: true }, ctx)).toBe('true');
    expect(evaluateCondition({ op: 'equals', field: 'verified', value: false }, ctx)).toBe('false');
  });

  it('memberOf checks list membership, unknown when missing, unknown for a non-primitive value', () => {
    const ctx = context({ route: 'tourist', flag: true });
    expect(
      evaluateCondition({ op: 'memberOf', field: 'route', values: ['tourist', 'business'] }, ctx),
    ).toBe('true');
    expect(evaluateCondition({ op: 'memberOf', field: 'route', values: ['student'] }, ctx)).toBe(
      'false',
    );
    expect(evaluateCondition({ op: 'memberOf', field: 'missing', values: ['x'] }, ctx)).toBe(
      'unknown',
    );
    expect(evaluateCondition({ op: 'memberOf', field: 'flag', values: ['x'] }, ctx)).toBe(
      'unknown',
    );
  });
});

describe('evaluateCondition - date and duration comparisons', () => {
  it('dateBefore/dateAfter compare two operands, field vs literal and field vs now', () => {
    const ctx = context({
      issue_date: new Date('2020-01-01'),
      expiry_date: new Date('2030-01-01'),
    });
    expect(
      evaluateCondition(
        {
          op: 'dateBefore',
          date: { kind: 'field', field: 'issue_date' },
          than: { kind: 'field', field: 'expiry_date' },
        },
        ctx,
      ),
    ).toBe('true');
    expect(
      evaluateCondition(
        { op: 'dateAfter', date: { kind: 'field', field: 'expiry_date' }, than: { kind: 'now' } },
        ctx,
      ),
    ).toBe('true');
    expect(
      evaluateCondition(
        { op: 'dateBefore', date: { kind: 'field', field: 'missing' }, than: { kind: 'now' } },
        ctx,
      ),
    ).toBe('unknown');
  });

  it('durationAtLeastDays/durationAtMostDays compare the gap between two operands against a threshold', () => {
    const ctx = context({
      travel_end: new Date('2026-08-01'),
      passport_expiry_6mo: new Date('2027-02-01'),
      passport_expiry_short: new Date('2026-08-15'),
    });
    expect(
      evaluateCondition(
        {
          op: 'durationAtLeastDays',
          from: { kind: 'field', field: 'travel_end' },
          to: { kind: 'field', field: 'passport_expiry_6mo' },
          days: 180,
        },
        ctx,
      ),
    ).toBe('true');
    expect(
      evaluateCondition(
        {
          op: 'durationAtLeastDays',
          from: { kind: 'field', field: 'travel_end' },
          to: { kind: 'field', field: 'passport_expiry_short' },
          days: 180,
        },
        ctx,
      ),
    ).toBe('false');
    expect(
      evaluateCondition(
        {
          op: 'durationAtMostDays',
          from: { kind: 'now' },
          to: { kind: 'literal', value: NOW.toISOString() },
          days: 0,
        },
        ctx,
      ),
    ).toBe('true');
  });

  it('an unparseable date value is unknown, not a thrown error', () => {
    const ctx = context({ issue_date: 'not-a-date' });
    expect(
      evaluateCondition(
        { op: 'dateBefore', date: { kind: 'field', field: 'issue_date' }, than: { kind: 'now' } },
        ctx,
      ),
    ).toBe('unknown');
  });
});

describe('evaluateCondition - numeric bounds', () => {
  it('numberAtLeast/numberAtMost/numberBetween, including numeric-string coercion', () => {
    const ctx = context({ income: 50000, income_as_string: '50000', junk: 'not-a-number' });
    expect(evaluateCondition({ op: 'numberAtLeast', field: 'income', value: 40000 }, ctx)).toBe(
      'true',
    );
    expect(evaluateCondition({ op: 'numberAtMost', field: 'income', value: 40000 }, ctx)).toBe(
      'false',
    );
    expect(
      evaluateCondition({ op: 'numberBetween', field: 'income', min: 10000, max: 100000 }, ctx),
    ).toBe('true');
    expect(
      evaluateCondition({ op: 'numberAtLeast', field: 'income_as_string', value: 40000 }, ctx),
    ).toBe('true');
    expect(evaluateCondition({ op: 'numberAtLeast', field: 'junk', value: 1 }, ctx)).toBe(
      'unknown',
    );
    expect(evaluateCondition({ op: 'numberAtLeast', field: 'missing', value: 1 }, ctx)).toBe(
      'unknown',
    );
  });
});

describe('evaluateCondition - Kleene three-valued boolean composition', () => {
  const T: RuleCondition = { op: 'exists', field: 'present' };
  const F: RuleCondition = { op: 'equals', field: 'present', value: 'nope' };
  const U: RuleCondition = { op: 'exists', field: 'absent' };
  const ctx = context({ present: 'yes' });

  it('and: false wins over unknown; true requires every operand true; else unknown', () => {
    expect(evaluateCondition({ op: 'and', conditions: [T, T] }, ctx)).toBe('true');
    expect(evaluateCondition({ op: 'and', conditions: [T, F] }, ctx)).toBe('false');
    expect(evaluateCondition({ op: 'and', conditions: [F, U] }, ctx)).toBe('false');
    expect(evaluateCondition({ op: 'and', conditions: [T, U] }, ctx)).toBe('unknown');
    expect(evaluateCondition({ op: 'and', conditions: [U, U] }, ctx)).toBe('unknown');
  });

  it('or: true wins over unknown; false requires every operand false; else unknown', () => {
    expect(evaluateCondition({ op: 'or', conditions: [F, F] }, ctx)).toBe('false');
    expect(evaluateCondition({ op: 'or', conditions: [T, F] }, ctx)).toBe('true');
    expect(evaluateCondition({ op: 'or', conditions: [T, U] }, ctx)).toBe('true');
    expect(evaluateCondition({ op: 'or', conditions: [F, U] }, ctx)).toBe('unknown');
    expect(evaluateCondition({ op: 'or', conditions: [U, U] }, ctx)).toBe('unknown');
  });

  it('not: flips true/false, leaves unknown as unknown', () => {
    expect(evaluateCondition({ op: 'not', condition: T }, ctx)).toBe('false');
    expect(evaluateCondition({ op: 'not', condition: F }, ctx)).toBe('true');
    expect(evaluateCondition({ op: 'not', condition: U }, ctx)).toBe('unknown');
  });

  it('composes nested and/or/not correctly', () => {
    const nested: RuleCondition = {
      op: 'and',
      conditions: [
        { op: 'or', conditions: [F, T] },
        { op: 'not', condition: F },
      ],
    };
    expect(evaluateCondition(nested, ctx)).toBe('true');
  });
});

describe('isValidRuleCondition - rejects anything not an allowlisted operator shape', () => {
  it('accepts one example of every operator', () => {
    const valid: readonly RuleCondition[] = [
      { op: 'exists', field: 'a' },
      { op: 'equals', field: 'a', value: 'b' },
      { op: 'notEquals', field: 'a', value: 1 },
      { op: 'memberOf', field: 'a', values: ['x', 1] },
      { op: 'dateBefore', date: { kind: 'now' }, than: { kind: 'field', field: 'a' } },
      { op: 'dateAfter', date: { kind: 'literal', value: '2026-01-01' }, than: { kind: 'now' } },
      { op: 'durationAtLeastDays', from: { kind: 'now' }, to: { kind: 'now' }, days: 1 },
      { op: 'durationAtMostDays', from: { kind: 'now' }, to: { kind: 'now' }, days: 1 },
      { op: 'numberAtLeast', field: 'a', value: 1 },
      { op: 'numberAtMost', field: 'a', value: 1 },
      { op: 'numberBetween', field: 'a', min: 0, max: 1 },
      { op: 'and', conditions: [{ op: 'exists', field: 'a' }] },
      { op: 'or', conditions: [{ op: 'exists', field: 'a' }] },
      { op: 'not', condition: { op: 'exists', field: 'a' } },
    ];
    for (const condition of valid) expect(isValidRuleCondition(condition)).toBe(true);
  });

  it('rejects non-objects, null, arrays, and an unknown op', () => {
    expect(isValidRuleCondition(null)).toBe(false);
    expect(isValidRuleCondition(undefined)).toBe(false);
    expect(isValidRuleCondition('exists')).toBe(false);
    expect(isValidRuleCondition(42)).toBe(false);
    expect(isValidRuleCondition([])).toBe(false);
    expect(isValidRuleCondition({ op: 'evaluate', field: 'a' })).toBe(false);
    expect(isValidRuleCondition({ op: 'eval', code: 'process.exit()' })).toBe(false);
  });

  it('rejects a shape missing a required key, or with a wrong-typed key', () => {
    expect(isValidRuleCondition({ op: 'exists' })).toBe(false);
    expect(isValidRuleCondition({ op: 'exists', field: 42 })).toBe(false);
    expect(isValidRuleCondition({ op: 'equals', field: 'a' })).toBe(false);
    expect(isValidRuleCondition({ op: 'equals', field: 'a', value: {} })).toBe(false);
    expect(isValidRuleCondition({ op: 'memberOf', field: 'a', values: [] })).toBe(false);
    expect(isValidRuleCondition({ op: 'memberOf', field: 'a', values: [{}] })).toBe(false);
    expect(isValidRuleCondition({ op: 'numberBetween', field: 'a', min: 'zero', max: 1 })).toBe(
      false,
    );
  });

  it('rejects a compound condition with even one invalid child, however deeply nested', () => {
    expect(
      isValidRuleCondition({
        op: 'and',
        conditions: [
          { op: 'exists', field: 'a' },
          { op: 'or', conditions: [{ op: 'exists', field: 'b' }, { op: 'not_a_real_op' }] },
        ],
      }),
    ).toBe(false);
    expect(isValidRuleCondition({ op: 'and', conditions: [] })).toBe(false);
    expect(isValidRuleCondition({ op: 'not', condition: { op: 'bogus' } })).toBe(false);
  });

  it('rejects a date/duration operand of the wrong shape', () => {
    expect(
      isValidRuleCondition({ op: 'dateBefore', date: { kind: 'literal' }, than: { kind: 'now' } }),
    ).toBe(false);
    expect(
      isValidRuleCondition({
        op: 'dateBefore',
        date: { kind: 'field', field: '' },
        than: { kind: 'now' },
      }),
    ).toBe(false);
    expect(
      isValidRuleCondition({ op: 'dateBefore', date: { kind: 'bogus' }, than: { kind: 'now' } }),
    ).toBe(false);
  });
});
