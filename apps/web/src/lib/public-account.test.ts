import { describe, expect, it } from 'vitest';
import { publicFirstName, publicPerson, signedInPerson } from './public-account';

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

describe('publicPerson (NAV3)', () => {
  it('gives the first name and the workspace rule for two letters', () => {
    expect(publicPerson('Amina Rahman Chowdhury')).toEqual({ firstName: 'Amina', initials: 'AR' });
    expect(publicPerson('Solo')).toEqual({ firstName: 'Solo', initials: 'S' });
  });
  it('never turns an email into letters', () => {
    expect(publicPerson('asha@example.test')).toBeNull();
    expect(publicPerson('Asha asha@example.test')).toEqual({ firstName: 'Asha', initials: 'A' });
  });
});

describe('signedInPerson (NAV3)', () => {
  it('reads the display name, never the email', async () => {
    const person = await signedInPerson({
      currentIdentity: async () => ({ displayName: 'Asha Rahman', email: 'asha@example.test' }),
    });
    expect(person).toEqual({ firstName: 'Asha', initials: 'AR' });
  });
  it('is null when the session cannot be read', async () => {
    expect(
      await signedInPerson({
        currentIdentity: async () => {
          throw new Error('down');
        },
      }),
    ).toBeNull();
  });
  it("hands Next's own signals back to Next instead of hiding them", async () => {
    const signal = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/x',
    });
    await expect(
      signedInPerson({
        currentIdentity: async () => {
          throw signal;
        },
      }),
    ).rejects.toBe(signal);
  });
});
