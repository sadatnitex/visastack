import { PERMISSION_ACTIONS, type PermissionAction } from '@visastack/core';
import { DEFAULT_CLIENT_GRANT_ACTIONS } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { clientInvitationTerms, formatInvitationExpiry } from './client-invitation-terms';

const EM_DASH = String.fromCharCode(0x2014);

describe('the terms shown before sign-in come from the real grant', () => {
  const terms = clientInvitationTerms(DEFAULT_CLIENT_GRANT_ACTIONS);

  it('has one plain sentence for every action the agency really receives, in the same order', () => {
    expect(terms).not.toBeNull();
    expect(terms?.agencyCan).toHaveLength(DEFAULT_CLIENT_GRANT_ACTIONS.length);
    // Each action on its own gives exactly its own sentence, so no sentence stands for two actions.
    const each = DEFAULT_CLIENT_GRANT_ACTIONS.map(
      (action) => clientInvitationTerms([action])?.agencyCan[0],
    );
    expect(each).toEqual(terms?.agencyCan);
    expect(new Set(each).size).toBe(each.length);
  });

  it('names what the agency cannot do, because the real grant leaves all of it out', () => {
    const withheld = terms?.agencyCannot ?? '';
    for (const phrase of [
      'download your original files',
      'export your profile',
      'share your records with anyone else',
      'approve changes to your profile for you',
    ]) {
      expect(withheld).toContain(phrase);
    }
    for (const action of [
      'DOWNLOAD_ORIGINAL',
      'EXPORT_PROFILE',
      'SHARE',
      'APPROVE_EDIT',
    ] as const) {
      expect(DEFAULT_CLIENT_GRANT_ACTIONS, action).not.toContain(action);
    }
  });

  it('a smaller grant gets fewer sentences, and an empty one still says what is not given', () => {
    const smaller = DEFAULT_CLIENT_GRANT_ACTIONS.filter((a) => a !== 'MANAGE');
    expect(clientInvitationTerms(smaller)?.agencyCan).toHaveLength(smaller.length);
    const none = clientInvitationTerms([]);
    expect(none?.agencyCan).toEqual([]);
    expect(none?.agencyCannot).toContain('download your original files');
  });

  it('gives no terms at all for a grant with an action it has no sentence for, rather than leave it out', () => {
    for (const action of PERMISSION_ACTIONS) {
      const covered = clientInvitationTerms([action]) !== null;
      expect(covered, action).toBe(DEFAULT_CLIENT_GRANT_ACTIONS.includes(action));
    }
    expect(clientInvitationTerms([...DEFAULT_CLIENT_GRANT_ACTIONS, 'SHARE'])).toBeNull();
  });

  it('is plain: no em dash, no engineering words, and never the word mission', () => {
    const everything = [...(terms?.agencyCan ?? []), terms?.agencyCannot ?? ''].join(' ');
    expect(everything).not.toContain(EM_DASH);
    expect(everything).not.toMatch(/\b(mission|metadata|permission|grant|MANAGE)\b/i);
  });
});

describe('the expiry reads the same everywhere', () => {
  it('gives the day and the time in UTC, whatever the reader time zone is', () => {
    expect(formatInvitationExpiry(new Date('2026-11-03T14:30:00.000Z'))).toBe(
      '3 Nov 2026, 14:30 UTC',
    );
    expect(formatInvitationExpiry(new Date('2026-11-03T00:05:00.000Z'))).toBe(
      '3 Nov 2026, 00:05 UTC',
    );
  });
});

describe('type check on the action list', () => {
  it('uses real permission actions only', () => {
    const real: readonly PermissionAction[] = PERMISSION_ACTIONS;
    for (const action of DEFAULT_CLIENT_GRANT_ACTIONS) expect(real).toContain(action);
  });
});
