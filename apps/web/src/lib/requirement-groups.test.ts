import { describe, expect, it } from 'vitest';
import { COVERED_HEADING, REQUIREMENT_GROUPS } from './requirement-groups';

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

  it('puts what the person must do first and what is on file after the optional items', () => {
    expect(REQUIREMENT_GROUPS.map((group) => group.heading)).toEqual([
      'Needs You',
      'Needs a Check',
      'Optional',
      'On File',
      'Does Not Apply',
    ]);
    expect(REQUIREMENT_GROUPS[0]?.states).toContain('CRITICAL_GAP');
    expect(REQUIREMENT_GROUPS[3]?.states).toEqual(['SATISFIED']);
  });

  it('never counts an optional item with nothing uploaded as on file', () => {
    const onFile = REQUIREMENT_GROUPS.find((group) => group.heading === 'On File');
    expect(onFile?.states).not.toContain('ATTENTION');
    expect(onFile?.states).not.toContain('NOT_APPLICABLE');
  });

  it('moves only a covered line into On File', () => {
    expect(COVERED_HEADING).toBe('On File');
  });
});
