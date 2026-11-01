import { describe, expect, it } from 'vitest';
import { openCaseAddress } from './open-case-from-link';

const ID = '11111111-1111-4111-8111-111111111111';

describe('openCaseAddress (WP-SB5)', () => {
  it('turns an anchor-only link to a case into the address that opens it', () => {
    expect(openCaseAddress('/app/agency/o1/cases', '', `#mission-${ID}`)).toBe(
      `/app/agency/o1/cases?case=${ID}#mission-${ID}`,
    );
    expect(
      openCaseAddress('/app/agency/o1/cases', '?before=abc', `#mission-${ID.toUpperCase()}`),
    ).toBe(`/app/agency/o1/cases?before=abc&case=${ID}#mission-${ID}`);
  });

  it('leaves an address that already opens a case, or has no case anchor, alone', () => {
    expect(openCaseAddress('/app/agency/o1/cases', `?case=${ID}`, `#mission-${ID}`)).toBeNull();
    expect(openCaseAddress('/app/agency/o1/cases', '', '#notes-x')).toBeNull();
    expect(openCaseAddress('/app/agency/o1/cases', '', '')).toBeNull();
    expect(openCaseAddress('/app/agency/o1/cases', '', '#mission-m1')).toBeNull();
    expect(openCaseAddress('/app/agency/o1/cases', '', `#mission-${ID}x`)).toBeNull();
  });
});
