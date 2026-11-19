import { describe, expect, it } from 'vitest';
import { publicFirstName, signedInFirstName } from './public-account';

describe('publicFirstName (NAV3)', () => {
  it('takes the first word of the name', () => {
    expect(publicFirstName('Asha Rahman')).toBe('Asha');
    expect(publicFirstName('  Nur  Jahan ')).toBe('Nur');
  });
  it('never returns an email address', () => {
    expect(publicFirstName('asha@example.test')).toBeNull();
    expect(publicFirstName('Asha asha@example.test')).toBe('Asha');
  });
  it('is null for no usable name', () => {
    expect(publicFirstName(undefined)).toBeNull();
    expect(publicFirstName('   ')).toBeNull();
    expect(publicFirstName(42)).toBeNull();
  });
  it('keeps a very long name short', () => {
    expect(publicFirstName('x'.repeat(200))?.length).toBe(40);
  });
});

describe('signedInFirstName (NAV3)', () => {
  it('reads the display name, never the email', async () => {
    const name = await signedInFirstName({
      currentIdentity: async () => ({ displayName: 'Asha Rahman', email: 'asha@example.test' }),
    });
    expect(name).toBe('Asha');
  });
  it('is null when the session cannot be read', async () => {
    expect(
      await signedInFirstName({
        currentIdentity: async () => {
          throw new Error('down');
        },
      }),
    ).toBeNull();
  });
});
