import { describe, expect, it } from 'vitest';
import {
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  REQUIREMENT_NECESSITIES,
  isRequirementNecessity,
  isRequirementProvenance,
  necessityCanBlock,
  optionalFlagFor,
  requirementNecessity,
  requirementProvenance,
} from './requirement-necessity';

describe('requirement necessity (ADR 0026 D3)', () => {
  it('reads legacy rows honestly: required is Mandatory, optional is Optional, nothing invented', () => {
    expect(requirementNecessity({ optional: false })).toBe('MANDATORY');
    expect(requirementNecessity({ optional: true })).toBe('OPTIONAL');
    expect(requirementNecessity({ optional: true, necessity: null })).toBe('OPTIONAL');
  });

  it('an authored necessity wins over the legacy flag', () => {
    expect(requirementNecessity({ optional: true, necessity: 'RECOMMENDED' })).toBe('RECOMMENDED');
    expect(requirementNecessity({ optional: false, necessity: 'CONDITIONAL' })).toBe('CONDITIONAL');
  });

  it('only Mandatory and Conditional can block, and the legacy flag agrees', () => {
    expect(REQUIREMENT_NECESSITIES.filter(necessityCanBlock)).toEqual(['MANDATORY', 'CONDITIONAL']);
    for (const necessity of REQUIREMENT_NECESSITIES) {
      expect(optionalFlagFor(necessity)).toBe(!necessityCanBlock(necessity));
    }
  });

  it('provenance defaults to official and is a separate question', () => {
    expect(requirementProvenance({ optional: false })).toBe('OFFICIAL');
    expect(requirementProvenance({ optional: true, provenance: 'AGENCY_ADDED' })).toBe(
      'AGENCY_ADDED',
    );
  });

  it('guards accept only the known words', () => {
    expect(isRequirementNecessity('MANDATORY')).toBe(true);
    expect(isRequirementNecessity('ALTERNATIVE_GROUP')).toBe(false);
    expect(isRequirementNecessity(undefined)).toBe(false);
    expect(isRequirementProvenance('OFFICIAL')).toBe(true);
    expect(isRequirementProvenance('agency')).toBe(false);
  });

  it('labels every value in plain words', () => {
    expect(Object.keys(NECESSITY_LABELS).sort()).toEqual([...REQUIREMENT_NECESSITIES].sort());
    expect(Object.values(PROVENANCE_LABELS)).not.toContain('');
  });
});
