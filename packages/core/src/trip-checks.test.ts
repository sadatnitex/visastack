import { describe, expect, it } from 'vitest';
import {
  type TripCheckInput,
  type TripCheckKey,
  evaluateTripChecks,
  tripChecksApply,
  tripChecksNeedingAction,
} from './trip-checks';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function input(over: Partial<TripCheckInput> = {}): TripCheckInput {
  return {
    now: d('2026-10-31'),
    travelStart: d('2027-03-10'),
    travelEnd: d('2027-03-24'),
    targetDeadline: null,
    passportExpiry: d('2030-01-01'),
    insurancePolicies: [],
    ...over,
  };
}

function find(checks: ReturnType<typeof evaluateTripChecks>, key: TripCheckKey) {
  return checks.find((check) => check.key === key);
}

describe('trip checks: passport', () => {
  it('is fine with six months or more after the trip ends', () => {
    const check = find(
      evaluateTripChecks(input({ passportExpiry: d('2027-09-24') })),
      'passport_validity',
    );
    expect(check?.level).toBe('ok');
  });

  it('asks for a look when under six months remain, counting calendar months', () => {
    const check = find(
      evaluateTripChecks(input({ passportExpiry: d('2027-09-23') })),
      'passport_validity',
    );
    expect(check?.level).toBe('check');
    expect(check?.detail).toContain('183 days after your trip ends');
    expect(check?.detail).toContain('check the rule for your destination');
  });

  it('is a problem when the passport expires before the trip ends, and fine on the last day', () => {
    expect(
      find(evaluateTripChecks(input({ passportExpiry: d('2027-03-23') })), 'passport_validity')
        ?.level,
    ).toBe('problem');
    expect(
      find(evaluateTripChecks(input({ passportExpiry: d('2027-03-24') })), 'passport_validity')
        ?.level,
    ).toBe('check');
  });

  it('is a problem when the passport has already expired', () => {
    const check = find(
      evaluateTripChecks(input({ passportExpiry: d('2026-10-30') })),
      'passport_validity',
    );
    expect(check?.level).toBe('problem');
    expect(check?.title).toBe('Your passport has expired');
  });

  it('asks for the expiry date when none is recorded, and says nothing without any trip date', () => {
    expect(
      find(evaluateTripChecks(input({ passportExpiry: null })), 'passport_validity')?.level,
    ).toBe('unknown');
    expect(
      find(
        evaluateTripChecks(input({ travelStart: null, travelEnd: null, passportExpiry: null })),
        'passport_validity',
      ),
    ).toBeUndefined();
  });

  it('uses the start date when only the start is known, and says so', () => {
    const check = find(
      evaluateTripChecks(input({ travelEnd: null, passportExpiry: d('2027-05-01') })),
      'passport_validity',
    );
    expect(check?.level).toBe('check');
    expect(check?.detail).toContain('after your trip starts');
    expect(check?.title).toContain('after your trip starts');
    const problem = find(
      evaluateTripChecks(input({ travelEnd: null, passportExpiry: d('2027-03-01') })),
      'passport_validity',
    );
    expect(problem?.title).toBe('Your passport expires before your trip starts');
  });

  it('ignores the time of day, so a stored time never moves a result by a day', () => {
    const late = new Date('2027-03-24T23:59:59Z');
    const early = new Date('2027-03-24T00:00:01Z');
    expect(
      find(
        evaluateTripChecks(input({ travelEnd: early, passportExpiry: late })),
        'passport_validity',
      )?.level,
    ).toBe('check');
  });

  it('handles the end of a long month when adding six months', () => {
    const check = find(
      evaluateTripChecks(
        input({
          travelStart: d('2027-08-01'),
          travelEnd: d('2027-08-31'),
          passportExpiry: d('2028-02-29'),
        }),
      ),
      'passport_validity',
    );
    expect(check?.level).toBe('ok');
    const short = find(
      evaluateTripChecks(
        input({
          travelStart: d('2027-08-01'),
          travelEnd: d('2027-08-31'),
          passportExpiry: d('2028-02-28'),
        }),
      ),
      'passport_validity',
    );
    expect(short?.level).toBe('check');
  });
});

describe('trip checks: insurance', () => {
  const policy = (from: string | null, until: string | null) => ({
    validFrom: from ? d(from) : null,
    validUntil: until ? d(until) : null,
  });

  it('says nothing when there is no insurance record, and nothing without trip dates', () => {
    expect(find(evaluateTripChecks(input()), 'insurance_cover')).toBeUndefined();
    expect(
      find(
        evaluateTripChecks(
          input({ travelEnd: null, insurancePolicies: [policy('2027-03-01', '2027-04-01')] }),
        ),
        'insurance_cover',
      ),
    ).toBeUndefined();
  });

  it('is fine when one policy covers every day, including the first and last', () => {
    const check = find(
      evaluateTripChecks(input({ insurancePolicies: [policy('2027-03-10', '2027-03-24')] })),
      'insurance_cover',
    );
    expect(check?.level).toBe('ok');
  });

  it('asks for a look when no single policy covers the trip', () => {
    const check = find(
      evaluateTripChecks(
        input({
          insurancePolicies: [
            policy('2027-03-10', '2027-03-17'),
            policy('2027-03-18', '2027-03-24'),
          ],
        }),
      ),
      'insurance_cover',
    );
    expect(check?.level).toBe('check');
    expect(check?.detail).toContain('one policy should cover every day');
  });

  it('asks for the policy dates when none has both', () => {
    const check = find(
      evaluateTripChecks(input({ insurancePolicies: [policy('2027-03-01', null)] })),
      'insurance_cover',
    );
    expect(check?.level).toBe('unknown');
  });
});

describe('trip checks: the case dates', () => {
  it('flags an end before the start', () => {
    const check = find(
      evaluateTripChecks(input({ travelStart: d('2027-03-24'), travelEnd: d('2027-03-10') })),
      'trip_dates',
    );
    expect(check?.level).toBe('problem');
  });

  it('flags a start date that has passed, but not today', () => {
    expect(
      find(evaluateTripChecks(input({ travelStart: d('2026-10-30') })), 'trip_start_passed')?.level,
    ).toBe('check');
    expect(
      find(evaluateTripChecks(input({ travelStart: d('2026-10-31') })), 'trip_start_passed'),
    ).toBeUndefined();
  });

  it('flags a target date after the trip starts, but not the same day', () => {
    expect(
      find(evaluateTripChecks(input({ targetDeadline: d('2027-03-11') })), 'target_date')?.level,
    ).toBe('check');
    expect(
      find(evaluateTripChecks(input({ targetDeadline: d('2027-03-10') })), 'target_date'),
    ).toBeUndefined();
  });
});

describe('trip checks: the list', () => {
  it('puts problems first, then looks, then missing details, then fine, and counts the first two', () => {
    const checks = evaluateTripChecks(
      input({
        passportExpiry: d('2027-03-01'),
        targetDeadline: d('2027-04-01'),
        insurancePolicies: [{ validFrom: d('2027-03-01'), validUntil: null }],
      }),
    );
    expect(checks.map((check) => check.level)).toEqual(['problem', 'check', 'unknown']);
    expect(tripChecksNeedingAction(checks)).toBe(2);
  });

  it('is empty for a case with no dates at all', () => {
    expect(
      evaluateTripChecks(input({ travelStart: null, travelEnd: null, passportExpiry: null })),
    ).toEqual([]);
  });

  it('uses plain words and no dash characters', () => {
    const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    const checks = evaluateTripChecks(
      input({
        passportExpiry: d('2027-03-01'),
        targetDeadline: d('2027-04-01'),
        insurancePolicies: [{ validFrom: d('2027-03-12'), validUntil: d('2027-03-20') }],
      }),
    );
    expect(checks.length).toBeGreaterThan(2);
    for (const check of checks) {
      expect(`${check.title} ${check.detail}`).not.toMatch(dashes);
      expect(`${check.title} ${check.detail}`.toLowerCase()).not.toContain('mission');
    }
  });

  it('applies until a case is handed in, closed or cancelled', () => {
    expect(tripChecksApply('DRAFT')).toBe(true);
    expect(tripChecksApply('SUBMISSION_READY')).toBe(true);
    for (const state of ['SUBMITTED', 'CLOSED', 'CANCELLED'])
      expect(tripChecksApply(state)).toBe(false);
  });
});
