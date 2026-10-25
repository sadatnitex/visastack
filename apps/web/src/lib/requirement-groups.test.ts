import { describe, expect, it } from 'vitest';
import { REQUIREMENT_GROUPS } from './requirement-groups';

const ALL_STATES = [
  'CRITICAL_GAP',
  'CONFLICTING',
  'EXPIRING_STALE',
  'UNVERIFIED',
  'ATTENTION',
  'SATISFIED',
  'NOT_APPLICABLE',
] as const;

describe('REQUIREMENT_GROUPS', () => {
  it('places every outcome under exactly one heading', () => {
    for (const state of ALL_STATES) {
      const homes = REQUIREMENT_GROUPS.filter((group) => group.states.includes(state));
      expect(homes, state).toHaveLength(1);
    }
  });

  it('puts what the person must do first and finished work last', () => {
    expect(REQUIREMENT_GROUPS.map((group) => group.heading)).toEqual([
      'Needs You',
      'Needs a Check',
      'Done',
    ]);
    expect(REQUIREMENT_GROUPS[0]?.states).toContain('CRITICAL_GAP');
    expect(REQUIREMENT_GROUPS[2]?.states).toContain('SATISFIED');
  });
});
